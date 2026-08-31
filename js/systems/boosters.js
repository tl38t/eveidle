/* ================================================================
   增强剂系统 Phase 2B — 统一纯函数层
   放在所有效果消费者之前加载（index.html 中紧跟 js/data/boosters.js）。
   ================================================================ */

/* ----------------------------------------------------------------
   基础查询
   ---------------------------------------------------------------- */
function getBoosterItemFromState(state, id) {
  if (!id) return null;
  const key = String(id).startsWith("booster:") ? String(id).slice("booster:".length) : String(id);
  return (typeof getBoosterItem === "function") ? getBoosterItem(key) : null;
}

function getActiveBoosterState(state) {
  return (state && state.boosters && state.boosters.active) || {};
}

function normalizeActiveBoosterEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const itemId = entry.itemId;
  if (typeof itemId !== "string") return null;
  const item = getBoosterItemFromState(null, itemId);
  if (!item) return null;
  const remainingMs = Number(entry.remainingMs);
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  return { itemId, remainingMs };
}

/* ----------------------------------------------------------------
   六个槽 → 行动映射
   ---------------------------------------------------------------- */
function getActionBoosterSlots(actionKey) {
  switch (actionKey) {
    case "mining": return ["miningSpeed", "miningYield"];
    case "archaeology": return ["archaeologySpeed", "archaeologyRare"];
    case "combat": return ["combatWeapon", "combatRepair"];
    // 考古重制（Phase B）：四类生产增强剂槽位，考古蓝图产出，在线/离线共用。
    case "gasHarvesting": return ["gasSpeed", "gasYield"];
    case "refining": return ["smeltSpeed", "smeltYield"];
    case "shipEngineering": return ["shipSpeed", "shipYield"];
    case "equipmentEngineering": return ["equipmentSpeed", "equipmentYield"];
    case "boosterEngineering": return ["boosterSpeed", "boosterYield"];
    default: return [];
  }
}

/* 槽位 → 技能经验键映射（经验茶模型：神经增强剂装在哪类槽，只加成该类行动的技能经验）。 */
var BOOSTER_SLOT_XP_SKILL = {
  miningSpeed:"mining", miningYield:"mining",
  archaeologySpeed:"archaeology", archaeologyRare:"archaeology",
  gasSpeed:"gasHarvesting", gasYield:"gasHarvesting",
  smeltSpeed:"refining", smeltYield:"refining",
  shipSpeed:"shipEngineering", shipYield:"shipEngineering",
  equipmentSpeed:"equipmentEngineering", equipmentYield:"equipmentEngineering",
  boosterSpeed:"boosterEngineering", boosterYield:"boosterEngineering",
  combatWeapon:"combat", combatRepair:"combat"
};

/* 战斗经验实际加到的子技能键集合。与 station.js 的 COMBAT_SKILL_WHITELIST 保持一致
   （此处无法跨文件 import，故镜像；若 station.js 清单变更，这里也要同步）。
   神经增强剂装在 combatWeapon/combatRepair 槽只写入 skillXpMultBySkill["combat"]，
   而 state.skills 不存在 "combat" 主键——战斗经验落在这些子技能上，故需广播。 */
var COMBAT_XP_SKILL_KEYS = [
  "capacitorManagement", "laserOps", "cannonOps", "missileOperations",
  "targeting", "shieldOperation", "armorReinforcement", "hullEngineering",
  "piloting", "defense"
];

// 每个行动的两个槽位都是同一行动类别的通用槽；槽位名称仅保留用于存档兼容。
var BOOSTER_SLOT_ACTION = {
  miningSpeed:"mining", miningYield:"mining",
  archaeologySpeed:"archaeology", archaeologyRare:"archaeology",
  gasSpeed:"gas", gasYield:"gas",
  smeltSpeed:"refining", smeltYield:"refining",
  shipSpeed:"ship", shipYield:"ship",
  equipmentSpeed:"equipmentEngineering", equipmentYield:"equipmentEngineering",
  boosterSpeed:"booster", boosterYield:"booster",
  combatWeapon:"combat", combatRepair:"combat"
};

/* 槽位 → 分类 id（与 BOOSTER_CATEGORY_META 的 id 严格一致）。
   注意：equipment 槽的 action 是技能键 "equipmentEngineering"，而分类 id 是 "equipment"，
   两者不等价，故单独建一张「槽位→分类」映射供兼容性判定使用，避免字符串误判。 */
var BOOSTER_SLOT_CATEGORY = {
  miningSpeed:"mining", miningYield:"mining",
  archaeologySpeed:"archaeology", archaeologyRare:"archaeology",
  gasSpeed:"gas", gasYield:"gas",
  smeltSpeed:"refining", smeltYield:"refining",
  shipSpeed:"ship", shipYield:"ship",
  equipmentSpeed:"equipment", equipmentYield:"equipment",
  boosterSpeed:"booster", boosterYield:"booster",
  combatWeapon:"combatWeapon", combatRepair:"combatRepair"
};

// 槽位 → 技能显示名（用于装备态描述：技能超载催化器装在哪个槽就显示哪个技能）。
function getSkillLabelForSlot(slot) {
  var action = BOOSTER_SLOT_ACTION[slot];
  if (!action) return "装备槽对应技能";
  if (action === "combat") return "战斗";
  var meta = BOOSTER_CATEGORY_META.find(function(c) { return c.id === action; });
  return meta ? meta.name : "装备槽对应技能";
}

function isBoosterCompatibleWithSlot(item, slot) {
  if (!item) return false;
  if (item.universal) {
    // 技能超载催化器（skillLevelBonus）只允许采集/制造类槽，禁止进入战斗槽
    // （战斗槽映射到 combat，不在 7 个受加成技能内，装了等于白装）。
    if (item.effectType === "skillLevelBonus") {
      const action = BOOSTER_SLOT_ACTION[slot];
      return !!action && action !== "combat";
    }
    return true;
  }
  // 非通用件：用「槽位 → 分类 id」判断，支持数组分类（如精密配给剂同时归属 ship + equipment）。
  const slotCat = BOOSTER_SLOT_CATEGORY[slot];
  if (!slotCat) return item.slot === slot;
  const cats = Array.isArray(item.category) ? item.category : [item.category];
  return cats.indexOf(slotCat) !== -1;
}

/* ----------------------------------------------------------------
   装备校验（只用 inventory 检查，不修改状态）
   ---------------------------------------------------------------- */
function canEquipBooster(state, slot, itemId) {
  if (!Array.isArray(BOOSTER_SLOTS) || !BOOSTER_SLOTS.includes(slot)) {
    return { ok:false, reason:"invalid-slot" };
  }
  const item = getBoosterItemFromState(state, itemId);
  if (!item) return { ok:false, reason:"unknown-item" };
  if (!isBoosterCompatibleWithSlot(item, slot)) return { ok:false, reason:"slot-mismatch" };
  const inv = ResourceRegistry.get(state, item.itemId);
  if (!(inv >= 1)) return { ok:false, reason:"insufficient-inventory" };
  // 同系列冲突：仅当两槽属于同一分类组（如 miningSpeed+miningYield 同属 mining）才禁止；
  // 跨分类组（如 ship+equipment，典型如精密配给剂）允许共存——其效果取 MAX，不会叠加。
  const active = getActiveBoosterState(state);
  for (const s of BOOSTER_SLOTS) {
    const e = active[s];
    if (!e || s === slot) continue;
    const existing = getBoosterItemFromState(state, e.itemId);
    if (existing && !existing.universal && !item.universal && existing.series === item.series) {
      const existingCat = BOOSTER_SLOT_CATEGORY[s];
      const newCat = BOOSTER_SLOT_CATEGORY[slot];
      if (existingCat && existingCat === newCat) return { ok:false, reason:"series-conflict" };
    }
    // 通用件（神经）：同一类别（同一经验技能域）的槽位只能装一个
    if (existing && existing.universal && item.universal && s !== slot) {
      if (BOOSTER_SLOT_XP_SKILL[s] === BOOSTER_SLOT_XP_SKILL[slot]) {
        return { ok:false, reason:"category-conflict" };
      }
    }
  }
  return { ok:true };
}

/* ----------------------------------------------------------------
   有效目标检测：通过真实已安装装备判断
   ---------------------------------------------------------------- */
function checkBoosterValidTarget(state, item) {
  if (!item) return true;
  // 采矿 / 考古增强剂永远有有效目标
  if (item.effectType === "miningSpeed" || item.effectType === "doubleMineral" ||
      item.effectType === "archaeologySpeed" || item.effectType === "rareShift") {
    return true;
  }
  // 考古重制（Phase B）：四类生产增强剂始终有有效目标（采气/冶炼/舰船/增强剂制造恒在）
  if (item.effectType === "gasSpeed" || item.effectType === "gasDouble" ||
      item.effectType === "smeltSpeed" || item.effectType === "smeltDouble" ||
      item.effectType === "shipSpeed" || item.effectType === "shipMaterialDiscount" ||
      item.effectType === "equipmentSpeed" || item.effectType === "skillLevelBonus" ||
      item.effectType === "boosterSpeed" || item.effectType === "boosterDouble") {
    return true;
  }
  // 战斗武器增强剂：需当前舰船有对应武器类型
  if (item.effectType === "damageMultiplier") {
    if (!item.weaponType) return true;
    if (typeof getInstalledCombatModulesFromState !== "function") return true;
    const modules = getInstalledCombatModulesFromState(state);
    return modules.some(function(m) {
      return m && m.combat && m.combat.kind === "weapon" && m.combat.weaponType === item.weaponType;
    });
  }
  // 战斗维修增强剂：需当前舰船有对应主动维修器
  if (item.effectType === "repairAmount") {
    if (!item.repairTarget) return true;
    if (typeof getInstalledCombatModulesFromState !== "function") return true;
    const modules = getInstalledCombatModulesFromState(state);
    return modules.some(function(m) {
      return m && m.combat && m.combat.kind === "repair" && m.combat.target === item.repairTarget;
    });
  }
  return true;
}

/* ----------------------------------------------------------------
   时间消耗纯计算（不修改任何状态）
   逐瓶事件：每瓶分别触发 consumed → autoRefilled，最后无库存时 consumed → depleted。
   返回值：{ entry: {itemId, remainingMs} | null, consumed:number, depleted:boolean, events:array }
   events 元素含 type 和可选 fromInventory（autoRefilled 时为 1）。
   ---------------------------------------------------------------- */
function calculateBoosterTimeConsumption(entry, elapsedMs, invCount) {
  if (!entry || typeof entry !== "object" || !entry.itemId) {
    return { entry:null, consumed:0, depleted:false, events:[] };
  }
  if (!(elapsedMs > 0)) {
    return { entry:{ itemId:entry.itemId, remainingMs:entry.remainingMs || 0 }, consumed:0, depleted:false, events:[] };
  }
  var DUR = typeof BOOSTER_DURATION_MS === "number" ? BOOSTER_DURATION_MS : 180000;
  var itemId = entry.itemId;
  var remaining = Number(entry.remainingMs);
  if (!Number.isFinite(remaining) || remaining <= 0) remaining = 0;
  var inv = Math.max(0, Math.floor(Number(invCount) || 0));

  // 当前瓶未耗尽
  if (elapsedMs < remaining) {
    return { entry:{ itemId:itemId, remainingMs:remaining - elapsedMs }, consumed:0, depleted:false, events:[] };
  }

  // 当前瓶耗尽
  var events = [{ type:"booster:consumed" }];
  var need = elapsedMs - remaining;  // 当前瓶耗尽后仍需覆盖的时间
  var consumed = 0;

  // 逐瓶从库存补充
  while (need > 0) {
    if (inv <= 0) {
      // 库存耗尽
      events.push({ type:"booster:depleted" });
      return { entry:null, consumed:consumed, depleted:true, events:events };
    }
    inv--;
    consumed++;

    if (need >= DUR) {
      // 这瓶也被完整消耗
      events.push({ type:"booster:autoRefilled", fromInventory:1 });
      events.push({ type:"booster:consumed" });
      need -= DUR;
    } else {
      // 这瓶覆盖剩余时间
      events.push({ type:"booster:autoRefilled", fromInventory:1 });
      var newRemaining = DUR - need;
      return { entry:{ itemId:itemId, remainingMs:newRemaining }, consumed:consumed, depleted:false, events:events };
    }
  }

  // need == 0：当前瓶恰好耗尽，无需更多时间
  // 尝试自动续瓶（如果有库存）
  if (inv > 0) {
    inv--;
    consumed++;
    events.push({ type:"booster:autoRefilled", fromInventory:1 });
    return { entry:{ itemId:itemId, remainingMs:DUR }, consumed:consumed, depleted:false, events:events };
  }
  // 无库存可续
  events.push({ type:"booster:depleted" });
  return { entry:null, consumed:consumed, depleted:true, events:events };
}

/* ----------------------------------------------------------------
   时间消耗应用（修改状态 + 发出事件）
   opts.offline: 离线结算时为 true，事件带 offline:true
   ---------------------------------------------------------------- */
function applyBoosterTimeConsumption(state, slot, elapsedMs, now, opts) {
  var active = getActiveBoosterState(state);
  var entry = active[slot];
  if (!entry || !entry.itemId) return { consumed:0, depleted:false, events:[] };
  var itemId = entry.itemId;
  var inv = ResourceRegistry.get(state, itemId);
  var offline = !!(opts && opts.offline);
  var result = calculateBoosterTimeConsumption(entry, elapsedMs, inv);

  // 应用状态变更
  if (result.consumed > 0) {
    ResourceRegistry.spend(state, itemId, result.consumed);
  }
  if (result.depleted) {
    active[slot] = null;
  } else if (result.entry) {
    active[slot] = {
      itemId: result.entry.itemId,
      remainingMs: result.entry.remainingMs
    };
  } else {
    active[slot] = null;
  }
  state._dirty = true;

  // 发出事件（填充 slot 等上下文字段）
  var emitted = [];
  for (var i = 0; i < result.events.length; i++) {
    var ev = result.events[i];
    var payload;
    switch (ev.type) {
      case "booster:consumed":
        payload = { slot:slot, itemId:itemId };
        break;
      case "booster:autoRefilled":
        payload = { slot:slot, itemId:itemId, fromInventory:1 };
        break;
      case "booster:depleted":
        payload = { slot:slot, itemId:itemId };
        break;
      default:
        continue;
    }
    if (typeof GameEvents !== "undefined") {
      var eventObj = GameEvents.emit(ev.type, payload, {
        offline:offline,
        source: offline ? "offline-booster" : "booster-timer"
      });
      emitted.push(eventObj);
    }
  }
  return { consumed:result.consumed, depleted:result.depleted, events:emitted };
}

/* ----------------------------------------------------------------
   在线计时：每 gameTick 调用，推进六槽时间
   必须在 gameTick 顶部调用，确保 lastTick 每个 tick 都推进。
   ---------------------------------------------------------------- */
function tickBoosterTimers(state, now) {
  var boosters = state.boosters;
  if (!boosters) return;
  var lastTick = Number(boosters.lastTick) || now;
  var elapsed = now - lastTick;
  if (!(elapsed > 0)) { boosters.lastTick = now; return; }
  if (elapsed > 60000) elapsed = 60000; // 安全夹紧（正常在线 tick ≈1s）

  var action = state.currentAction;
  var running = (action && action.active) ? action.skill : null;

  var runMining = false, runArch = false, runCombat = false;
  var runGas = false, runSmelt = false, runShip = false, runEquipment = false, runBooster = false;

  if (running === "mining") {
    var area = (typeof getRunningMiningArea === "function") ? getRunningMiningArea() : null;
    var canMine = area && (typeof canMineArea === "function") && canMineArea(area);
    runMining = canMine;
  } else if (running === "archaeology") {
    var arch = state.archaeology;
    if (arch) {
      // 按舰船实例隔离的维修态：仅当前考古舰实例维修中才阻断增强剂计时。
      var archInstId = (state.shipAssignments && state.shipAssignments.archaeology) || null;
      var archRepair = arch.repairsByInstanceId && archInstId ? arch.repairsByInstanceId[archInstId] : null;
      runArch = (!archRepair || Number(archRepair.until) <= now) &&
                (!arch.interferenceUntil || arch.interferenceUntil <= now);
    }
  } else if (running === "combat") {
    runCombat = Boolean(state.combat && state.combat.active);
  } else if (running === "gasHarvesting") {
    runGas = true;
  } else if (running === "refining") {
    runSmelt = true;
  } else if (running === "shipEngineering") {
    runShip = true;
  } else if (running === "equipmentEngineering") {
    runEquipment = true;
  } else if (running === "boosterEngineering") {
    runBooster = true;
  }

  if (runMining) {
    applyBoosterTimeConsumption(state, "miningSpeed", elapsed, now);
    applyBoosterTimeConsumption(state, "miningYield", elapsed, now);
  }
  if (runArch) {
    applyBoosterTimeConsumption(state, "archaeologySpeed", elapsed, now);
    applyBoosterTimeConsumption(state, "archaeologyRare", elapsed, now);
  }
  if (runCombat) {
    applyBoosterTimeConsumption(state, "combatWeapon", elapsed, now);
    applyBoosterTimeConsumption(state, "combatRepair", elapsed, now);
  }
  // 考古重制（Phase B）：四类生产增强剂在线计时（考古蓝图产出）。
  if (runGas) {
    applyBoosterTimeConsumption(state, "gasSpeed", elapsed, now);
    applyBoosterTimeConsumption(state, "gasYield", elapsed, now);
  }
  if (runSmelt) {
    applyBoosterTimeConsumption(state, "smeltSpeed", elapsed, now);
    applyBoosterTimeConsumption(state, "smeltYield", elapsed, now);
  }
  if (runShip) {
    applyBoosterTimeConsumption(state, "shipSpeed", elapsed, now);
    applyBoosterTimeConsumption(state, "shipYield", elapsed, now);
  }
  if (runEquipment) {
    applyBoosterTimeConsumption(state, "equipmentSpeed", elapsed, now);
    applyBoosterTimeConsumption(state, "equipmentYield", elapsed, now);
    // 方案1：精密配给剂（shipYield）为舰船/装备制造通用减料瓶，装备工程运行时也消耗其计时
    applyBoosterTimeConsumption(state, "shipYield", elapsed, now);
  }
  if (runBooster) {
    applyBoosterTimeConsumption(state, "boosterSpeed", elapsed, now);
    applyBoosterTimeConsumption(state, "boosterYield", elapsed, now);
  }
  // 无论是否消耗，lastTick 必须推进（防止恢复后追扣）
  boosters.lastTick = now;
}

/* ----------------------------------------------------------------
   效果聚合（纯函数，读取 state.boosters.active 合成乘区）
   返回：
     miningSpeedMultiplier    number
     doubleMineralChance      number
     archaeologySpeedMultiplier number
     rareShiftMultiplier      number
     weaponDamageMultiplier   { laser, missile, cannon }
     repairMultiplier         { shield, armor, structure }
     activeEntries            { [slot]: { itemId, name, quality, effectType, effectValue, remainingMs } }
   ---------------------------------------------------------------- */
// 临时技能等级（技能超载催化器）：基础等级 + 当前生效的 skillLevelBySkill[技能]；离线/在线共用同一入口。
// 所有"采集制造"技能的等级门槛/效率读取都应走此函数，确保增强剂起效期间可制造更高级道具。
// 作用域按槽位：装在哪个槽，仅该槽对应技能获得临时等级；多瓶取 MAX（同一技能内），不跨技能叠加。
function getEffectiveSkillLevel(state, key) {
  var g = (state && state.skills) ? state : ((typeof gameState !== "undefined") ? gameState : null);
  if (!g || !g.skills) return 1;
  var base = (g.skills[key] && Number(g.skills[key].lvl)) || 1;
  var bonus = 0;
  if (typeof getBoosterEffectState === "function") {
    var eff = getBoosterEffectState(g);
    bonus = Number(eff.skillLevelBySkill && eff.skillLevelBySkill[key]) || 0;
  }
  return base + bonus;
}

function getBoosterEffectState(state) {
  var active = getActiveBoosterState(state);
  var eff = {
    miningSpeedMultiplier: 1,
    doubleMineralChance: 0,
    archaeologySpeedMultiplier: 1,
    rareShiftMultiplier: 1,
    weaponDamageMultiplier: { laser:1, missile:1, cannon:1 },
    repairMultiplier: { shield:1, armor:1, structure:1 },
    // 考古重制（Phase B）：四类生产增强剂乘区（考古蓝图产出，在线/离线共用）。
    gasSpeedMultiplier: 1,
    doubleGasChance: 0,
    smeltSpeedMultiplier: 1,
    doubleSmeltChance: 0,
    shipSpeedMultiplier: 1,
    equipmentSpeedMultiplier: 1,
    shipMaterialDiscount: 0,
    shipMaterialLevelGate: 0,
    shipMaterialRoundDown: false,
    equipMaterialDiscount: 0,
    equipMaterialLevelGate: 0,
    equipMaterialRoundDown: false,
    // 技能超载催化器：仅装在对应槽位的技能获得临时等级；键为该技能的技能键。
    skillLevelBySkill: { mining:0, gasHarvesting:0, refining:0, shipEngineering:0, equipmentEngineering:0, boosterEngineering:0, archaeology:0 },
    boosterSpeedMultiplier: 1,
    doubleBoosterChance: 0,
    // 技能训练（神经训练催化器 · 经验茶模型）：按技能分桶的技能经验乘区，
    // 神经增强剂装在哪类槽，只加成该桶（与 rig 的 skillXpBonus 独立相乘）。
    skillXpMultBySkill: { mining:1, archaeology:1, gasHarvesting:1, refining:1, shipEngineering:1, equipmentEngineering:1, boosterEngineering:1, combat:1 },
    activeEntries: {}
  };
  var slots = (Array.isArray(BOOSTER_SLOTS) ? BOOSTER_SLOTS : []);
  for (var i = 0; i < slots.length; i++) {
    var slot = slots[i];
    var entry = active[slot];
    if (!entry || !entry.itemId) continue;
    var item = getBoosterItemFromState(null, entry.itemId);
    if (!item) continue;
    var remainingMs = Number(entry.remainingMs);
    if (!(remainingMs > 0)) continue;
    eff.activeEntries[slot] = {
      itemId: item.id,
      name: item.name,
      quality: item.quality,
      effectType: item.effectType,
      effectValue: item.effectValue,
      remainingMs: remainingMs
    };
    switch (item.effectType) {
      case "miningSpeed":
        eff.miningSpeedMultiplier *= (1 + Number(item.effectValue));
        break;
      case "doubleMineral": {
        var val = Number(item.effectValue) || 0;
        if (val > eff.doubleMineralChance) eff.doubleMineralChance = val;
        break;
      }
      case "archaeologySpeed":
        eff.archaeologySpeedMultiplier *= (1 + Number(item.effectValue));
        break;
      case "rareShift":
        eff.rareShiftMultiplier *= Number(item.effectValue) || 1;
        break;
      case "damageMultiplier":
        if (item.weaponType && item.weaponType in eff.weaponDamageMultiplier) {
          eff.weaponDamageMultiplier[item.weaponType] *= (1 + Number(item.effectValue));
        }
        break;
      case "repairAmount":
        if (item.repairTarget && item.repairTarget in eff.repairMultiplier) {
          eff.repairMultiplier[item.repairTarget] *= (1 + Number(item.effectValue));
        }
        break;
      // 考古重制（Phase B）：四类生产增强剂（考古蓝图产出）。
      case "gasSpeed":
        eff.gasSpeedMultiplier *= (1 + Number(item.effectValue));
        break;
      case "gasDouble": {
        var gv = Number(item.effectValue) || 0;
        if (gv > eff.doubleGasChance) eff.doubleGasChance = gv;
        break;
      }
      case "smeltSpeed":
        eff.smeltSpeedMultiplier *= (1 + Number(item.effectValue));
        break;
      case "smeltDouble": {
        var sv = Number(item.effectValue) || 0;
        if (sv > eff.doubleSmeltChance) eff.doubleSmeltChance = sv;
        break;
      }
      case "shipSpeed":
        eff.shipSpeedMultiplier *= (1 + Number(item.effectValue));
        break;
      case "equipmentSpeed":
        eff.equipmentSpeedMultiplier *= (1 + Number(item.effectValue));
        break;
      case "shipMaterialDiscount": {
        // 按槽位作用域拆分：ship 槽(shipSpeed/shipYield)只影响舰船制造，
        // equipment 槽(equipmentSpeed/equipmentYield)只影响装备制造；
        // 避免装在装备槽却抬升舰船制造门槛、或在舰船界面卸载后门槛仍残留。
        var dv = Number(item.effectValue) || 0;
        var lg = Number(item.levelGate) || 0;
        var grp = (slot === "shipSpeed" || slot === "shipYield") ? "ship" : "equip";
        if (dv > eff[grp + "MaterialDiscount"]) {
          eff[grp + "MaterialDiscount"] = dv;
          eff[grp + "MaterialRoundDown"] = item.quality === "r" || item.quality === "l";
        }
        if (lg > eff[grp + "MaterialLevelGate"]) eff[grp + "MaterialLevelGate"] = lg;
        break;
      }
      case "skillLevelBonus": {
        // 按槽位作用域：装在哪个槽，仅该槽对应技能获得临时等级（与神经增强剂的经验茶模型同构）。
        var sB = Number(item.effectValue) || 0;
        var sSkill = BOOSTER_SLOT_XP_SKILL[slot];
        if (sSkill && eff.skillLevelBySkill[sSkill] !== undefined) {
          if (sB > eff.skillLevelBySkill[sSkill]) eff.skillLevelBySkill[sSkill] = sB;
        }
        break;
      }
      case "boosterSpeed":
        eff.boosterSpeedMultiplier *= (1 + Number(item.effectValue));
        break;
      case "boosterDouble": {
        var bv = Number(item.effectValue) || 0;
        if (bv > eff.doubleBoosterChance) eff.doubleBoosterChance = bv;
        break;
      }
      case "skillXpMultiplier": {
        // 经验茶模型：神经增强剂装在哪类槽，只加成该类行动经验（slot→skill 作用域化）。
        var xpSkill = BOOSTER_SLOT_XP_SKILL[slot];
        if (xpSkill && eff.skillXpMultBySkill[xpSkill] !== undefined) {
          eff.skillXpMultBySkill[xpSkill] *= (1 + Number(item.effectValue));
        }
        break;
      }
    }
  }
  // 战斗神经加成广播：神经增强剂装在 combatWeapon/combatRepair 槽，写入
  // skillXpMultBySkill["combat"]；但 state.skills 中不存在 "combat" 主键，战斗经验
  // 实际加在白名单子技能上（见 COMBAT_XP_SKILL_KEYS）。把 "combat" 桶乘区广播到全部
  // 战斗子技能键，使在线/离线战斗经验正确吃到神经加成。rig 改装件 rig_skill_xp 不含
  // 战斗子技能，不会误加 rig 加成。
  var combatMult = Number(eff.skillXpMultBySkill.combat) || 1;
  if (combatMult !== 1) {
    for (var c = 0; c < COMBAT_XP_SKILL_KEYS.length; c++) {
      var ck = COMBAT_XP_SKILL_KEYS[c];
      var cur = Number(eff.skillXpMultBySkill[ck]) || 1;
      eff.skillXpMultBySkill[ck] = cur * combatMult;
    }
  }
  return eff;
}

/* ----------------------------------------------------------------
   纯函数：双倍矿物一次性骰子
   返回 true/false；不修改任何状态
   ---------------------------------------------------------------- */
function rollDoubleMineral(chance, randomFn) {
  if (!(chance > 0)) return false;
  var rng = typeof randomFn === "function" ? randomFn : Math.random;
  return rng() < chance;
}

/* ----------------------------------------------------------------
   纯函数：考古稀有率（相对倍率×baseUniqueRate，上限 0.99）
   ---------------------------------------------------------------- */
function getBoosterArchaeologyEffectiveUniqueRate(baseUniqueRate, rareShiftMultiplier) {
  var mult = Number(rareShiftMultiplier);
  if (!(mult > 0)) return baseUniqueRate;
  return Math.min(0.99, baseUniqueRate * mult);
}

/* ----------------------------------------------------------------
   舰船材料折扣（考古重制 Phase B · precision_rationing 系列）
   返回材料实际倍率（1 - discount），供在线/离线舰船组件制造扣料使用。
   ---------------------------------------------------------------- */
function getShipMaterialDiscountMultiplier(state) {
  var eff = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(state) : null;
  var discount = (eff && typeof eff.shipMaterialDiscount === "number") ? eff.shipMaterialDiscount : 0;
  if (!(discount > 0)) return 1;
  if (discount > 0.95) discount = 0.95; // 安全夹紧，材料倍率不低于 0.05
  return 1 - discount;
}

// 对成本表 { mat:qty } 按倍率缩放，逐条目向下取整且至少保留 1（单件材料不免费）。
function discountCost(cost, mult) {
  if (!cost || typeof cost !== "object" || !(mult > 0) || mult >= 1) return cost;
  var out = {};
  for (var mat in cost) {
    if (!Object.prototype.hasOwnProperty.call(cost, mat)) continue;
    var q = Math.floor(Number(cost[mat]) * mult);
    if (!(q >= 1)) q = 1;
    out[mat] = q;
  }
  return out;
}

/* ----------------------------------------------------------------
   精密配给剂（precision_rationing）统一报价 / 门槛函数（考古重制 Phase B）
   激活期间（getBoosterEffectState().shipMaterialDiscount > 0）：
     - 组件 / 总装真实材料成本按当前品质折扣计算（逐条向上取整，单件至少 1）
     - 配方等级门槛 +5
   覆盖在线 / 离线 / 队列 / intship 四类调用点（队列与 intship 复用同一制造描述符）。
   增强剂耗尽后 effectState 归零，本函数实时读状态，下一原子周期自动恢复原成本原门槛。
   kind: "component" 取 recipe.cost；"assembly" 取 recipe.materialCost（组件为生产物，非折扣材料）。
   ---------------------------------------------------------------- */
function getShipBuildingQuote(state, recipe, context) {
  if (!recipe) return { cost: {}, levelGate: 0, discounted: false };
  var eff = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(state) : null;
  var active = !!(eff && eff.shipMaterialDiscount > 0);
  var kind = (context && context.kind) === "assembly" ? "assembly" : "component";
  var baseCost = (kind === "assembly") ? (recipe.materialCost || {}) : (recipe.cost || {});
  var cost;
  if (active) {
    cost = {};
    for (var mat in baseCost) {
      if (!Object.prototype.hasOwnProperty.call(baseCost, mat)) continue;
      var discount = Number(eff.shipMaterialDiscount) || 0;
      if (discount > 0.95) discount = 0.95;
      var raw = Number(baseCost[mat]) * (1 - discount);
      var c = eff.shipMaterialRoundDown ? Math.floor(raw) : Math.ceil(raw);
      if (!(c >= 1)) c = 1;
      cost[mat] = c;
    }
  } else {
    cost = baseCost;
  }
  // 军团 NPC「舰材回收(shipComponentCostReduce)」：在（已含增强剂折扣后）的 cost 上再按比例减免，
  // 每个材料最低保留 1（不破下限）。确定性余数机制由 getShipyardProductionQuote 内部处理，这里只降基数。
  if (typeof LEGION_NPC !== "undefined" && typeof LEGION_NPC.getLegionContributionSnapshot === "function") {
    const mult = LEGION_NPC.getLegionContributionSnapshot(state).multipliers.shipComponentCost;
    if (mult && mult < 1) {
      const reduced = {};
      for (const mat in cost) {
        if (!Object.prototype.hasOwnProperty.call(cost, mat)) continue;
        const v = Math.max(1, Math.ceil(cost[mat] * mult));
        reduced[mat] = v;
      }
      cost = reduced;
    }
  }
  // 技能超载(skillLevelBonus)的临时等级由 getEffectiveSkillLevel 在「玩家侧」体现，
  // 不得再加入门槛，否则与玩家等级加成相互抵消、跨不过门槛（用户反馈 bug）。
  // 门槛仅受舰船槽精密配给剂的 shipMaterialLevelGate 影响（装备槽不抬升舰船门槛）。
  var gateBonus = eff ? (eff.shipMaterialLevelGate || 0) : 0;
  var levelGate = (Number(recipe.level) || 0) + gateBonus;
  return { cost: cost, levelGate: levelGate, discounted: active || (typeof LEGION_NPC !== "undefined") };
}

/* ----------------------------------------------------------------
   装备工程报价（镜像 getShipBuildingQuote，考古重制 Phase B · 精密配给剂通用化）
   激活期间（getBoosterEffectState().equipMaterialDiscount > 0，来源即精工/传奇·精密配给剂装在装备槽）：
     - 配方材料成本按当前品质折扣计算（逐条向上取整，单件至少 1）
     - 配方等级门槛 + equipMaterialLevelGate
   装备无军团材料减耗键（军团对装备仅有速度乘数 equipmentManufacturingSpeed），故不叠 LEGION 成本减免。
   覆盖在线 / 离线 / 队列 / 空间站自动线四类调用点（与舰船同构）。
   ---------------------------------------------------------------- */
function getEquipEngBuildingQuote(state, recipe) {
  if (!recipe) return { cost: {}, levelGate: 0, discounted: false };
  var eff = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(state) : null;
  var active = !!(eff && eff.equipMaterialDiscount > 0);
  var baseCost = recipe.cost || {};
  var cost;
  if (active) {
    cost = {};
    for (var mat in baseCost) {
      if (!Object.prototype.hasOwnProperty.call(baseCost, mat)) continue;
      var discount = Number(eff.equipMaterialDiscount) || 0;
      if (discount > 0.95) discount = 0.95;
      var raw = Number(baseCost[mat]) * (1 - discount);
      var c = eff.equipMaterialRoundDown ? Math.floor(raw) : Math.ceil(raw);
      if (!(c >= 1)) c = 1;
      cost[mat] = c;
    }
  } else {
    cost = baseCost;
  }
  // 同上：技能超载临时等级在玩家侧(getEffectiveSkillLevel)体现，门槛不得再加。
  // 门槛仅受装备槽精密配给剂的 equipMaterialLevelGate 影响（舰船槽不抬升装备门槛）。
  var gateBonus = eff ? (eff.equipMaterialLevelGate || 0) : 0;
  var levelGate = (Number(recipe.level) || 0) + gateBonus;
  return { cost: cost, levelGate: levelGate, discounted: active };
}

/* ----------------------------------------------------------------
   槽位状态判定（用于 UI 显示）
   返回："active" | "paused" | "no-target" | "depleted"
   ---------------------------------------------------------------- */
function getBoosterSlotStatus(state, slot, item, remainingMs, now) {
  if (!(remainingMs > 0)) return "depleted";
  // 检查有效目标
  if (!checkBoosterValidTarget(state, item)) return "no-target";
  // 检查行动是否运行且本槽相关
  var action = state.currentAction;
  var running = action && action.active ? action.skill : null;
  var relevantSlots = getActionBoosterSlots(running);
  // 精密配给剂（shipYield）为舰船/装备制造通用减料瓶：舰船或装备运行时均视为相关槽
  var relevantBySharedDiscount = (slot === "shipYield") && (running === "shipEngineering" || running === "equipmentEngineering");
  if (!relevantBySharedDiscount && (!relevantSlots.indexOf || relevantSlots.indexOf(slot) < 0)) return "paused";
  // 行动运行中，检查是否暂停
  if (running === "mining") {
    var area = (typeof getRunningMiningArea === "function") ? getRunningMiningArea() : null;
    var canMine = area && (typeof canMineArea === "function") && canMineArea(area);
    if (!canMine) return "paused";
  } else if (running === "archaeology") {
    var arch2 = state.archaeology;
    if (arch2) {
      var archInstId2 = (state.shipAssignments && state.shipAssignments.archaeology) || null;
      var archRepair2 = arch2.repairsByInstanceId && archInstId2 ? arch2.repairsByInstanceId[archInstId2] : null;
      if ((archRepair2 && Number(archRepair2.until) > now) || (arch2.interferenceUntil && arch2.interferenceUntil > now)) return "paused";
    }
  } else if (running === "combat") {
    if (!state.combat || !state.combat.active) return "paused";
  }
  return "active";
}

/* ----------------------------------------------------------------
   显示态（UI 消费）
   ---------------------------------------------------------------- */
function getBoosterDisplayState(state, now) {
  var active = getActiveBoosterState(state);
  var effect = getBoosterEffectState(state);
  var groups = {
    equipment: { label:"\u88c5\u5907\u5de5\u7a0b", slots:["equipmentSpeed","equipmentYield"] },
    mining:   { label:"采矿",   slots:["miningSpeed","miningYield"] },
    archaeology: { label:"考古", slots:["archaeologySpeed","archaeologyRare"] },
    combat:   { label:"战斗",   slots:["combatWeapon","combatRepair"] },
    // 考古重制（Phase B）：四类生产增强剂分组（考古蓝图产出）。
    gas:      { label:"采气",   slots:["gasSpeed","gasYield"] },
    refining: { label:"冶炼",   slots:["smeltSpeed","smeltYield"] },
    ship:     { label:"舰船工程", slots:["shipSpeed","shipYield"] },
    booster:  { label:"增强剂制造", slots:["boosterSpeed","boosterYield"] }
  };
  var result = { effect:effect, activeSlots:{}, groups:[] };
  for (var groupKey in groups) {
    var group = groups[groupKey];
    var items = group.slots.map(function(slot) {
      var entry = active[slot];
      var display = { slot:slot, empty:true };
      if (entry && entry.itemId) {
        var item = getBoosterItemFromState(null, entry.itemId);
        if (item) {
          var remainingMs = Number(entry.remainingMs) || 0;
          var inv = (typeof ResourceRegistry !== "undefined")
            ? ResourceRegistry.get(state, item.itemId) : 0;
          var remainingSec = Math.ceil(remainingMs / 1000);
          var mm = Math.floor(remainingSec / 60);
          var ss = remainingSec % 60;
          var status = getBoosterSlotStatus(state, slot, item, remainingMs, now || Date.now());
          display = {
            slot:slot, empty:false,
            itemId: item.id,
            name: item.name,
            quality: item.quality,
            qualityName: item.qualityName || "",
            effectText: (typeof describeBoosterEffect === "function")
              ? describeBoosterEffect(item.effectType, item.effectValue, null, item.levelGate, getSkillLabelForSlot(slot)) : "",
            remainingMs: remainingMs,
            remainingText: (remainingMs > 0) ? (mm + ":" + String(ss).padStart(2, "0")) : "耗尽",
            inventory: inv,
            active: status === "active",
            status: status,
            statusText: {
              "active": "生效中",
              "paused": "已装载 · 行动暂停",
              "no-target": "已装载 · 当前配置无有效目标",
              "depleted": "已耗尽"
            }[status] || "已耗尽",
            effectType: item.effectType,
            effectValue: item.effectValue,
            weaponType: item.weaponType || null,
            repairTarget: item.repairTarget || null,
            validTarget: checkBoosterValidTarget(state, item)
          };
        }
      }
      return display;
    });
    result.groups.push({ key:groupKey, label:group.label, slots:items });
  }
  return result;
}

/* ----------------------------------------------------------------
   离线分段结算辅助：获取某槽增强剂的总剩余秒数（当前瓶 + 库存）
   ---------------------------------------------------------------- */
function getBoosterTotalRemainingSeconds(state, slot) {
  var entry = getActiveBoosterState(state)[slot];
  if (!entry || !entry.itemId) return 0;
  var inv = ResourceRegistry.get(state, entry.itemId);
  var DUR_S = (typeof BOOSTER_DURATION_MS === "number" ? BOOSTER_DURATION_MS : 180000) / 1000;
  var remainingS = (Number(entry.remainingMs) || 0) / 1000;
  return remainingS + Math.max(0, Math.floor(inv)) * DUR_S;
}

/* ----------------------------------------------------------------
   离线结算（分段）
   将离线时间按增强剂耗尽点分段，每段用当前效果结算行动，
   再扣增强剂时间。库存耗尽后剩余时间按无增强剂倍率结算。
   elapsedMs = 离线期间该行动实际运行的毫秒数
   skillKey = "mining" | "archaeology" | null（combat 不结算）
   注意：此函数仅扣增强剂时间，不结算行动（行动结算由 offline.js 负责）
   ---------------------------------------------------------------- */
function settleOfflineBoosters(state, elapsedMs, skillKey) {
  var slots = getActionBoosterSlots(skillKey);
  if (!slots.length || !(elapsedMs > 0)) return false;
  for (var i = 0; i < slots.length; i++) {
    applyBoosterTimeConsumption(state, slots[i], elapsedMs, Date.now(), { offline:true });
  }
  if (state.boosters) state.boosters.lastTick = Date.now();
  return true;
}

/* ----------------------------------------------------------------
   挂 window（普通 script 全局加载约定）
   ---------------------------------------------------------------- */
window.getBoosterItemFromState = getBoosterItemFromState;
window.getActiveBoosterState = getActiveBoosterState;
window.normalizeActiveBoosterEntry = normalizeActiveBoosterEntry;
window.getActionBoosterSlots = getActionBoosterSlots;
window.isBoosterCompatibleWithSlot = isBoosterCompatibleWithSlot;
window.canEquipBooster = canEquipBooster;
window.checkBoosterValidTarget = checkBoosterValidTarget;
window.calculateBoosterTimeConsumption = calculateBoosterTimeConsumption;
window.applyBoosterTimeConsumption = applyBoosterTimeConsumption;
window.tickBoosterTimers = tickBoosterTimers;
window.getBoosterEffectState = getBoosterEffectState;
window.getEffectiveSkillLevel = getEffectiveSkillLevel;
window.rollDoubleMineral = rollDoubleMineral;
window.getBoosterArchaeologyEffectiveUniqueRate = getBoosterArchaeologyEffectiveUniqueRate;
window.getShipMaterialDiscountMultiplier = getShipMaterialDiscountMultiplier;
window.getShipBuildingQuote = getShipBuildingQuote;
window.getEquipEngBuildingQuote = getEquipEngBuildingQuote;
window.discountCost = discountCost;
window.getBoosterDisplayState = getBoosterDisplayState;
window.getBoosterSlotStatus = getBoosterSlotStatus;
window.getBoosterTotalRemainingSeconds = getBoosterTotalRemainingSeconds;
window.settleOfflineBoosters = settleOfflineBoosters;
window.getSkillLabelForSlot = getSkillLabelForSlot;
