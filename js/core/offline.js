/* ================================================================
   离线收益计算
   ================================================================ */

const MAX_OFFLINE_SECONDS = 86400;
let _offlineEventBatch = null;
// 全局单调批次序号：保证同一毫秒内多次独立结算生成的 runId 全局唯一，
// 避免不同批次的事件拿到相同 eventId、被通配消费者（onIdempotent）误判为重复而丢弃真实结算记账。
// eventId 格式仍为 runId:sequence:type；调用方显式传入的 runId 原样保留。
let _offlineBatchSeq = 0;
// 离线结算·资源调度中心（勘探指令）加成收集：供结算弹窗拆分为独立条目展示（不并入主矿/气卡）。
let _settlementDispatchBonus = [];

// 虚拟时间兼容入口：第三参 meta 可选；
// 1) 旧两参数调用（emitOfflineGameEvent(type, payload)）行为完全不变；
// 2) offline 永远为 true、source 默认仍为 "offline-settlement"；
// 3) runId/sequence/eventId 格式与唯一性完全不变（不得复制第二套事件号逻辑）；
// 4) meta.timestamp 为有限 number 时透传 GameEvents.emit（虚拟时间）；非法/缺失时保持原 Date.now() 回退。
function emitOfflineGameEvent(type, payload, meta) {
  const inputMeta = meta && typeof meta === "object" ? meta : {};
  const ts = Number.isFinite(Number(inputMeta.timestamp)) ? Number(inputMeta.timestamp) : undefined;
  const batch = _offlineEventBatch || { runId:"offline_" + Date.now().toString(36) + "_" + (++_offlineBatchSeq).toString(36), sequence:0 };
  batch.sequence++;
  const emitMeta = {
    offline:true,
    aggregate:Number(payload && payload.cycles) > 1,
    source:(typeof inputMeta.source === "string" && inputMeta.source) ? inputMeta.source : "offline-settlement",
    runId:batch.runId,
    eventId:batch.runId + ":" + batch.sequence + ":" + type
  };
  if (ts !== undefined) emitMeta.timestamp = ts;
  return GameEvents.emit(type, payload, emitMeta);
}

// Batch R（B 项）：离线收益改为持久结算弹窗。
// seconds = 离线秒数；gains = 8 计数器（各技能完成次数）；items = 结算前后 canonical
// 库存快照 diff 出的「最终净获得物品」（无则回退纯文字信息，兼容旧调用方）。
// 删除自动关闭计时：仅显式关闭按钮 / 点击背景 / Escape 可关闭。
function showOfflineToast(seconds, gains, items, combatSummary, consumed) {
  const min = Math.floor(seconds / 60); const sec = Math.floor(seconds % 60);
  const timeStr = min > 0 ? `${min} 分 ${sec} 秒` : `${sec} 秒`;
  const labels = {
    mining: "⛏ 采矿", refining: "🔥 冶炼", gasHarvesting: "☁️ 气体",
    equipmentEngineering: "🔧 装备工程", boosterEngineering: "💉 增强剂制造",
    shipEngineering: "🚀 舰船工程", planetaryIndustry: "🪐 行星",
    combat: "⚔️ 战斗"
  };
  const detail = Object.entries(labels)
    .filter(([key]) => (gains[key] || 0) > 0)
    .map(([key, label]) => `${label} +${gains[key]} 次`).join("  ");
  const consumedCount = Array.isArray(consumed) ? consumed.length : 0;
  const subtitle = `离线 ${timeStr}，已自动结算${detail ? "：" + detail : ""}` +
    (Array.isArray(items) && items.length ? ` · 获得 ${items.length} 类` : "") +
    (consumedCount ? ` · 消耗 ${consumedCount} 类` : "");
  // 离线战斗汇总：聚合 flush 返回的 payload（wavesByZone / zoneClearsByZone 为分区计数对象）
  let combat = null;
  if (combatSummary && typeof combatSummary === "object") {
    const sumObj = (o) => (o && typeof o === "object")
      ? Object.values(o).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
    const reason = combatSummary.stopReason;
    const warnReasons = ["ammo", "resources", "repairing", "level-locked", "no-weapons", "no-keys", "no-zone", "no-site", "queue-finalize-error"];
    combat = {
      waves: sumObj(combatSummary.wavesByZone),
      zoneClears: sumObj(combatSummary.zoneClearsByZone),
      kills: Number(combatSummary.kills) || 0,
      defeats: Number(combatSummary.defeats) || 0,
      maxWave: Number(combatSummary.maxWaveReached) || 0,
      stopReason: reason,
      warn: (Number(combatSummary.defeats) || 0) > 0 || warnReasons.indexOf(reason) >= 0
    };
  }
  if (typeof openRewardResultModal === "function") {
    openRewardResultModal({
      title:"⏳ 离线结算完成",
      subtitle,
      items:Array.isArray(items) ? items : [],
      consumed:Array.isArray(consumed) ? consumed : [],
      emptyText:detail ? "本次离线没有新增可展示物品" : "离线时长过短，未产生结算",
      combat
    });
    return;
  }
  // 兜底：共享弹窗未加载（极端缓存场景）时退回一次性文字提示，但不自动关闭（保持持久语义）
  const old = document.querySelector('.offline-toast'); if (old) old.remove();
  const toast = document.createElement("div"); toast.className = "offline-toast";
  toast.textContent = `⏳ 离线 ${timeStr}，已自动结算${detail ? "：" + detail : ""}`;
  document.body.appendChild(toast);
}

/* ---- Batch R（B 项）：canonical 库存快照 + 净获得 diff（只读，不改状态） ---- */
// 覆盖所有可离线获得/消耗的物品形态：ResourceRegistry 全部命名空间资源
// （ore/mineral/gas/planetary/moon/special/consumable/component/probe/booster/artifact/currency…）、
// 弹药实例（state.ammo 按 type|tier 聚合）、装备库存（inventory + 未安装 instances）、
// 舰船实例数、蓝图（ownedBlueprints）、货柜具名战利品（cargoLoot）、脑插（implants）。
function createInventorySnapshot(state) {
  const snap = { res:{}, ammo:{}, equipment:{}, ships:0, blueprints:{}, loot:{}, implants:{} };
  if (typeof ResourceRegistry !== "undefined" && ResourceRegistry && typeof ResourceRegistry.listDefinitions === "function") {
    for (const def of ResourceRegistry.listDefinitions()) {
      const q = ResourceRegistry.get(state, def.id);
      if (q > 0) snap.res[def.id] = q;
    }
  }
  if (Array.isArray(state.ammo)) {
    for (const a of state.ammo) {
      if (!a) continue;
      const key = (a.type || "?") + "|" + (a.tier || "?");
      snap.ammo[key] = (snap.ammo[key] || 0) + (Number(a.qty) || 0);
    }
  }
  const eqInv = state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  for (const itemId of eqInv) {
    if (typeof itemId === "string" && itemId) snap.equipment[itemId] = (snap.equipment[itemId] || 0) + 1;
  }
  if (state.equipment && Array.isArray(state.equipment.instances)) {
    for (const inst of state.equipment.instances) {
      if (!inst || inst.installedOn || typeof inst.itemId !== "string" || !inst.itemId) continue;
      snap.equipment[inst.itemId] = (snap.equipment[inst.itemId] || 0) + 1;
    }
  }
  // 按 shipId 聚合舰船数量（不只保存总数），使离线收益能列出具体舰型与数量。
  snap.ships = {};
  if (state.inventory && Array.isArray(state.inventory.ships)) {
    for (const ship of state.inventory.ships) {
      if (ship && typeof ship.shipId === "string") snap.ships[ship.shipId] = (snap.ships[ship.shipId] || 0) + 1;
    }
  }
  if (Array.isArray(state.ownedBlueprints)) {
    for (const key of state.ownedBlueprints) {
      if (typeof key === "string" && key) snap.blueprints[key] = (snap.blueprints[key] || 0) + 1;
    }
  }
  if (Array.isArray(state.cargoLoot)) {
    for (const loot of state.cargoLoot) {
      if (!loot) continue;
      const key = (typeof loot.id === "string" && loot.id) ? loot.id : (loot.name || "?");
      snap.loot[key] = { count:(snap.loot[key] ? snap.loot[key].count : 0) + 1, kind:loot.kind, name:loot.name };
    }
  }
  if (state.implants && typeof state.implants === "object" && !Array.isArray(state.implants)) {
    for (const id of Object.keys(state.implants)) if (state.implants[id]) snap.implants[id] = true;
  }
  return snap;
}

// 结算前后库存快照 diff：返回 { gained, consumed }。
// gained = 正差额（最终净获得）；consumed = 负差额（消耗 / 损失，quantity 取绝对值、带 consumed 标记）。
// 两者均输出 normalizeRewardItem / buildCargoCardHTML 兼容的条目，供结算弹窗分两个区分别展示。
// 关键：所有类别均取 before/after 键并集，保证「降到 0」的消耗（如离线把燃料烧光）也能被捕获，
// 而非因 after 中该键消失而被遗漏。
function diffInventorySnapshot(before, after) {
  const gained = [];
  const consumed = [];
  const source = { pageLabel:"离线收益" };
  const ammoTypeNames = (typeof AMMO_TYPE_NAMES !== "undefined" && AMMO_TYPE_NAMES) ? AMMO_TYPE_NAMES : { laser:"激光晶体弹药", missile:"导弹", cannon:"炮台弹药" };
  const eqDb = (typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB) ? EQUIPMENT_DB : null;
  const shipDb = (typeof getShipConfigById === "function") ? getShipConfigById : null;
  const impDb = (typeof IMPLANT_DB !== "undefined" && IMPLANT_DB) ? IMPLANT_DB : null;
  const resIcon = (id) => (id === "consumable:fuel" ? "⛽" : id === "consumable:repairPaste" ? "🩹" : id === "consumable:warpFuel" ? "🚀" : "");

  // 资源（燃料 / 矿石 / 矿物 / 气体 / 行星产物 …）
  const resKeys = new Set([...Object.keys(before.res || {}), ...Object.keys(after.res || {})]);
  for (const id of resKeys) {
    const delta = (after.res[id] || 0) - (before.res[id] || 0);
    const nm = (typeof getResourceDisplayName === "function") ? getResourceDisplayName(id) : id;
    if (delta > 0) gained.push({ id, name:nm, quantity:delta, categoryLabel:"物资", source });
    else if (delta < 0) consumed.push({ id, name:nm, quantity:-delta, consumed:true, categoryLabel:"物资", icon:resIcon(id), source });
  }

  // 弹药（按 type|tier 聚合）
  const ammoKeys = new Set([...Object.keys(before.ammo || {}), ...Object.keys(after.ammo || {})]);
  for (const key of ammoKeys) {
    const delta = (after.ammo[key] || 0) - (before.ammo[key] || 0);
    const sep = key.indexOf("|");
    const type = sep >= 0 ? key.slice(0, sep) : key;
    const tier = sep >= 0 ? key.slice(sep + 1) : "T1";
    const nm = (ammoTypeNames[type] || type) + (tier === "T2" ? "（T2）" : "");
    if (delta > 0) gained.push({ id:"ammo:" + key, ammo:true, weaponType:type, name:nm, quantity:delta, categoryLabel:"弹药", source });
    else if (delta < 0) consumed.push({ id:"ammo:" + key, ammo:true, weaponType:type, name:nm, quantity:-delta, consumed:true, categoryLabel:"弹药", source });
  }

  // 装备库存 / 未安装实例
  const eqKeys = new Set([...Object.keys(before.equipment || {}), ...Object.keys(after.equipment || {})]);
  for (const itemId of eqKeys) {
    const delta = (after.equipment[itemId] || 0) - (before.equipment[itemId] || 0);
    const nm = eqDb ? (eqDb[itemId] && eqDb[itemId].name ? eqDb[itemId].name : itemId) : itemId;
    if (delta > 0) gained.push({ id:itemId, name:nm, quantity:delta, categoryLabel:"装备", source });
    else if (delta < 0) consumed.push({ id:itemId, name:nm, quantity:-delta, consumed:true, categoryLabel:"装备", source });
  }

  // 舰船：按 shipId 逐项；减少视为「损失」（区别于材料消耗）
  const shipKeys = new Set([...Object.keys(before.ships || {}), ...Object.keys(after.ships || {})]);
  for (const shipId of shipKeys) {
    const delta = (after.ships[shipId] || 0) - (before.ships[shipId] || 0);
    const cfg = shipDb ? shipDb(shipId) : null;
    const nm = (cfg && cfg.name ? cfg.name : shipId);
    if (delta > 0) gained.push({ id:"ship:" + shipId, shipId, name:nm, quantity:delta, categoryLabel:"舰船", source });
    else if (delta < 0) consumed.push({ id:"ship:" + shipId, shipId, name:nm, quantity:-delta, consumed:true, categoryLabel:"损失", source });
  }

  // 蓝图
  const bpKeys = new Set([...Object.keys(before.blueprints || {}), ...Object.keys(after.blueprints || {})]);
  for (const key of bpKeys) {
    const delta = (after.blueprints[key] || 0) - (before.blueprints[key] || 0);
    let blueprintName = key;
    if (key.startsWith("equipment:") && eqDb) { const e = eqDb[key.slice("equipment:".length)]; if (e && e.name) blueprintName = e.name; }
    else if (key.startsWith("booster:") && typeof getBoosterRecipe === "function") { const r = getBoosterRecipe(key.slice("booster:".length)); if (r && r.name) blueprintName = r.name; }
    if (delta > 0) gained.push({ id:"blueprint:" + key, blueprint:true, name:blueprintName + "蓝图", quantity:delta, categoryLabel:"蓝图", source });
    else if (delta < 0) consumed.push({ id:"blueprint:" + key, blueprint:true, name:blueprintName + "蓝图", quantity:-delta, consumed:true, categoryLabel:"蓝图", source });
  }

  // 货柜具名战利品（按 id 聚合，count 差）
  const lootKeys = new Set([...Object.keys(before.loot || {}), ...Object.keys(after.loot || {})]);
  for (const key of lootKeys) {
    const aEntry = after.loot[key]; const bEntry = before.loot[key];
    const delta = (aEntry ? aEntry.count : 0) - (bEntry ? bEntry.count : 0);
    const kind = (aEntry && aEntry.kind) || (bEntry && bEntry.kind);
    const nm = (aEntry && aEntry.name) || (bEntry && bEntry.name) || key;
    if (delta > 0) gained.push({ id:"loot:" + key, loot:true, kind, name:nm, quantity:delta, categoryLabel:"战利品", source });
    else if (delta < 0) consumed.push({ id:"loot:" + key, loot:true, kind, name:nm, quantity:-delta, consumed:true, categoryLabel:"战利品", source });
  }

  // 脑插（布尔集合：新增即获得、消失即消耗）
  const impKeys = new Set([...Object.keys(before.implants || {}), ...Object.keys(after.implants || {})]);
  for (const id of impKeys) {
    const aHas = !!(after.implants && after.implants[id]);
    const bHas = !!(before.implants && before.implants[id]);
    const nm = impDb ? (impDb[id] && impDb[id].name ? impDb[id].name : id) : id;
    if (aHas && !bHas) gained.push({ id, implant:true, name:nm, quantity:1, categoryLabel:"脑插", source });
    else if (!aHas && bHas) consumed.push({ id, implant:true, name:nm, quantity:1, consumed:true, categoryLabel:"脑插", source });
  }

  return { gained, consumed };
}

// 离线结算·资源调度中心（勘探指令）加成：把并入主矿/气卡的调度加成拆分为独立条目展示，
// 并同步从主卡扣减，保证弹窗各卡「数量之和」== 真实库存净获得（不重复计数）。
// 仅作用于展示层：ResourceRegistry.add 仍加总量，库存不被改动。
function splitOfflineDispatchBonus(netItems) {
  if (!Array.isArray(netItems) || !_settlementDispatchBonus.length) return netItems;
  const extra = [];
  for (const e of _settlementDispatchBonus) {
    const nm = (typeof getResourceDisplayName === "function") ? getResourceDisplayName(e.resourceId) : e.resourceId;
    extra.push({
      id: "dispatch:" + e.resourceId,
      name: nm,
      icon: "🛰️",
      quantity: e.quantity,
      categoryLabel: "资源调度·勘探指令",
      source: { pageId: "station", pageLabel: "离线收益·调度加成" }
    });
    const idx = netItems.findIndex(it => it.id === e.resourceId);
    if (idx >= 0) {
      netItems[idx].quantity = Math.max(0, (Number(netItems[idx].quantity) || 0) - e.quantity);
    }
  }
  // 移除被扣减到 0 的主卡（避免显示 ×1 误导），再追加独立调度卡
  const filtered = netItems.filter(it => Number(it.quantity) > 0);
  for (const x of extra) filtered.push(x);
  return filtered;
}

function getMaxMaterialCycles(cost) {
  let cycles = Infinity;
  for (const [mat, qty] of Object.entries(cost || {})) {
    cycles = Math.min(cycles, Math.floor(getMaterialStock(mat) / qty));
  }
  return cycles;
}

function deductMatsMultiple(cost, cycles) {
  return ResourceRegistry.spendCost(gameState, cost, cycles);
}

function addOfflineSkillXp(skillKey, amount) {
  if (amount <= 0) return;
  // 复用在线统一钩子：job 默认取 skillKey（离线的三个生产技能 key 恰为 shipAssignments 的 job 键），
  // 从而离线同样享受「该船指派工作」的经验改装件加成 + 全局增强剂倍率。
  if (typeof addSkillXpToState === "function") {
    addSkillXpToState(gameState, skillKey, amount, { job: skillKey, offline:true, source:"offline-settlement" });
    return;
  }
  const skill = gameState.skills[skillKey];
  if (!skill) return;
  skill.xp += amount;
  checkLevelUp(skillKey, {
    offline:true,
    source:"offline-settlement",
    runId:_offlineEventBatch ? _offlineEventBatch.runId : null
  });
}

function getOfflineActionDescriptor() {
  const action = gameState.currentAction;
  const key = action.skill;
  // 增强剂效果聚合（考古重制 Phase B）：各分支 apply 用于双倍产出掷骰，离线/在线共用。
  const boosterEff = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(gameState) : null;

  if (key === "mining") {
    const areaName = action.startedArea || action.area;
    const area = getMiningAreaByName(areaName) || MINING_AREAS[0];
    if (!area || !canMineArea(area)) return null;
    const miningEff = getMiningEfficiency();
    const boosterEff = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(gameState) : null;
    const speedMult = (boosterEff && boosterEff.miningSpeedMultiplier) || 1;
    const doubleChance = (boosterEff && boosterEff.doubleMineralChance) || 0;
    return {
      key, duration: area.baseTime / (miningEff * speedMult),
      maxCycles: () => Infinity,
      apply(cycles, gains) {
        let totalOre = cycles;
        if (doubleChance > 0) {
          for (let i = 0; i < cycles; i++) {
            if ((typeof rollDoubleMineral === "function") && rollDoubleMineral(doubleChance)) totalOre++;
          }
        }
        // 脑插·采矿双生：4% 概率该 cycle 产出×2（逐 cycle 独立掷骰，与在线一致）
        const implantDoubleMining = (typeof getImplantDoubleOutputChance === "function") ? getImplantDoubleOutputChance(gameState, "mining") : 0;
        if (implantDoubleMining > 0) {
          for (let i = 0; i < cycles; i++) {
            if (Math.random() < implantDoubleMining) totalOre++;
          }
        }
        // 资源调度中心·勘探指令：离线累计采矿次数并达阈值额外产出（与在线一致）
        const dispatchResId = (area.mode === "moon" ? "moon:" : "ore:") + area.ore;
        const dispatchBonus = (typeof recordStationDispatchAction === "function") ? recordStationDispatchAction(gameState, "mining", cycles) : 0;
        if (dispatchBonus > 0) {
          totalOre += dispatchBonus;
          _settlementDispatchBonus.push({ resourceId: dispatchResId, quantity: dispatchBonus, kind: "mining" });
          if (implantDoubleMining > 0) {
            for (let i = 0; i < dispatchBonus; i++) {
              if (Math.random() < implantDoubleMining) totalOre++;
            }
          }
        }
        ResourceRegistry.add(gameState, dispatchResId, totalOre);
        // 伴生富集改装件：逐周期独立掷骰（与脑插双生同模式，与在线一致；奖励不参与双倍/调度、不给 XP）
        let richTotal = 0;
        if (typeof rollRigRichBonus === "function") {
          for (let i = 0; i < cycles; i++) richTotal += rollRigRichBonus(gameState, "mining", area);
          if (richTotal > 0 && typeof emitOfflineGameEvent === "function") {
            emitOfflineGameEvent("mining:richBonus", { area:area.name, resourceId:dispatchResId, ore:area.ore, quantity:richTotal });
          }
        }
        // XP 始终按实际采集次数计算（双倍不增加 XP）
        addOfflineSkillXp(key, cycles * area.baseXP); gains[key] += cycles;
        emitOfflineGameEvent("mining:completed", { area:area.name, mode:area.mode, resourceId:dispatchResId, quantity:totalOre, cycles, xp:cycles * area.baseXP });
        if (dispatchBonus > 0 && typeof emitOfflineGameEvent === "function") {
          emitOfflineGameEvent("station:dispatchBonus", { kind:"mining", resourceId:(area.mode === "moon" ? "moon:" : "ore:") + area.ore, quantity:dispatchBonus, counter:(gameState.station && gameState.station.dispatch ? gameState.station.dispatch.miningCount : 0), threshold:(typeof getStationDispatchThreshold === "function" ? getStationDispatchThreshold(gameState) : 0) }, { offline:true });
        }
      }
    };
  }

  if (key === "refining") {
    const recipeName = action.startedSmeltingArea || action.smeltingArea;
    const recipe = SMELTING_RECIPES.find(r => r.name === recipeName || r.outputMineral === recipeName) || SMELTING_RECIPES[0];
    if (!recipe) return null;
    const smeltingState = getSmeltingDisplayState(gameState, Date.now());
    // 军团 NPC 冶炼速度(refiningSpeed)：放大冶炼效率（与采矿/采气同处理），加速结算。
    const legionRefine = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getLegionContributionSnapshot)
      ? LEGION_NPC.getLegionContributionSnapshot(gameState).multipliers.refining : 1;
    const eff = smeltingState.efficiency * legionRefine;
    const output = Math.max(1, Math.floor(recipe.baseOutput * getRefiningOutputMultiplier(smeltingState.level)));
    return {
      key, duration: recipe.baseTime / eff,
      maxCycles() {
        // 运行时重校验技能门槛：超载催化剂等增强剂可能中途失效（含离线期间过期）。
        if (getEffectiveSkillLevel(gameState, "refining") < recipe.level) return 0;
        return ResourceRegistry.get(gameState, "ore:" + recipe.consumeOre);
      },
      apply(cycles, gains) {
        // 等级不足：零副作用（不扣料/不产出/不加 XP/不 emit）。
        if (getEffectiveSkillLevel(gameState, "refining") < recipe.level) return;
        // 脑插·冶炼双生：3% 概率该 cycle 产出×2（逐 cycle 独立掷骰）
        const implantDoubleRefine = (typeof getImplantDoubleOutputChance === "function") ? getImplantDoubleOutputChance(gameState, "refining") : 0;
        let outQty = cycles * output;
        if (implantDoubleRefine > 0) {
          for (let i = 0; i < cycles; i++) {
            if (Math.random() < implantDoubleRefine) outQty += output;
          }
        }
        // 增强剂·冶炼产量翻倍（考古重制 Phase B · 考古蓝图产出）：chance 概率该 cycle 额外 +output（逐 cycle 独立掷骰，与在线一致）
        if (boosterEff && boosterEff.doubleSmeltChance > 0 && (typeof rollDoubleMineral === "function")) {
          for (let i = 0; i < cycles; i++) {
            if (rollDoubleMineral(boosterEff.doubleSmeltChance)) outQty += output;
          }
        }
        ResourceRegistry.spend(gameState, "ore:" + recipe.consumeOre, cycles);
        // 外接大型精炼泵供料（离线）：每炉每件扣 1，按实际库存扣 min(本段炉数, 可供炉数)；
        // 断料后由下一段 descriptor 重建时自动按无泵效率折算（getSmeltingDisplayState 泵项归零）。
        if (smeltingState.pump && smeltingState.pump.count > 0 && smeltingState.pump.enabled) {
          const pumpNeed = smeltingState.pump.fuelPerCycle;
          const pumpStock = ResourceRegistry.get(gameState, smeltingState.pump.resourceId);
          const pumpCycles = Math.min(cycles, Math.floor(pumpStock / pumpNeed));
          if (pumpCycles > 0) ResourceRegistry.spend(gameState, smeltingState.pump.resourceId, pumpCycles * pumpNeed);
        }
        ResourceRegistry.add(gameState, "mineral:" + recipe.outputMineral, outQty);
        addOfflineSkillXp(key, cycles * recipe.baseXP); gains[key] += cycles;
        emitOfflineGameEvent("refining:completed", { recipe:recipe.name, inputId:"ore:" + recipe.consumeOre, outputId:"mineral:" + recipe.outputMineral, inputQuantity:cycles, outputQuantity:outQty, cycles, xp:cycles * recipe.baseXP });
      }
    };
  }

  if (key === "gasHarvesting") {
    const areaName = action.startedGasArea || action.gasArea;
    const area = GAS_AREAS.find(a => a.name === areaName || a.gas === areaName) || GAS_AREAS[0];
    if (!area) return null;
    return {
      key, duration: area.baseTime / getGasEfficiency(),
      maxCycles: () => {
        // 运行时重校验技能门槛：超载催化剂等增强剂可能中途失效（含离线期间过期）。
        if (getEffectiveSkillLevel(gameState, "gasHarvesting") < area.level) return 0;
        return Infinity;
      },
      apply(cycles, gains) {
        // 等级不足：零副作用。
        if (getEffectiveSkillLevel(gameState, "gasHarvesting") < area.level) return;
        // 脑插·采气双生：4% 概率该 cycle 产出×2（逐 cycle 独立掷骰）
        const implantDoubleGas = (typeof getImplantDoubleOutputChance === "function") ? getImplantDoubleOutputChance(gameState, "gas") : 0;
        let qty = cycles;
        if (implantDoubleGas > 0) {
          for (let i = 0; i < cycles; i++) {
            if (Math.random() < implantDoubleGas) qty++;
          }
        }
        // 增强剂·采气产量翻倍（考古重制 Phase B · 考古蓝图产出）：chance 概率该 cycle 额外 +1（逐 cycle 独立掷骰，与在线一致）
        if (boosterEff && boosterEff.doubleGasChance > 0 && (typeof rollDoubleMineral === "function")) {
          for (let i = 0; i < cycles; i++) {
            if (rollDoubleMineral(boosterEff.doubleGasChance)) qty++;
          }
        }
        // 资源调度中心·勘探指令：离线累计采气次数并达阈值额外产出（与在线一致）
        const dispatchResId = "gas:" + area.gas;
        const dispatchBonus = (typeof recordStationDispatchAction === "function") ? recordStationDispatchAction(gameState, "gas", cycles) : 0;
        if (dispatchBonus > 0) {
          qty += dispatchBonus;
          _settlementDispatchBonus.push({ resourceId: dispatchResId, quantity: dispatchBonus, kind: "gas" });
          if (implantDoubleGas > 0) {
            for (let i = 0; i < dispatchBonus; i++) {
              if (Math.random() < implantDoubleGas) qty++;
            }
          }
        }
        ResourceRegistry.add(gameState, dispatchResId, qty);
        // 伴生富集改装件：逐周期独立掷骰（与在线一致；奖励不参与双倍/调度、不给 XP）
        let richTotal = 0;
        if (typeof rollRigRichBonus === "function") {
          for (let i = 0; i < cycles; i++) richTotal += rollRigRichBonus(gameState, "gasHarvesting", area);
          if (richTotal > 0 && typeof emitOfflineGameEvent === "function") {
            emitOfflineGameEvent("gas:richBonus", { area:area.name, resourceId:dispatchResId, gas:area.gas, quantity:richTotal });
          }
        }
        addOfflineSkillXp(key, cycles * area.baseXP); gains[key] += cycles;
        emitOfflineGameEvent("gas:completed", { area:area.name, resourceId:dispatchResId, quantity:qty, cycles, xp:cycles * area.baseXP });
        if (dispatchBonus > 0 && typeof emitOfflineGameEvent === "function") {
          emitOfflineGameEvent("station:dispatchBonus", { kind:"gas", resourceId:"gas:" + area.gas, quantity:dispatchBonus, counter:(gameState.station && gameState.station.dispatch ? gameState.station.dispatch.gasCount : 0), threshold:(typeof getStationDispatchThreshold === "function" ? getStationDispatchThreshold(gameState) : 0) }, { offline:true });
        }
      }
    };
  }

  if (key === "shipEngineering" && action.shipSubAction === "component") {
    const recipe = getRunningShipCompRecipe(); if (!recipe) return null;
    // 精密配给剂（考古重制 Phase B · precision_rationing）：每周期重新读取权威报价/门槛函数；
    // 配给剂可能在读档/离线结算时已激活（门槛 +5），等级不足返回 0 周期 / 零副作用 apply。
    const getCompQuote = () => (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(gameState, recipe, { kind:"component" }) : { cost: recipe.cost, levelGate: recipe.level };
    const compLevel = () => getEffectiveSkillLevel(gameState, "shipEngineering");
    return {
      key, duration: getShipEngineeringCycleDuration(gameState, recipe), // 唯一周期公式（技能×船坞，与在线 tick 一致）
      maxCycles: () => {
        const q = getCompQuote();
        if (compLevel() < q.levelGate) return 0;
        // 船坞材料节省仅作用于部件制造：按节省后每周期实际消耗求可负担周期
        const savingRate = (typeof getShipyardSavingRate === "function") ? getShipyardSavingRate(gameState) : 0;
        if (savingRate > 0 && typeof getShipyardProductionQuote === "function") {
          const quote = getShipyardProductionQuote(gameState, { materialCost: q.cost }, 1);
          let max = Infinity;
          for (const [ref, qty] of Object.entries(quote.payable)) {
            if (qty <= 0) continue;
            const stock = ResourceRegistry.getByRef(gameState, ref);
            max = Math.min(max, Math.floor(stock / qty));
          }
          return Number.isFinite(max) ? Math.max(0, max) : 0;
        }
        return getMaxMaterialCycles(q.cost);
      },
      apply(cycles, gains) {
        const q = getCompQuote();
        if (compLevel() < q.levelGate) return; // 等级不足：零副作用（不扣料/不产出/不加 XP/不 emit）
        deductShipCompMatsMultiple(q.cost, cycles);
        ResourceRegistry.add(gameState, "component:" + recipe.id, cycles);
        addOfflineSkillXp(key, cycles * recipe.xp); gains[key] += cycles;
        emitOfflineGameEvent("manufacturing:completed", { branch:"component", recipeId:recipe.id, resourceId:"component:" + recipe.id, quantity:cycles, time:recipe.time, cycles, xp:cycles * recipe.xp });
      }
    };
  }

  if (key === "shipEngineering" && action.shipSubAction === "assembly") {
    const recipe = getRunningShipAsmRecipe(); if (!recipe) return null;
    // 精密配给剂（考古重制 Phase B · precision_rationing）：每周期重新读取权威报价/门槛函数；
    // 等级不足返回 0 周期 / 零副作用 apply（与组件同原则，杜绝门槛绕过）。
    const getAsmQuote = () => (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(gameState, recipe, { kind:"assembly" }) : { cost: recipe.materialCost || {}, levelGate: recipe.level };
    const asmLevel = () => getEffectiveSkillLevel(gameState, "shipEngineering");
    return {
      key, duration: getShipEngineeringCycleDuration(gameState, recipe), // 唯一周期公式（技能×船坞，与在线 tick 一致）
      maxCycles() {
        const q = getAsmQuote();
        if (asmLevel() < q.levelGate) return 0;
        return getMaxShipAssemblyCycles(recipe);
      },
      apply(cycles, gains) {
        const q = getAsmQuote();
        if (asmLevel() < q.levelGate) return; // 等级不足：零副作用
        deductShipAssemblyComponents(recipe, cycles);
        for (let i = 0; i < cycles; i++) gameState.inventory.ships.push(createShipInstance(recipe.shipId));
        addOfflineSkillXp(key, cycles * recipe.xp); gains[key] += cycles;
        emitOfflineGameEvent("manufacturing:completed", { branch:"ship", recipeId:recipe.id, shipId:recipe.shipId, quantity:cycles, time:recipe.time, cycles, xp:cycles * recipe.xp });
      }
    };
  }

  if (key === "equipmentEngineering") {
    const recipe = getRunningEquipEngRecipe(); if (!recipe) return null;
    return {
      key, duration: recipe.time / getEquipEngEfficiency(),
      // 限次抄本（BPC）：无蓝图则 0；探针类配方可完成周期数再受剩余流程次数限制（非 BPC 返回 Infinity）。
      maxCycles: () => !equipmentRecipeHasRequiredBlueprint(gameState, recipe) ? 0
        : Math.min(getEquipEngMaxCycles(recipe), manufacturingMaxCyclesByBlueprint(gameState, recipe)),
      apply(cycles, gains) {
        const eqQuote = (typeof getEquipEngBuildingQuote === "function") ? getEquipEngBuildingQuote(gameState, recipe) : { cost: recipe.cost, levelGate: recipe.level };
        const eeLvl = getEffectiveSkillLevel(gameState, "equipmentEngineering");
        if (eeLvl < eqQuote.levelGate) return; // 等级不足：零副作用
        // 预留抄本流程（BPC）：与产出提交相邻，材料/周期数已由 maxCycles 保证，不会白扣。
        if (!manufacturingReserveBlueprintRuns(gameState, recipe, cycles)) return;
        deductEquipEngInputs(recipe, cycles, undefined, eqQuote.cost);
        applyEquipEngOutput(recipe, cycles);
        addOfflineSkillXp(key, cycles * recipe.xp); gains[key] += cycles;
        emitOfflineGameEvent("manufacturing:completed", { branch:"equipment", recipeId:recipe.id, productType:recipe.output.type, quantity:cycles * recipe.output.qty, time:recipe.time, cycles, xp:cycles * recipe.xp });
        if (recipe.slot === "rig") emitOfflineGameEvent("rig:manufactured", { rigId:recipe.output.itemId, quantity:cycles * recipe.output.qty });
      }
    };
  }

  if (key === "boosterEngineering") {
    // 增强剂离线制造（Phase 2A）：每瓶独立产 1；受离线时间/材料限制；不占货舱；
    // 与在线同秒数产量一致；不消耗 180 秒、不应用效果；批量事件另发 boosters:manufactured。
    const recipe = getRunningBoosterRecipe(); if (!recipe) return null;
    return {
      key, duration: recipe.time / getBoosterEfficiency(),
      maxCycles: () => isBoosterRecipeUnlocked(recipe) ? getBoosterMaxCyclesFromState(gameState, recipe) : 0,
      apply(cycles, gains) {
        // 脑插·增强剂双生：3% 概率该 cycle 产出×2（逐 cycle 独立掷骰；料仍按 cycle 扣 1）
        const implantDoubleBooster = (typeof getImplantDoubleOutputChance === "function") ? getImplantDoubleOutputChance(gameState, "booster") : 0;
        let outQty = cycles;
        if (implantDoubleBooster > 0) {
          for (let i = 0; i < cycles; i++) {
            if (Math.random() < implantDoubleBooster) outQty++;
          }
        }
        // 增强剂·增强剂产量翻倍（考古重制 Phase B · 考古蓝图产出）：chance 概率该 cycle 额外 +1（逐 cycle 独立掷骰，与在线一致）
        if (boosterEff && boosterEff.doubleBoosterChance > 0 && (typeof rollDoubleMineral === "function")) {
          for (let i = 0; i < cycles; i++) {
            if (rollDoubleMineral(boosterEff.doubleBoosterChance)) outQty++;
          }
        }
        deductBoosterInputs(recipe, cycles);
        applyBoosterOutput(recipe, outQty);
        addOfflineSkillXp(key, cycles * recipe.xp); gains[key] += cycles;
        emitOfflineGameEvent("boosters:manufactured", { recipeId:recipe.id, itemId:recipe.output.itemId, quantity:outQty * recipe.output.qty, time:recipe.time, cycles:cycles, totalXp:cycles * recipe.xp, offline:true });
      }
    };
  }

  if (key === "archaeology") {
    const arch = gameState.archaeology;
    const site = getArchaeologySite(arch.startedSiteId || arch.activeSiteId);
    if (!site) return null;
    const probeId = arch.startedProbeId || arch.activeProbeId;
    const instanceId = gameState.shipAssignments && gameState.shipAssignments.archaeology;
    const instance = instanceId ? getShipInstanceFromState(gameState, instanceId) : null;
    if (!instance) return null;
    // 考古周期唯一公式（研究批次 G · archEff）：与在线 tick / 显示态共用 getArchaeologyCycleSeconds，
    // 离线 descriptor 与时间账本都只读这一个数，禁止再算第二套。
    const archCycleSeconds = (typeof getArchaeologyCycleSeconds === "function")
      ? getArchaeologyCycleSeconds(gameState, site)
      : site.time;
    return {
      key, duration: archCycleSeconds,
      maxCycles() {
        // 运行时重校验技能门槛：超载催化剂等增强剂可能中途失效（含离线期间过期）。
        if (getEffectiveSkillLevel(gameState, "archaeology") < site.level) return 0;
        const probeStock = ResourceRegistry.get(gameState, "probe:" + probeId);
        const fuelStock = ResourceRegistry.get(gameState, "consumable:fuel");
        // 用唯一计算层的长期平均燃料作为除数（含船体 fuelEfficiency + 改装件减免），
        // 保证在线/离线可负担次数一致；apply 循环内每次仍以真实累计器结算并在不足时中断。
        const fuelState = getArchaeologyFuelCostState(gameState, site, instance);
        const perCycle = Math.max(1, fuelState.averageFuelPerCycle);
        // 研究批次 G · probe：探针也走确定性累计器，长期平均 < 1 时可跑的周期数多于库存数。
        // 无科研（平均 = 1）时保持与接入前完全一致的 probeStock 上限，避免基线漂移。
        const probeState = (typeof getArchaeologyProbeCostState === "function")
          ? getArchaeologyProbeCostState(gameState) : { averageProbePerCycle:1 };
        const probeAvg = Math.max(0.01, Number(probeState.averageProbePerCycle) || 1);
        const probeCapacity = (probeAvg >= 1) ? probeStock : (Math.floor(probeStock / probeAvg) + 2);
        return Math.max(0, Math.min(probeCapacity, Math.floor(fuelStock / perCycle) + 2));
      },
      apply(cycles, gains) {
        // 等级不足：零副作用（不推进任何周期）。
        if (getEffectiveSkillLevel(gameState, "archaeology") < site.level) return;
        let done = 0;
        const durMs = archCycleSeconds * 1000;
        const repairState = gameState.archaeology.repairsByInstanceId && gameState.archaeology.repairsByInstanceId[instanceId];
        let repairMs = (repairState && Number(repairState.until) > Date.now()) ? (repairState.until - Date.now()) : 0;
        let virtualNow = Date.now();
        for (let i = 0; i < cycles; i++) {
          if (repairMs > 0) {
            const consume = Math.min(repairMs, durMs);
            virtualNow += consume;
            repairMs -= consume;
            if (repairMs <= 0 && gameState.archaeology.repairsByInstanceId) {
              delete gameState.archaeology.repairsByInstanceId[instanceId];
            }
            continue;
          }
          virtualNow += durMs;
          const result = resolveArchaeologyCycle(gameState, virtualNow, "offline", { timestamp: virtualNow });
          if (!result || result.reason === "insufficient") break;
          done++;
          const rs2 = gameState.archaeology.repairsByInstanceId && gameState.archaeology.repairsByInstanceId[instanceId];
          if (rs2 && Number(rs2.until) > virtualNow) repairMs = rs2.until - virtualNow;
        }
        gains[key] = (gains[key] || 0) + done;
      },
      // 考古时间预算接口：按墙钟秒数精确推进，兼容维修/干扰/队列/增强剂分段
      // 时间账本铁律：elapsedSeconds === actionSeconds + repairSeconds
      //   - 维修：只消耗墙钟（wallBudget），不扣行动预算（actionBudget=增强剂）、不扣增强剂、不推进进度
      //   - 完整周期：消耗真实 remainingForCycle（含追进度），actionSeconds += cycleCostMs/1000（禁止整段 durSec）
      //   - 部分周期：只推进真实 partialSec，actionSeconds += partialSec
      //   - 每个完整周期前做真实探针 + getArchaeologyFuelCostState 燃料校验，不足则不推进时间/资源/队列
      settleByTime(maxWallSeconds, gains, context) {
        const arch = gameState.archaeology;
        const durMs = archCycleSeconds * 1000;
        let wallBudgetMs = maxWallSeconds * 1000;
        // 行动预算（增强剂分段边界）：仅约束行动时间，维修时间不占用
        let actionBudgetMs = (context && Number.isFinite(context.actionBudgetSeconds))
          ? context.actionBudgetSeconds * 1000 : Infinity;
        // 合法值 0 必须保留：显式 != null 判断，禁止 || 覆盖
        let virtualNow = (context && context.virtualNowMs != null) ? context.virtualNowMs : Date.now();
        const batchLimit = (context && context.batchLimit && context.batchLimit !== Infinity)
          ? context.batchLimit : Infinity;

        let actionSec = 0, repairSec = 0, progressSec = 0;
        let cyclesDone = 0;
        let stopped = false, reason = "";

        while (wallBudgetMs > 1) {
          // 0) 运行时重校验技能门槛：超载催化剂等增强剂可能中途失效（含离线期间过期）；
          //    等级不足立即零副作用停止（不推进时间/资源/队列）。
          if (getEffectiveSkillLevel(gameState, "archaeology") < site.level) { stopped = true; reason = "level-locked"; break; }
          // 1) 维修优先：按墙钟消耗，不扣行动预算/增强剂，不推进进度（按舰实例隔离）
          const repairState = arch.repairsByInstanceId && arch.repairsByInstanceId[instanceId];
          if (repairState && Number(repairState.until) > virtualNow) {
            const repairNeedMs = Math.min(repairState.until - virtualNow, wallBudgetMs);
            virtualNow += repairNeedMs;
            wallBudgetMs -= repairNeedMs;
            repairSec += repairNeedMs / 1000;
            if (repairState.until <= virtualNow) {
              // 维修完成：恢复 HP，清维修状态
              resetArchaeologyShipHp(gameState, instanceId);
              delete arch.repairsByInstanceId[instanceId];
              continue; // 维修完成后重新进入循环，重新检查资源/预算
            }
            // 墙钟耗尽仍在维修
            stopped = true; reason = "repair-incomplete";
            break;
          }

          // 2) 批次耗尽
          if (cyclesDone >= batchLimit) { stopped = true; reason = "batch-exhausted"; break; }

          // 3) 行动预算耗尽（增强剂分段边界）
          if (actionBudgetMs <= 0.5) { stopped = true; reason = "booster-boundary"; break; }

          // 4) 计算完成本周期所需的行动时间（含追既有进度）
          const progress = Math.max(0, Number(gameState.currentAction.progress) || 0);
          const remainingForCycle = Math.max(0, durMs - progress * 1000);
          const availActionMs = Math.min(wallBudgetMs, actionBudgetMs);

          if (availActionMs < remainingForCycle) {
            // 不足以完成一个完整周期：只推进进度，扣真实行动时间
            const partialSec = availActionMs / 1000;
            gameState.currentAction.progress = progress + partialSec;
            progressSec = gameState.currentAction.progress;
            actionSec += partialSec;
            virtualNow += availActionMs;
            wallBudgetMs -= availActionMs;
            actionBudgetMs -= availActionMs;
            stopped = true;
            reason = (wallBudgetMs <= 1) ? "partial-cycle" : "booster-boundary";
            break;
          }

          // 5) 完成完整周期前：真实探针 + 燃料校验（不足则不推进任何时间/资源/队列）
          const probeStock = ResourceRegistry.get(gameState, "probe:" + probeId);
          // 研究批次 G · probe：与 resolveArchaeologyCycle 同一累计器口径（免费周期 chargedProbe=0 不拦）
          const probeState = (typeof getArchaeologyProbeCostState === "function")
            ? getArchaeologyProbeCostState(gameState) : { chargedProbe:1 };
          if (probeStock < probeState.chargedProbe) { stopped = true; reason = "insufficient-probe"; break; }
          const fuelState = getArchaeologyFuelCostState(gameState, site, instance);
          const fuelStock = ResourceRegistry.get(gameState, "consumable:fuel");
          if (fuelStock < fuelState.chargedFuel) { stopped = true; reason = "insufficient-fuel"; break; }

          // 6) 扣除完成本周期所需墙钟/行动时间
          const cycleCostMs = remainingForCycle;
          virtualNow += cycleCostMs;
          wallBudgetMs -= cycleCostMs;
          actionBudgetMs -= cycleCostMs;

          // 7) 执行真实考古周期（含探针/燃料实扣、成功率、重创判定）
          const result = resolveArchaeologyCycle(gameState, virtualNow, "offline", { timestamp: virtualNow });
          if (!result || result.reason === "insufficient") {
            // 理论上前置校验已挡住，此处为防御性回退；不计入完成周期
            stopped = true; reason = (result && result.reason) || "insufficient";
            break;
          }
          cyclesDone++;
          actionSec += cycleCostMs / 1000; // 只计真实完成本周期的行动时间（含追进度）
          gameState.currentAction.progress = 0;
          progressSec = 0;
          // resolveArchaeologyCycle 可能设置 repairUntil（重创），下一轮循环维修分支处理
        }

        gains[key] = (gains[key] || 0) + cyclesDone;
        if (context) context.virtualNowMs = virtualNow;
        return {
          elapsedSeconds: actionSec + repairSec,
          actionSeconds: actionSec,
          repairSeconds: repairSec,
          completedCycles: cyclesDone,
          progressSeconds: progressSec,
          stopped, reason
        };
      }
    };
  }

  return null;
}

function advanceOfflineQueue() {
  const queue = gameState.queue;
  if (!queue || !queue.status.isRunning || queue.items.length === 0) return false;
  let nextIndex = queue.status.activeIndex + 1;
  if (nextIndex >= queue.items.length) {
    if (!queue.config.loopMode) {
      queue.status.isRunning = false; queue.status.activeIndex = -1;
      return false;
    }
    queue.status.completedCount++;
    nextIndex = 0;
  }
  queue.status.activeIndex = nextIndex;
  executeQueueItemForState(gameState, queue.items[nextIndex], Date.now());
  return true;
}

function completeOfflineQueueCycles(cycles) {
  const queue = gameState.queue;
  if (!queue || !queue.status.isRunning || queue.status.activeIndex < 0 || queue.status.activeIndex >= queue.items.length) {
    if (gameState.currentAction.batchRemaining > 0) {
      gameState.currentAction.batchRemaining = Math.max(0, gameState.currentAction.batchRemaining - cycles);
      if (gameState.currentAction.batchRemaining === 0) {
        resetActionProgress();
        gameState.currentAction.active = false;
        return true;
      }
    }
    return false;
  }

  const index = queue.status.activeIndex;
  const item = queue.items[index];
  if (item.count === -1) {
    gameState.currentAction.batchRemaining = -1;
    return false;
  }

  item.count = Math.max(0, (Number(item.count) || 1) - cycles);
  gameState.currentAction.batchRemaining = item.count;
  gameState._dirty = true;
  if (item.count > 0) return false;

  queue.items.splice(index, 1);
  queue.status.completedCount++;
  queue.status.failCount = 0;

  if (queue.items.length === 0 || index >= queue.items.length) {
    queue.status.isRunning = false;
    queue.status.activeIndex = -1;
    resetActionProgress();
    gameState.currentAction.active = false;
    gameState.currentAction.batchRemaining = 0;
    return true;
  }

  queue.status.activeIndex = index;
  executeQueueItemForState(gameState, queue.items[index], Date.now());
  return true;
}

function skipFailedOfflineQueueItem() {
  const queue = gameState.queue;
  if (!queue || !queue.status.isRunning || !queue.config.skipOnFail) return false;
  queue.status.failCount++;
  if (queue.status.failCount > queue.items.length * 2 + 2) {
    queue.status.isRunning = false; queue.status.activeIndex = -1;
    return false;
  }
  return advanceOfflineQueue();
}

// 队列权威 batchLimit 解析（修复 B：考古/采矿/制造等离线分支不得把陈旧/缺失的
// currentAction.batchRemaining === 0 解释为 Infinity，从而吞掉整段离线时间后才切换）。
// 规则：
//  - 队列运行时：以 queue.items[activeIndex].count 为权威。
//      count === -1        → Infinity（明确的无限任务才允许持续整段离线）；
//      count 为有限正数    → 等于该值；
//      count 为 0/NaN/缺失/activeIndex 越界 → fail-closed，按 1 推进（立即终结项并退回队列），
//                                绝不解释为 Infinity 考古。
//  - 非队列（手动作业）：以 currentAction.batchRemaining 为权威，同样 0/NaN/缺失 fail-closed 为 1。
function getQueueBatchLimit(state) {
  const queue = state.queue;
  if (queue && queue.status.isRunning && queue.status.activeIndex >= 0 && queue.status.activeIndex < queue.items.length) {
    const item = queue.items[queue.status.activeIndex];
    const cnt = item.count;
    if (cnt === -1) return Infinity;
    if (typeof cnt === "number" && Number.isFinite(cnt) && cnt > 0) return cnt;
    return 1; // fail-closed：非法 count 按 1 推进，绝不解释为 Infinity
  }
  const br = state.currentAction.batchRemaining;
  if (br === -1) return Infinity;
  if (typeof br === "number" && Number.isFinite(br) && br > 0) return br;
  return 1; // fail-closed：手动作业下非法 batchRemaining 同样不解释为 Infinity
}

// 队列项 target 与 currentAction 是否一致（仅用于一致性修复判定）。
function queueItemTargetMatchesAction(state, item, action) {
  const skill = item.skill;
  if (skill === "archaeology") return action.archaeologyTarget === item.target;
  if (skill === "mining") return action.area === item.target || action.normalMiningArea === item.target || action.moonMiningArea === item.target;
  if (skill === "refining") return action.smeltingArea === item.target;
  if (skill === "gasHarvesting") return action.gasArea === item.target;
  if (skill === "shipEngineering") return Boolean(action.shipSubAction) && Boolean(action.shipCompTarget || action.shipAsmTarget);
  if (skill === "equipmentEngineering") return action.equipEngTarget === item.target;
  if (skill === "boosterEngineering") return action.boosterTarget === item.target;
  return true; // 其他（如 combat 由自身逻辑维护）不强制 target
}

// 进入 settleOfflineActions 时的队列一致性修复（需求 3）：
// 若队列正在运行且 currentAction 已激活，确认 currentAction 对应当前队列项；
// skill / target / batchRemaining 任一不一致时，以队列项权威重新 applyQueueConfigToState。
// 不允许「currentAction.active === true」绕过队列配置同步。
// 战斗项由 startCombatQueueItem 自管（敌人/波次/queueWaves* 字段），不在此处重新 apply。
function syncQueueCurrentAction(state) {
  const queue = state.queue;
  if (!queue || !queue.status.isRunning) return;
  if (queue.status.activeIndex < 0 || queue.status.activeIndex >= queue.items.length) {
    // 索引越界：fail-closed，停止队列（避免把越界项解释为无限考古）
    queue.status.isRunning = false;
    queue.status.activeIndex = -1;
    return;
  }
  const item = queue.items[queue.status.activeIndex];
  if (!item) return;
  const action = state.currentAction;
  if (!action.active) return; // 下方 executeQueueItemForState 兜底启动
  if (item.skill === "combat") return; // 战斗由自身逻辑维护一致性
  const expectedSkill = item.skill === "ammunitionEngineering" ? "equipmentEngineering" : item.skill;
  const expectedBatch = (item.count === -1) ? -1 : (Number(item.count) || 1);
  const targetMatches = queueItemTargetMatchesAction(state, item, action);
  if (action.skill !== expectedSkill || action.batchRemaining !== expectedBatch || !targetMatches) {
    applyQueueConfigToState(state, getQueueItemConfigForState(item), Date.now());
    state._dirty = true;
  }
}

function settleOfflineActions(seconds, gains) {
  const queue = gameState.queue;
  // 2026-09-01：战斗舰被击毁后，队列仍在运行（isRunning=true 是维修后自动续战的前提，
  // 见 tryResumeCombatAfterRepair），但此刻玩家处于「等待 180s 维修」状态而非空闲。
  // 若不排除这种情况，这里会立刻重新执行该战斗队列项 → 舰在维修中启动校验失败
  // → 队列永久卡在「执行中」且战斗永远起不来。故有 combat 待恢复标记时跳过重启。
  const awaitingRepair = Boolean(gameState.resumeAfterRepair && gameState.resumeAfterRepair.type === "combat");
  if (queue && queue.status.isRunning && queue.items.length > 0 && !gameState.currentAction.active && !awaitingRepair) {
    let index = queue.status.activeIndex;
    if (index < 0 || index >= queue.items.length) index = 0;
    queue.status.activeIndex = index;
    executeQueueItemForState(gameState, queue.items[index], Date.now());
  }

  // 队列一致性修复：currentAction 已激活但可能与当前队列项错位（陈旧 batchRemaining /
  // 错配 skill/target，典型为旧档恢复或刷新），以队列项权威重新同步，避免把陈旧
  // batchRemaining === 0 解释为无限、从而吞掉整段离线时间。
  syncQueueCurrentAction(gameState);

  let remaining = seconds;
  let guard = 0;
  const timeBySkill = (arguments.length >= 4 && typeof arguments[3] === "object") ? arguments[3] : null;
  const now = Date.now();
  const DUR = typeof BOOSTER_DURATION_MS === "number" ? BOOSTER_DURATION_MS : 180000;

  while (remaining > 0.0001 && gameState.currentAction.active && guard++ < 10000) {
    const descriptor = getOfflineActionDescriptor();
    if (!descriptor || !Number.isFinite(descriptor.duration) || descriptor.duration <= 0) break;
    const currentSkill = gameState.currentAction.skill;

    // --- Booster segmentation ---
    // For mining/archaeology, cap this batch to the minimum available time
    // among the two relevant booster slots. When a slot depletes, the next
    // loop iteration re-reads the updated (depleted) booster state via
    // getOfflineActionDescriptor, naturally splitting the timeline.
    let boosterLimitSec = Infinity;
    let relevantSlots = [];
    // 考古重制 Phase B：四类生产增强剂（考古蓝图产出）在线/离线共用同一消耗模型，故离线段也按增强剂时间分段。
    if (currentSkill === "mining" || currentSkill === "archaeology" ||
        currentSkill === "gasHarvesting" || currentSkill === "refining" ||
        currentSkill === "shipEngineering" || currentSkill === "boosterEngineering") {
      if (typeof getActionBoosterSlots === "function") {
        relevantSlots = getActionBoosterSlots(currentSkill);
      }
      if (typeof getActiveBoosterState === "function") {
        const active = getActiveBoosterState(gameState);
        for (const slot of relevantSlots) {
          const entry = active[slot];
          if (entry && entry.itemId && Number(entry.remainingMs) > 0) {
            const invCount = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(gameState, entry.itemId) : 0;
            const availMs = Number(entry.remainingMs) + Math.max(0, Math.floor(invCount)) * DUR;
            const availSec = availMs / 1000;
            if (availSec < boosterLimitSec) boosterLimitSec = availSec;
          }
        }
      }
    }

    // 考古专用：在通用 partial/cyclesByTime/cycles<=0/apply 分支之前，立即进入时间预算接口。
    // 无论维修/干扰/剩余或增强剂时间不足一周期，都由 settleByTime 统一按墙钟精确结算：
    //   - maxWallSeconds = 完整剩余墙钟（remaining），保证维修可跨段按墙钟完成
    //   - actionBudgetSeconds = boosterLimitSec（仅约束行动时间，不约束维修/进度）
    if (currentSkill === "archaeology" && typeof descriptor.settleByTime === "function") {
      // 修复 B：batchLimit 读取权威队列项 count，绝不信任可能陈旧的 currentAction.batchRemaining。
      const batchLimit2 = getQueueBatchLimit(gameState);
      const ctx = {
        virtualNowMs: (gameState._archVirtualNowMs != null) ? gameState._archVirtualNowMs : null,
        batchLimit: batchLimit2,
        actionBudgetSeconds: boosterLimitSec
      };
      const result = descriptor.settleByTime(remaining, gains, ctx);
      gameState._archVirtualNowMs = ctx.virtualNowMs;
      gameState._dirty = true;

      const elapsed = result.elapsedSeconds || 0;
      const actionSec = result.actionSeconds || 0;
      const completed = result.completedCycles || 0;

      // 墙钟消耗（settleByTime 保证 elapsedSeconds === actionSeconds + repairSeconds）
      remaining -= elapsed;

      // timeBySkill 只记行动时间（维修不算行动、不追扣增强剂）
      if (timeBySkill) timeBySkill[currentSkill] = (timeBySkill[currentSkill] || 0) + actionSec;

      // 进度：由 settleByTime 内部管理（含部分周期）
      gameState.currentAction.progress = result.progressSeconds > 0 ? result.progressSeconds : 0;

      // 增强剂只扣 actionSeconds（不含维修/干扰）
      if (actionSec > 0 && relevantSlots.length > 0 && typeof applyBoosterTimeConsumption === "function") {
        const consumedMs = Math.ceil(actionSec * 1000);
        for (const slot of relevantSlots) {
          applyBoosterTimeConsumption(gameState, slot, consumedMs, now, { offline:true });
        }
      }

      // 队列只按真实完成周期推进
      if (completed > 0) {
        if (completeOfflineQueueCycles(completed)) {
          if (gameState.currentAction.active) continue;
          break;
        }
      }

      if (result.stopped) {
        // 资源不足（探针/燃料）：跳过失败队列项或停止行动
        if (result.reason === "insufficient" || result.reason === "insufficient-probe" || result.reason === "insufficient-fuel") {
          if (skipFailedOfflineQueueItem()) continue;
          gameState.currentAction.active = false;
          break;
        }
        // repair-incomplete / partial-cycle / booster-boundary / batch-exhausted：
        // 剩余墙钟或分段边界。若还有时间且本段确有推进则继续外循环（重读增强剂/维修状态），
        // 否则终止防止死循环。
        if (remaining >= 0.001 && (elapsed >= 0.0005 || result.reason === "batch-exhausted")) continue;
        break;
      }
      if (remaining >= 0.001) continue;
      break;
    }

    const progress = Math.max(0, Number(gameState.currentAction.progress) || 0);
    const timeToFirst = Math.max(0, descriptor.duration - progress);
    const maxTime = Math.min(remaining, boosterLimitSec);

    if (maxTime < timeToFirst) {
      // Cannot complete one cycle within time/booster limit.
      const partialTime = maxTime;
      gameState.currentAction.progress = progress + partialTime;
      if (timeBySkill) timeBySkill[currentSkill] = (timeBySkill[currentSkill] || 0) + partialTime;
      remaining -= partialTime;
      if (partialTime > 0 && relevantSlots.length > 0 && typeof applyBoosterTimeConsumption === "function") {
        const consumedMs = Math.ceil(partialTime * 1000);
        for (const slot of relevantSlots) {
          applyBoosterTimeConsumption(gameState, slot, consumedMs, now, { offline:true });
        }
      }
      if (remaining > 0.0001) continue;
      break;
    }

      const cyclesByTime = 1 + Math.floor((maxTime - timeToFirst) / descriptor.duration);
      // 修复 B：通用离线分支同样以权威队列项 count 为 batchLimit，避免采矿/制造等存在相同漏洞。
      const batchLimit = getQueueBatchLimit(gameState);
      const possibleCycles = Math.max(0, descriptor.maxCycles());
      const cycles = Math.min(cyclesByTime, batchLimit, possibleCycles);

      if (cycles <= 0) {
        if (skipFailedOfflineQueueItem()) continue;
        gameState.currentAction.active = false;
        break;
      }

      descriptor.apply(cycles, gains);
    gameState._dirty = true;
    const cycleTime = timeToFirst + Math.max(0, cycles - 1) * descriptor.duration;
    remaining -= cycleTime;
    if (timeBySkill) timeBySkill[currentSkill] = (timeBySkill[currentSkill] || 0) + cycleTime;
    gameState.currentAction.progress = 0;

    // 消耗增强剂时间：所有采集/制造/考古类行动离线均按 relevantSlots 分段消耗（与在线一致）。
    // 战斗增强剂离线冻结（combat 不在 relevantSlots 计算列表内），不参与离线消耗。
    if (cycleTime > 0 && relevantSlots.length > 0 && typeof applyBoosterTimeConsumption === "function") {
      const consumedMs = Math.ceil(cycleTime * 1000);
      for (const slot of relevantSlots) {
        applyBoosterTimeConsumption(gameState, slot, consumedMs, now, { offline:true });
      }
    }

    if (completeOfflineQueueCycles(cycles)) {
      // Batch K：intship 阶段推进（离线批量清空后唯一推进点，非 intship 驱动时内部为无操作；
      // 推进成功后 currentAction.active 重新为 true，经下方 continue 用剩余离线时间续下一阶段）
      if (typeof advanceIntshipAfterManufacturingAction === "function") {
        advanceIntshipAfterManufacturingAction(gameState, { now, offline:true });
      }
      if (gameState.currentAction.active) continue;
      break;
    }

    if (cycles < cyclesByTime) {
      if (skipFailedOfflineQueueItem()) continue;
      gameState.currentAction.active = false;
      break;
    }

    // If significant remaining time, continue looping for the next segment
    // (e.g., after a booster-limited batch, the depleted-booster descriptor
    // will be used in the next iteration for the base rate).
    if (remaining >= descriptor.duration) {
      gameState.currentAction.progress = 0;
      continue;
    }

    gameState.currentAction.progress = Math.min(remaining, descriptor.duration);
    remaining = 0;
  }
  return seconds - remaining;
}

function settleOfflinePlanets(seconds, gains, segmentEnd) {
  if (!gameState.planetary || !Array.isArray(gameState.planetary.deployments)) return;
  const now = segmentEnd || Date.now();
  const offlineStart = now - seconds * 1000;
  for (const deployment of gameState.planetary.deployments) {
    if (!deployment.active) continue; // 已到期：跳过，且不重复触发 expired
    // 研究批次 I · planauto：离线与在线共用同一个「单 deployment 时间轴」入口
    // （产出结算 / 精确到期判定 / 逐周期自动续期全部在 advancePlanetDeploymentTimeline 内完成）。
    // 离线区间从离线起点（= now - 离线秒数，受 MAX_OFFLINE_SECONDS 上限约束）起算。
    const res = advancePlanetDeploymentTimeline(gameState, deployment, offlineStart, now, {
      offline:true,
      emit:(type, payload, eventMeta) => emitOfflineGameEvent(type, payload, eventMeta),
      // 空间站自动收取（Phase 3C-4/6）：storage>=storageMax 时移入库存并清零
      collect:(dep, storageMax) => (typeof applyStationAutoCollect === "function" && dep.storage >= storageMax)
        ? applyStationAutoCollect(gameState, dep, storageMax, true) : 0
    });
    if (res.cycles > 0) {
      gameState.skills.planetaryIndustry.xp += res.cycles;
      gains.planetaryIndustry += res.cycles;
      gameState._dirty = true;
    }
    if (res.renewals > 0) gameState._dirty = true;
  }
  if (gains.planetaryIndustry > 0) {
    checkLevelUp("planetaryIndustry", {
      offline:true,
      source:"offline-settlement",
      runId:_offlineEventBatch ? _offlineEventBatch.runId : null
    });
  }
}

// Booster segmentation is handled directly inside settleOfflineActions:
// for mining/archaeology, each loop iteration caps the batch time to the
// minimum available time among the two relevant booster slots. When a slot
// depletes, the next iteration re-reads the updated state via
// getOfflineActionDescriptor, naturally splitting the timeline.
// Combat boosters are frozen offline; refining/gas/manufacturing don't
// consume non-combat slots.

/* ----------------------------------------------------------------
   离线时间轴协调器（唯一入口）
   按燃料耗尽和施工完成分段时间轴，每段用正确的 operational 状态
   真实调用子系统的 settle 函数。
   定义在 offline.js 以便直接调用 settleOfflineActions/Planets 等。
   ---------------------------------------------------------------- */
function settleOfflineTimeline(totalSeconds, gains, context) {
  const seconds = Math.min(Math.max(0, totalSeconds || 0), MAX_OFFLINE_SECONDS);
  if (seconds <= 5) return;
  const now = Date.now();
  const totalMs = seconds * 1000;
  const offlineStart = now - totalMs;
  const offlineEnd = now;

  const s = gameState && gameState.station;
  // 将 maintenance.lastTick 设为离线起点，使 settleStationMaintenance 按段正确消耗
  if (s && s.maintenance && (Number(s.maintenance.lastTick) || 0) > offlineStart) {
    s.maintenance.lastTick = offlineStart;
  }

  const haveFuelFns = typeof getStationMaintenancePoints === "function"
    && typeof getStationEffectiveFuelBurnRatePerMs === "function";

  // 动态时间轴：不再在循环前一次性构造边界。每段开始重算维护点数/燃烧率/
  // 燃料耗尽时刻/施工完成时刻——这样施工中途升级维护点数后，剩余燃料按
  // 「新点数」重新推算耗尽点，而非沿用离线开始时的旧点数。
  let currentTime = offlineStart;
  let guard = 0;
  while (currentTime < offlineEnd) {
    if (++guard > 100000) break; // 安全网：防意外死循环

    // ---- 每段开始动态重算 ----
    // 1) 当前维护点数  2) 当前燃烧率  3) 当前燃料覆盖时长  4) 当前燃料耗尽时刻
    let fuelExhaustAt = Infinity;
    if (haveFuelFns && s && s.maintenance) {
      const points = getStationMaintenancePoints(gameState);
      // 研究批次 G · fuel：离线分段的燃料耗尽时刻必须用实际燃烧速率推算，
      // 与 settleStationMaintenance 的实际扣减完全同源，否则会提前把站点判为断油。
      const burnRate = points > 0 ? getStationEffectiveFuelBurnRatePerMs(gameState, points) : 0;
      const fuelRem = Number(s.maintenance.fuelRemaining) || 0;
      if (burnRate > 0 && fuelRem > 0) {
        const fuelCoverageMs = fuelRem / burnRate;
        const exhaustAt = currentTime + fuelCoverageMs;
        if (exhaustAt > currentTime) fuelExhaustAt = exhaustAt;
      }
    }
    // 5) 当前施工完成时刻
    let constructionAt = Infinity;
    if (s && s.construction && s.construction.paid === true
      && Number(s.construction.completesAt) > currentTime) {
      constructionAt = Number(s.construction.completesAt);
    }
    // 6) nextBoundary = min(fuelExhaustAt, constructionAt, offlineEnd)
    let nextBoundary = offlineEnd;
    if (fuelExhaustAt > currentTime && fuelExhaustAt < nextBoundary) nextBoundary = fuelExhaustAt;
    if (constructionAt > currentTime && constructionAt < nextBoundary) nextBoundary = constructionAt;

    const segEnd = Math.min(nextBoundary, offlineEnd);
    const segMs = segEnd - currentTime;
    if (segMs <= 0.001) {
      // 边界重合的极短段：仅推进时间指针，防止死循环
      currentTime = segEnd > currentTime ? segEnd : currentTime + 1;
      continue;
    }
    const segSec = segMs / 1000;

    // 当前段是否 operational（在扣除该段燃料之前判断）
    const segOperational = typeof isStationOperational === "function"
      ? isStationOperational(gameState) : false;

    // 1) 玩家行动始终完整进行（采矿/采气/制造/考古不受燃料影响）
    const timeBySkill = {};
    settleOfflineActions(segSec, gains, undefined, timeBySkill);
    gameState._auditTimeBySkill = timeBySkill;

    // Batch S：统计等效离线战斗结算（每段累积；聚合事件在 applyOfflineGains 末尾 flush 一次）。
    // 返回段内未被战斗消耗的剩余秒数，避免在「战斗终结→下一项为生产」时浪费剩余离线时间。
    let combatLeftover = 0;
    if (typeof OfflineCombatSystem !== "undefined") {
      const left = OfflineCombatSystem.settle(gameState, segSec, {
        runId: context && context.runId,
        now: currentTime,
        offlineEnd: offlineEnd
      });
      combatLeftover = (typeof left === "number" && left > 0) ? left : 0;
    }
    // 战斗终结后启动了生产项（combat.active=false 但 currentAction.active=true）：
    // 用剩余段内时间继续结算生产，避免浪费剩余离线时间（等价于接续到下一分段，但无需切段）。
    if (combatLeftover > 0 && gameState.currentAction.active && !gameState.combat.active) {
      settleOfflineActions(combatLeftover, gains, undefined, timeBySkill);
      gameState._auditTimeBySkill = timeBySkill;
    }

    // 2) 行星：按段结束时间结算（segmentEnd 使 deployment.lastTick 正确推进）
    settleOfflinePlanets(segSec, gains, segEnd);

    // 3) 自动线：始终调用。无油段由 processAutoLines 内部燃料闸门负责——
    //    不产出/不扣料/不加XP，但推进 line.lastTick=segEnd，防止补油后
    //    首个在线 tick 追算整段断油时间。
    if (typeof processAutoLines === "function") {
      processAutoLines(gameState, segEnd, true);
    }

    // 3.5) 军团 NPC 系统（军团 DLC）：离线同样走统一 tickLegionNpc 结算（候选刷新/工资/经验），
    // 按 segEnd 时间戳推进，与在线共用同一边界，绝不重复扣薪/重复生成候选。
    if (typeof LEGION_NPC !== "undefined" && typeof LEGION_NPC.tickLegionNpc === "function") {
      LEGION_NPC.tickLegionNpc(gameState, { now: segEnd });
    }
    // 3.6) 军团战斗小队（M4）：每段按 segEnd 推进 NPC 舰船修复倒计时，与战斗结算段共用
    // tickLegionSquadRepairs（幂等，仅 repairUntil 到期者恢复；时间倒退不提前修复）。
    // 覆盖「本段无战斗结算」的场景（战斗未激活 / 已转入生产），保证离线期间修复正常流逝。
    if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD &&
        typeof LEGION_COMBAT_SQUAD.tickLegionSquadRepairs === "function") {
      LEGION_COMBAT_SQUAD.tickLegionSquadRepairs(gameState, segEnd);
    }
    if (typeof LEGION_STARMAP_TRIAL !== "undefined" && LEGION_STARMAP_TRIAL &&
        typeof LEGION_STARMAP_TRIAL.tickLegionStarmapTrial === "function") {
      LEGION_STARMAP_TRIAL.tickLegionStarmapTrial(gameState, segEnd);
    }

    // 4) 扣除该段燃料（仅 operational 段真实消耗）
    if (segOperational && typeof settleStationMaintenance === "function") {
      settleStationMaintenance(gameState, segEnd, true);
    } else if (s && s.maintenance) {
      // 无油段也推进 maintenance.lastTick，避免补油后重复扣断油段
      s.maintenance.lastTick = segEnd;
    }

    // 5) 施工完成（边界正好落在 segEnd）
    if (s && s.construction && s.construction.paid === true
      && Number(s.construction.completesAt) > currentTime
      && Number(s.construction.completesAt) <= segEnd) {
      if (typeof completeStationConstruction === "function") {
        completeStationConstruction(gameState, { offline: true });
      }
    }

    currentTime = segEnd;
  }
}

function applyOfflineGains(rawSeconds, context) {
  // 每次结算前清空资源调度加成收集（避免上一次结算残留污染本次展示）
  _settlementDispatchBonus = [];
  // Batch C-9 定点返修：rawSeconds 严格归一化（唯一归一点）。
  // 合法 = typeof "number" 且 Number.isFinite 且 >= 0；合法值原样保留（不整数化）。
  // 其余一切输入（NaN / Infinity / -Infinity / 负数 / 数字字符串 / 普通字符串 /
  // null / undefined / 对象 / 数组 / 布尔）一律归一为 0，随后被 seconds <= 5 提前返回拦截：
  // 不初始化考古虚拟时间、不调用 settleOfflineTimeline、不发射离线结算完成事件、
  // 不改动统计/事件账本/_dirty。事件构造处禁止再做 Number() / || 0 等宽松转换。
  const normalizedRawSeconds =
    (typeof rawSeconds === "number" && Number.isFinite(rawSeconds) && rawSeconds >= 0)
      ? rawSeconds
      : 0;
  const seconds = Math.min(normalizedRawSeconds, MAX_OFFLINE_SECONDS);
  const gains = {
    mining: 0, refining: 0, shipEngineering: 0, gasHarvesting: 0,
    equipmentEngineering: 0, boosterEngineering: 0, planetaryIndustry: 0,
    combat: 0
  };
  if (seconds <= 5) return gains;
  // 定点返修 P1-C：结算前对 gameState 做全量快照；若 settle/flush/emit 任一阶段抛异常，
  // 在 catch 中就地还原结算前 gameState（不前进 lastActiveTime、不落盘半应用状态），
  // 仅向 RuntimeGuard 报告一次后 rethrow，由调用方决定是否继续。
  const settlementSnapshot = createSerializableGameStateSnapshot(gameState);
  // 初始化考古虚拟时间
  gameState._archVirtualNowMs = Date.now() - seconds * 1000;
  const previousBatch = _offlineEventBatch;
  const runId = context && typeof context.runId === "string" && context.runId
    ? context.runId
    : "offline_" + Math.round(Date.now() - seconds * 1000).toString(36) + "_" + Date.now().toString(36) + "_" + (++_offlineBatchSeq).toString(36);
  _offlineEventBatch = { runId, sequence:0 };
  try {
    // 唯一协调入口：按燃料/施工分段时间轴
    // Batch S：把本离线会话唯一 runId 一并传入时间轴，使 OfflineCombatSystem.settle
    // 与末尾 flush 用同一 runId 寻址同一会话聚合器（否则 settle 落到 "offline_undefined"
    // 而 flush 用真实 runId，会话错配 → 不发射聚合事件）。
    settleOfflineTimeline(seconds, gains, Object.assign({}, context, { runId: runId }));
    // Batch C-9：真实结算成功完成后、_offlineEventBatch 恢复前，严格 emit 一次唯一完成事件
    // （沿用同一 runId/eventId 链）。settleOfflineTimeline 抛出异常时不会执行到此行，
    // 不伪造完成事件。calculateOfflineGains / forceOfflineTest / 直接 applyOfflineGains
    // 均经由本入口，禁止在其他位置复制发射。rawSeconds 使用入口处唯一严格归一化结果
    // normalizedRawSeconds（非负有限 number、未封顶、不整数化），settledSeconds 为实际
    // 结算秒数（已按 MAX_OFFLINE_SECONDS 封顶）。禁止此处再做 Number()/|| 0 等宽松转换。
    // Batch S：离线战斗聚合事件（必须早于 settlementCompleted，全离线恰一次）
    let combatSummary = null;
    if (typeof OfflineCombatSystem !== "undefined") {
      combatSummary = OfflineCombatSystem.flush(gameState, { runId, gains, offlineEnd: Date.now() });
    }
    // 离线战斗汇总透传给结算弹窗（不污染 gains，否则 Object.values(gains).reduce 求和会把对象当数 → NaN）
    if (context && typeof context === "object") context.combatSummary = combatSummary;
    emitOfflineGameEvent("offline:settlementCompleted", {
      rawSeconds: normalizedRawSeconds,
      settledSeconds: seconds
    });
  } catch (e) {
    // 异常安全回滚：就地还原结算前 gameState（finally 负责还原 batch 与清理虚拟时间）。
    try { restoreSerializableGameStateSnapshot(gameState, settlementSnapshot); } catch (restoreErr) { /* 还原异常安全 */ }
    if (typeof RuntimeGuard !== "undefined" && RuntimeGuard && typeof RuntimeGuard.report === "function") {
      RuntimeGuard.report(e, { source:"offline:settlement", fatal:false, kind:"offline-settlement" });
    }
    throw e;
  } finally {
    _offlineEventBatch = previousBatch;
    delete gameState._archVirtualNowMs;
  }
  // 同步 boosters.lastTick，防止首次在线 gameTick 追扣旧离线时间
  if (gameState.boosters) {
    gameState.boosters.lastTick = Date.now();
  }
  return gains;
}

function calculateOfflineGains() {
  const now = Date.now();
  // 离线诊断：打印本次结算的 elapsed，便于确认「标签页恢复 / 启动」是否真的触发了离线追算。
  // 仅当 elapsed>5（会真正结算）或处于调试开关时打印，避免每次可见性抖动刷屏。
  const _diagLast = gameState.lastActiveTime || now;
  const _diagElapsed = Math.floor((now - _diagLast) / 1000);
  if (_diagElapsed > 5 || /[?&]offlinedebug\b/.test(typeof location !== "undefined" && location.search ? location.search : "")) {
    console.log("[离线] calculateOfflineGains 触发，elapsed=" + _diagElapsed + "s");
  }
  // 批次 C：科研离线时间结算 —— 必须在既有 elapsed <= 5 提前 return 之前调用，
  // 复用本函数同一 now（不传 elapsed、不预封顶）。每离线结算仅调用一次；
  // 真实超时封顶在 processResearchUntil 内统一处理。
  if (typeof ResearchSystem !== "undefined" && ResearchSystem &&
      typeof ResearchSystem.processResearchUntil === "function") {
    ResearchSystem.processResearchUntil(gameState, now);
  }
  const lastActive = gameState.lastActiveTime || now;
  const elapsed = Math.floor((now - lastActive) / 1000);
  if (elapsed <= 5) return;
  // 定点返修 P1-C：结算异常时 applyOfflineGains 已就地回滚并 rethrow；此处捕获后直接返回，
  // 不前进 lastActiveTime、不落盘半应用状态（结算失败不应制造离线收益）。
  let gains;
  // Batch R（B 项）：结算前后 canonical 库存快照，diff 出「最终净获得物品」供持久弹窗展示
  const beforeSnapshot = createInventorySnapshot(gameState);
  const offlineCtx = { runId:"offline_" + lastActive.toString(36) + "_" + now.toString(36) };
  try {
    gains = applyOfflineGains(elapsed, offlineCtx);
  } catch (e) {
    // 定点返修·离线诊断：原先静默 return 会让整次离线收益消失且无可排查线索。
    console.error("[离线·applyOfflineGains 异常] elapsed=" + elapsed + "s，本次离线收益未发放。错误：", e && (e.stack || e.message || e));
    return;
  }
  const diff = diffInventorySnapshot(beforeSnapshot, createInventorySnapshot(gameState));
  const netItems = splitOfflineDispatchBonus(diff.gained);
  const consumedItems = diff.consumed;
  gameState.currentAction.lastProgressUpdate = now;
  gameState.lastActiveTime = now;
  const totalGains = Object.values(gains).reduce((sum, value) => sum + value, 0);
  if (totalGains > 0 || netItems.length > 0 || consumedItems.length > 0) showOfflineToast(elapsed, gains, netItems, offlineCtx.combatSummary, consumedItems);
  gameState._dirty = true;
  SaveManager.save();
}

function forceOfflineTest(seconds) {
  if (!seconds || seconds <= 0) { console.log("用法：forceOfflineTest(60) — 模拟离线 60 秒"); return; }
  const beforeSnapshot = createInventorySnapshot(gameState);
  const offlineCtx = { runId:"offline_test_" + Date.now().toString(36) + "_" + (++_offlineBatchSeq).toString(36) };
  const gains = applyOfflineGains(seconds, offlineCtx);
  const diff = diffInventorySnapshot(beforeSnapshot, createInventorySnapshot(gameState));
  const netItems = splitOfflineDispatchBonus(diff.gained);
  const consumedItems = diff.consumed;
  gameState.currentAction.lastProgressUpdate = Date.now();
  gameState.lastActiveTime = Date.now(); gameState._dirty = true;
  const total = Object.values(gains).reduce((sum, value) => sum + value, 0);
  if (total > 0 || netItems.length > 0 || consumedItems.length > 0) showOfflineToast(seconds, gains, netItems, offlineCtx.combatSummary, consumedItems);
  console.log("[离线测试] 完成", gains);
  updateUI();
  return gains;
}
window.forceOfflineTest = forceOfflineTest;
