/* ================================================================
   内部统计 — GameEvents首个只读消费者

   只记录已经发生的领域事件，不参与生产、战斗或奖励计算。
   ================================================================ */

const GAME_STATISTICS_VERSION = 9;

function createDefaultStatisticsState() {
  return {
    version:GAME_STATISTICS_VERSION,
    totals:{
      events:0, miningCycles:0, minedUnits:0, refiningCycles:0, refinedUnits:0,
      gasCycles:0, gasUnits:0, planetaryCycles:0, planetaryUnits:0,
      manufacturingCycles:0, manufacturedUnits:0, shipsBuilt:0,
      enemyKills:0, eliteKills:0, bossKills:0, wavesCleared:0, zonesCleared:0,
      deathspaceWavesCleared:0, deathspacesCleared:0,
      shipsDestroyed:0, skillLevelsGained:0,
      enhancementAttempts:0, enhancementSuccesses:0, enhancementFailures:0,
      enhancementComponentsSpent:0, highestEnhancementLevel:0, equipmentEnhancementAttempts:0,
      boostersManufactured:0,
      archaeologyAttempts:0, artifactsSold:0, archaeologyLpEarned:0, archaeologyRareFinds:0
    },
    activity:{ onlineEvents:0, offlineEvents:0, onlineCycles:0, offlineCycles:0 },
    production:{ gathered:{}, refined:{}, manufactured:{}, boosters:{} },
    archaeology:{ sites:{}, tiers:{} },
    planetary:{ deployedTypes:{}, maxConcurrentDeployments:0 },
    station:{ constructionCompletions:0, maxConcurrentAutoLines:0, maxOfflineSettlementSeconds:0 },
    combat:{
      factionKills:{}, zoneKills:{}, zoneClears:{}, deathspaceClears:{},
      // v7（Batch C-11 战斗进阶）：历史最高到达波次 / 按武器类型的星带通关数 /
      // 旗舰级与超旗级敌人击杀数（按星带等级归类，死亡空间不计入）。
      maxWaveReached:0,
      zoneClearsByWeapon:{ laser:0, cannon:0, missile:0 },
      capitalEnemyKills:0,
      supercapitalEnemyKills:0,
      // v8（Batch C-12 特殊战斗实装）：死亡空间进入次数、无伤通关星带数、单场最高伤害、三阵营 Boss 击杀
      deathspaceEntries:0,
      flawlessZoneClears:0,
      maxSingleBattleDamage:0,
      factionBossKills:{ angel:0, blood:0, sansha:0 }
    },
    // v9（Batch C-14A 综合生命周期）：J01–J06 的唯一权威事实来源。
    //   onlineSeconds          累计在线秒（保留小数，来自 tick.js 私有锚点的 session:onlineElapsed）
    //   offlineSettlements     真实离线收益结算次数（offline:settlementCompleted 合法一次 +1）
    //   offlineSettledSeconds  累计已结算离线秒（保留小数，单次上限由 offline.js 自身封顶）
    //   maxQueueItems          队列历史最大同时在列项数（权威读 state.queue.items.length）
    //   combatRepairResumes    重创维修后真实恢复出击次数（combat:resumedAfterRepair 合法一次 +1）
    lifecycle:{
      onlineSeconds:0,
      offlineSettlements:0,
      offlineSettledSeconds:0,
      maxQueueItems:0,
      combatRepairResumes:0
    },
    eventLedger:{ processedEventIds:[] }
  };
}

function ensureStatisticsState(state) {
  const defaults = createDefaultStatisticsState();
  const current = state && state.statistics && typeof state.statistics === "object" ? state.statistics : {};
  // 迁移来源版本：在覆盖 version 前捕获。旧档追溯回填（行星部署补录）只在 fromVersion<5 的
  // 真正迁移时执行一次——ensure 在每次事件消费时都会被调用，若无此闸门，
  // planetary:deployed 的事件增量会与回填叠加造成双计数。
  const fromVersion = Number(current.version) || 0;
  const statistics = current;
  statistics.version = GAME_STATISTICS_VERSION;
  statistics.totals = { ...defaults.totals, ...(current.totals || {}) };
  // v1/缺字段旧档迁移到 v2：非法 equipmentEnhancementAttempts 归一为有限非负整数；合法旧值保留。
  if (!Number.isFinite(Number(statistics.totals.equipmentEnhancementAttempts)) ||
      Number(statistics.totals.equipmentEnhancementAttempts) < 0) {
    statistics.totals.equipmentEnhancementAttempts = 0;
  } else {
    statistics.totals.equipmentEnhancementAttempts = Math.floor(Number(statistics.totals.equipmentEnhancementAttempts));
  }
  statistics.activity = { ...defaults.activity, ...(current.activity || {}) };
  statistics.production = current.production && typeof current.production === "object" ? current.production : {};
  for (const key of ["gathered", "refined", "manufactured"]) {
    if (!statistics.production[key] || typeof statistics.production[key] !== "object") statistics.production[key] = {};
  }
  // v3 迁移：booster 累计字段 — 仅接受 typeof number + 有限非负，其余清零
  const rawBM = statistics.totals.boostersManufactured;
  if (typeof rawBM === "number" && Number.isFinite(rawBM) && rawBM >= 0) {
    statistics.totals.boostersManufactured = Math.floor(rawBM);
  } else {
    statistics.totals.boostersManufactured = 0;
  }
  // production.boosters 逐项清洗：仅保留非空 string 键 + typeof number + 有限非负，非法值删除
  const rawBoosters = statistics.production.boosters;
  if (!rawBoosters || typeof rawBoosters !== "object" || Array.isArray(rawBoosters)) {
    statistics.production.boosters = {};
  } else {
    const clean = {};
    for (const key of Object.keys(rawBoosters)) {
      if (typeof key !== "string" || key.length === 0) continue;
      const val = rawBoosters[key];
      if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
        clean[key] = Math.floor(val);
      }
    }
    statistics.production.boosters = clean;
  }
  // v4 迁移（Batch C-7 考古）：4 个 totals 累计字段 — 仅接受 typeof number + 有限非负，其余清零。
  // v1/v2/v3/缺失版本旧档均无考古历史事实，迁移后为 0；不得从当前库存臆测历史。
  for (const key of ["archaeologyAttempts", "artifactsSold", "archaeologyLpEarned", "archaeologyRareFinds"]) {
    const raw = statistics.totals[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      statistics.totals[key] = Math.floor(raw);
    } else {
      statistics.totals[key] = 0;
    }
  }
  // v4 迁移：archaeology.sites / archaeology.tiers map 必须重建 + 逐项清洗
  // （仅保留非空 string 键 + typeof number + 有限非负，非法值删除；两次迁移 JSON 严格一致）。
  const rawArchaeology = current.archaeology;
  const cleanArchaeology = { sites:{}, tiers:{} };
  if (rawArchaeology && typeof rawArchaeology === "object" && !Array.isArray(rawArchaeology)) {
    for (const mapKey of ["sites", "tiers"]) {
      const rawMap = rawArchaeology[mapKey];
      if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) continue;
      for (const key of Object.keys(rawMap)) {
        if (typeof key !== "string" || key.length === 0) continue;
        const val = rawMap[key];
        if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
          cleanArchaeology[mapKey][key] = Math.floor(val);
        }
      }
    }
  }
  statistics.archaeology = cleanArchaeology;
  // v5 迁移（Batch C-8 行星）：deployedTypes 仅保留六个合法 ID（值有限非负、Math.floor）；
  //   maxConcurrentDeployments 有限非负、Math.floor；
  //   旧档当前合法且有效的 deployment 可补入 deployedTypes（仅标记已殖民，幂等）；
  //   当前有效部署数量可提高 maxConcurrentDeployments（取 max，幂等）。
  //   不得从技能等级推测历史部署；迁移本身不 emit 成就、不修改成就 schema。
  const pids = getPlanetaryTypeIds();
  const rawPlanetary = current.planetary;
  const cleanPlanetary = { deployedTypes:{}, maxConcurrentDeployments:0 };
  if (rawPlanetary && typeof rawPlanetary === "object" && !Array.isArray(rawPlanetary)) {
    const rawTypes = rawPlanetary.deployedTypes;
    if (rawTypes && typeof rawTypes === "object" && !Array.isArray(rawTypes)) {
      for (const id of pids) {
        const v = rawTypes[id];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) cleanPlanetary.deployedTypes[id] = Math.floor(v);
      }
    }
    const rawMax = rawPlanetary.maxConcurrentDeployments;
    if (typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax >= 0) cleanPlanetary.maxConcurrentDeployments = Math.floor(rawMax);
  }
  // 旧档当前合法部署补入 deployedTypes（仅标记已殖民），并提高 maxConcurrentDeployments（取 max，幂等）。
  // 仅在真正迁移（fromVersion<5，含缺失版本旧档）时执行：v5 存档的部署事实已全部经
  // planetary:deployed 事件入账，重复回填会与事件增量叠加双计数。
  if (fromVersion < 5) {
    const pDeployments = state.planetary && Array.isArray(state.planetary.deployments) ? state.planetary.deployments : [];
    for (const d of pDeployments) {
      if (pids.indexOf(d.planetType) >= 0 && d.active !== false) {
        cleanPlanetary.deployedTypes[d.planetType] = Math.max(Number(cleanPlanetary.deployedTypes[d.planetType]) || 0, 1);
      }
    }
    const pActive = pDeployments.filter((d) => d.active !== false).length;
    if (pActive > cleanPlanetary.maxConcurrentDeployments) cleanPlanetary.maxConcurrentDeployments = pActive;
  }
  statistics.planetary = cleanPlanetary;
  // v6 迁移（Batch C-9 空间站）：station 三字段仅接受 typeof number + 有限非负，Math.floor；其余清零。
  //   旧档追溯回填只在真正迁移（fromVersion<6，含缺失版本旧档）时执行一次，防止与事件增量双计：
  //   - bodyLevel>=1 或任一建筑等级>=1 → constructionCompletions 至少补为 1（不可争议事实：至少完成过一次建设）；
  //   - 当前 autoLines 中 enabled===true 的数量可提高 maxConcurrentAutoLines（取 max，幂等）；
  //   - 禁止根据 lastActiveTime 推断离线结算历史：v1–v5 旧档无真实离线结算事实时 maxOfflineSettlementSeconds 保持 0。
  const rawStation = current.station;
  const cleanStation = { constructionCompletions:0, maxConcurrentAutoLines:0, maxOfflineSettlementSeconds:0 };
  if (rawStation && typeof rawStation === "object" && !Array.isArray(rawStation)) {
    for (const key of ["constructionCompletions", "maxConcurrentAutoLines", "maxOfflineSettlementSeconds"]) {
      const v = rawStation[key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) cleanStation[key] = Math.floor(v);
    }
  }
  if (fromVersion < 6) {
    const stStation = state && state.station && typeof state.station === "object" ? state.station : null;
    if (stStation) {
      let hasCompletion = typeof stStation.bodyLevel === "number" && Number.isFinite(stStation.bodyLevel) && stStation.bodyLevel >= 1;
      if (!hasCompletion && stStation.buildings && typeof stStation.buildings === "object" && !Array.isArray(stStation.buildings)) {
        for (const bid of Object.keys(stStation.buildings)) {
          const lv = stStation.buildings[bid];
          if (typeof lv === "number" && Number.isFinite(lv) && lv >= 1) { hasCompletion = true; break; }
        }
      }
      if (hasCompletion && cleanStation.constructionCompletions < 1) cleanStation.constructionCompletions = 1;
      const lines = stStation.autoLines && typeof stStation.autoLines === "object" && !Array.isArray(stStation.autoLines) ? stStation.autoLines : {};
      let enabledCount = 0;
      for (const lid of Object.keys(lines)) {
        if (lines[lid] && typeof lines[lid] === "object" && lines[lid].enabled === true) enabledCount++;
      }
      if (enabledCount > cleanStation.maxConcurrentAutoLines) cleanStation.maxConcurrentAutoLines = enabledCount;
    }
  }
  statistics.station = cleanStation;
  statistics.combat = current.combat && typeof current.combat === "object" ? current.combat : {};
  for (const key of ["factionKills", "zoneKills", "zoneClears", "deathspaceClears"]) {
    if (!statistics.combat[key] || typeof statistics.combat[key] !== "object") statistics.combat[key] = {};
  }
  // v7–v8 迁移（Batch C-11/C-12）：4+4 个新战斗字段严格清洗——仅接受 typeof number + 有限非负
  // （Math.floor），其余一律清零；zoneClearsByWeapon 固定按三个合法武器类型键重建，多余键丢弃；
  // factionBossKills 重建干净三键对象，每项清洗为有限非负整数。
  {
    const rawMW = statistics.combat.maxWaveReached;
    statistics.combat.maxWaveReached =
      (typeof rawMW === "number" && Number.isFinite(rawMW) && rawMW >= 0) ? Math.floor(rawMW) : 0;
    for (const key of ["capitalEnemyKills", "supercapitalEnemyKills", "deathspaceEntries", "flawlessZoneClears", "maxSingleBattleDamage"]) {
      const raw = statistics.combat[key];
      statistics.combat[key] =
        (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) ? Math.floor(raw) : 0;
    }
    const rawZW = statistics.combat.zoneClearsByWeapon;
    const cleanZW = {};
    for (const t of getCombatWeaponTypeIds()) {
      const v = (rawZW && typeof rawZW === "object" && !Array.isArray(rawZW)) ? rawZW[t] : undefined;
      cleanZW[t] = (typeof v === "number" && Number.isFinite(v) && v >= 0) ? Math.floor(v) : 0;
    }
    statistics.combat.zoneClearsByWeapon = cleanZW;
    // v8：factionBossKills 仅保留三合法键并清洗为有限非负整数
    const rawFBK = statistics.combat.factionBossKills;
    const cleanFBK = { angel:0, blood:0, sansha:0 };
    if (rawFBK && typeof rawFBK === "object" && !Array.isArray(rawFBK)) {
      for (const f of ["angel","blood","sansha"]) {
        const v = rawFBK[f];
        cleanFBK[f] = (typeof v === "number" && Number.isFinite(v) && v >= 0) ? Math.floor(v) : 0;
      }
    }
    statistics.combat.factionBossKills = cleanFBK;
  }
  // v7 追溯回填：只在真正迁移（fromVersion<7，含缺失版本旧档）时执行一次，防止与事件增量双计：
  //   - 任一星带 zoneClears>0 → maxWaveReached 至少补为 20（通关必然打满 maxWave=20，不可争议事实）；
  //   - 旗舰星带（level 80）zoneKills 合计 → capitalEnemyKills 取 max 回填（幂等）；
  //   - 超旗星带（level 90）zoneKills 合计 → supercapitalEnemyKills 取 max 回填（幂等）；
  //   - zoneClearsByWeapon 旧档无武器类型事实，禁止臆测，保持清洗后的值（通常为 0）。
  if (fromVersion < 7) {
    const legalZoneIds = getCombatZoneIdsForStats();
    const zcMap = statistics.combat.zoneClears;
    let hasAnyClear = false;
    for (const zid of legalZoneIds) {
      const v = zcMap[zid];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) { hasAnyClear = true; break; }
    }
    if (hasAnyClear && statistics.combat.maxWaveReached < 20) statistics.combat.maxWaveReached = 20;
    const zkMap = statistics.combat.zoneKills;
    let capitalSum = 0;
    for (const zid of getCapitalCombatZoneIdsForStats()) {
      const v = zkMap[zid];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) capitalSum += Math.floor(v);
    }
    let supercapitalSum = 0;
    for (const zid of getSupercapitalCombatZoneIdsForStats()) {
      const v = zkMap[zid];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) supercapitalSum += Math.floor(v);
    }
    if (capitalSum > statistics.combat.capitalEnemyKills) statistics.combat.capitalEnemyKills = capitalSum;
    if (supercapitalSum > statistics.combat.supercapitalEnemyKills) statistics.combat.supercapitalEnemyKills = supercapitalSum;
  }
  // v8 追溯回填（Batch C-12）：fromVersion<8 → 仅合法 deathspaceClears 追溯 E26/E27
  if (fromVersion < 8) {
    const dsClears = statistics.combat.deathspaceClears;
    if (dsClears && typeof dsClears === "object" && !Array.isArray(dsClears)) {
      const dsIds = getDeathspaceIdsForStats();
      let hasEntry = false;
      for (const dsId of dsIds) {
        const v = dsClears[dsId];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) { hasEntry = true; break; }
      }
      if (hasEntry && statistics.combat.deathspaceEntries < 1) statistics.combat.deathspaceEntries = 1;
    }
    // E29/E30/E31–E33 无历史承伤/单场伤害/Boss属性数据，禁止臆测，保持清洗后的 0。
  }
  // v9 清洗（Batch C-14A）：lifecycle 五字段。缺失/非法一律归 0。
  //   onlineSeconds / offlineSettledSeconds 为「秒」量纲，保留小数（不得整数化，否则 0.5s 精度会被抹掉）；
  //   其余三个为计数量纲，Math.floor 归一为非负整数。
  const rawLifecycle = current.lifecycle;
  const cleanLifecycle = { ...defaults.lifecycle };
  if (rawLifecycle && typeof rawLifecycle === "object" && !Array.isArray(rawLifecycle)) {
    for (const key of ["onlineSeconds", "offlineSettledSeconds"]) {
      const raw = rawLifecycle[key];
      if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) cleanLifecycle[key] = raw;
    }
    for (const key of ["offlineSettlements", "maxQueueItems", "combatRepairResumes"]) {
      const raw = rawLifecycle[key];
      if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) cleanLifecycle[key] = Math.floor(raw);
    }
  }
  statistics.lifecycle = cleanLifecycle;
  // v9 追溯回填（Batch C-14A）：fromVersion<9 时只从已存在的权威事实推导，不臆测。
  //   J05：当前存档 queue.items 的真实长度是「历史曾达到过」的下界 → 取 max。
  //   J03/J04：station.maxOfflineSettlementSeconds 是 offline.js 真实结算过的最长单次秒数，
  //            >5 说明至少发生过一次真实结算（offline.js 对 <=5 秒直接 return，不发射事件）。
  //   在线时长 / 维修恢复次数无任何历史事实可依，保持 0。
  if (fromVersion < 9) {
    const queueItems = state && state.queue && Array.isArray(state.queue.items) ? state.queue.items : null;
    if (queueItems && queueItems.length > statistics.lifecycle.maxQueueItems) {
      statistics.lifecycle.maxQueueItems = queueItems.length;
    }
    const legacyMaxOffline = statistics.station.maxOfflineSettlementSeconds;
    if (typeof legacyMaxOffline === "number" && Number.isFinite(legacyMaxOffline) && legacyMaxOffline > 5) {
      if (statistics.lifecycle.offlineSettlements < 1) statistics.lifecycle.offlineSettlements = 1;
      if (statistics.lifecycle.offlineSettledSeconds < legacyMaxOffline) {
        statistics.lifecycle.offlineSettledSeconds = legacyMaxOffline;
      }
    }
  }
  statistics.eventLedger = current.eventLedger && typeof current.eventLedger === "object" ? current.eventLedger : {};
  if (!Array.isArray(statistics.eventLedger.processedEventIds)) statistics.eventLedger.processedEventIds = [];
  if (statistics.eventLedger.processedEventIds.length > 512) statistics.eventLedger.processedEventIds = statistics.eventLedger.processedEventIds.slice(-512);
  state.statistics = statistics;
  return statistics;
}

function addStatistic(map, key, amount) {
  if (!key || !Number.isFinite(Number(amount)) || Number(amount) === 0) return;
  map[key] = (Number(map[key]) || 0) + Number(amount);
}

// 六个合法行星类型（与 js/data/planets.js 的 PLANET_TYPES 双向一致）。
// 优先引用 achievement-rules.js 的 PLANETARY_TYPE_IDS；若该数据文件尚未加载
// （如审计沙箱顺序），回退到同样的字面量，保证迁移/消费不依赖加载顺序。
function getPlanetaryTypeIds() {
  if (typeof PLANETARY_TYPE_IDS !== "undefined" && Array.isArray(PLANETARY_TYPE_IDS) && PLANETARY_TYPE_IDS.length > 0) {
    return PLANETARY_TYPE_IDS;
  }
  return ["lava", "gas", "ice", "plasma", "temperate", "storm"];
}

// Batch C-11：三个合法武器类型（与 js/data/combat.js 的 WEAPON_CONFIG 键双向一致）。
// 优先引用 achievement-rules.js 的 COMBAT_WEAPON_TYPES；若数据文件尚未加载
//（如审计沙箱顺序），回退到同样的字面量，保证迁移/消费不依赖加载顺序。
function getCombatWeaponTypeIds() {
  if (typeof COMBAT_WEAPON_TYPES !== "undefined" && Array.isArray(COMBAT_WEAPON_TYPES) && COMBAT_WEAPON_TYPES.length > 0) {
    return COMBAT_WEAPON_TYPES;
  }
  return ["laser", "cannon", "missile"];
}

// Batch C-11：旗舰（level 80）/ 超旗（level 90）星带 ID（与 js/data/combat.js 的 COMBAT_ZONES 双向一致）。
// 同上优先引用 achievement-rules.js 的冻结集合，未加载时回退字面量。
function getCapitalCombatZoneIdsForStats() {
  if (typeof CAPITAL_COMBAT_ZONE_IDS !== "undefined" && Array.isArray(CAPITAL_COMBAT_ZONE_IDS) && CAPITAL_COMBAT_ZONE_IDS.length > 0) {
    return CAPITAL_COMBAT_ZONE_IDS;
  }
  return ["angel_outer_reach", "blood_outer_reliquary", "sansha_outer_array"];
}

function getSupercapitalCombatZoneIdsForStats() {
  if (typeof SUPERCAPITAL_COMBAT_ZONE_IDS !== "undefined" && Array.isArray(SUPERCAPITAL_COMBAT_ZONE_IDS) && SUPERCAPITAL_COMBAT_ZONE_IDS.length > 0) {
    return SUPERCAPITAL_COMBAT_ZONE_IDS;
  }
  return ["angel_deep_domain", "blood_deep_reliquary", "sansha_deep_nexus"];
}

function getCombatZoneIdsForStats() {
  if (typeof COMBAT_ZONE_IDS !== "undefined" && Array.isArray(COMBAT_ZONE_IDS) && COMBAT_ZONE_IDS.length === 18) {
    return COMBAT_ZONE_IDS;
  }
  return ["angel_outpost","blood_hideout","sansha_outpost","angel_corridor",
    "blood_sacrifice","sansha_node","angel_hunting_ground","blood_cathedral",
    "sansha_nexus","angel_warfront","blood_iron_basilica","sansha_command_matrix",
    "angel_outer_reach","blood_outer_reliquary","sansha_outer_array","angel_deep_domain",
    "blood_deep_reliquary","sansha_deep_nexus"];
}

// Batch C-13 收口返修：死亡空间进入统计的权威 ID 集合。
// 权威数据源为 js/data/combat.js 已加载的 DEATHSPACE_DATABASE（全局），取其真实、非空、
// 唯一的 site.id；不得引用 achievement-rules.js 的 DEATHSPACE_IDS_FOR_ACHIEVEMENTS
// （避免 statistics 反向依赖成就模块）。DEATHSPACE_DATABASE 不可用时安全返回 []（不硬编码复制 12 个 ID）。
function getDeathspaceIdsForStats() {
  if (typeof DEATHSPACE_DATABASE === "undefined" || !Array.isArray(DEATHSPACE_DATABASE)) return [];
  const seen = new Set();
  const ids = [];
  for (const site of DEATHSPACE_DATABASE) {
    const id = site && typeof site.id === "string" && site.id.length > 0 ? site.id : null;
    if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids;
}

// Batch C-14A：单次离线结算的秒数上限。权威值为 offline.js 的 MAX_OFFLINE_SECONDS，
// 该文件未加载时（如内核审计沙箱）回退同样的字面量。statistics 不信任 payload：
// 即便有人绕过 offline.js 直接发射超额 settledSeconds，累计量也按上限封顶。
function getMaxOfflineSettledSecondsForStats() {
  if (typeof MAX_OFFLINE_SECONDS !== "undefined" && typeof MAX_OFFLINE_SECONDS === "number" &&
      Number.isFinite(MAX_OFFLINE_SECONDS) && MAX_OFFLINE_SECONDS > 0) {
    return MAX_OFFLINE_SECONDS;
  }
  return 86400;
}

function consumeStatisticsEvent(event) {
  const statistics = ensureStatisticsState(gameState);
  const payload = event.payload;
  const cycles = Math.max(1, Number(payload.cycles) || 1);
  let handled = true;

  switch (event.type) {
    case "mining:completed":
      statistics.totals.miningCycles += cycles;
      statistics.totals.minedUnits += Number(payload.quantity) || 0;
      addStatistic(statistics.production.gathered, payload.resourceId, payload.quantity);
      break;
    case "refining:completed":
      statistics.totals.refiningCycles += cycles;
      statistics.totals.refinedUnits += Number(payload.outputQuantity) || 0;
      addStatistic(statistics.production.refined, payload.outputId, payload.outputQuantity);
      break;
    case "gas:completed":
      statistics.totals.gasCycles += cycles;
      statistics.totals.gasUnits += Number(payload.quantity) || 0;
      addStatistic(statistics.production.gathered, payload.resourceId, payload.quantity);
      break;
    case "planetary:completed":
      statistics.totals.planetaryCycles += cycles;
      statistics.totals.planetaryUnits += Number(payload.quantity) || 0;
      addStatistic(statistics.production.gathered, payload.resourceId, payload.quantity);
      break;
    case "planetary:deployed": {
      // 行星部署（真实 PlanetaryStateActions.deploy 成功后发射）：永久记录已殖民类型，更新历史最大同时运营数。
      // planetType 仅接受六个合法 ID，否则拒绝（handled=false，不 dirty、不增 events）。
      // 与 planetary:completed 共用同一统计链：在线/离线均由 GameEvents 分发，无第二套累计。
      const planetType = payload && payload.planetType;
      const ptids = getPlanetaryTypeIds();
      if (typeof planetType !== "string" || ptids.indexOf(planetType) < 0) { handled = false; break; }
      statistics.planetary.deployedTypes[planetType] = (Number(statistics.planetary.deployedTypes[planetType]) || 0) + 1;
      const deployments = gameState.planetary && Array.isArray(gameState.planetary.deployments) ? gameState.planetary.deployments : [];
      let activeCount = 0;
      for (const d of deployments) { if (d.active !== false) activeCount++; }
      if (activeCount > statistics.planetary.maxConcurrentDeployments) statistics.planetary.maxConcurrentDeployments = activeCount;
      break;
    }
    case "manufacturing:completed":
      statistics.totals.manufacturingCycles += cycles;
      statistics.totals.manufacturedUnits += Number(payload.quantity) || 0;
      if (payload.branch === "ship") statistics.totals.shipsBuilt += Number(payload.quantity) || 0;
      addStatistic(statistics.production.manufactured, payload.recipeId, payload.quantity);
      break;
    case "station:autoLineCompleted":
      // 仅空间站「装备」自动线进入装备制造权威统计；smelting/booster/其他 lineId 不写入 manufactured，避免双计数。
      if (payload.lineId === "equipment") {
        statistics.totals.manufacturingCycles += cycles;
        statistics.totals.manufacturedUnits += Number(payload.quantity) || 0;
        addStatistic(statistics.production.manufactured, payload.targetId, payload.quantity);
      } else {
        handled = false;
      }
      break;
    case "station:constructionCompleted":
      // 空间站建设完成（本体升级/建筑升级共用 completeStationConstruction 发射，在线/离线同链）：每事件恰计 1 次。
      statistics.station.constructionCompletions += 1;
      break;
    case "station:autoLineStarted": {
      // 自动线启动（真实 StationStateActions.startAutoLine 成功后发射）：不信任 payload 数量，
      // 直接读取当前权威状态中 enabled===true 的自动线数量，更新历史最大同时运行数（取 max）。
      // lineId 仅接受非空 string；非法 payload 拒绝（handled=false，不 dirty、不增 events）。
      // 不从 station:autoLineCompleted 的周期数推断「同时运行」。
      if (typeof payload.lineId !== "string" || payload.lineId.length === 0) { handled = false; break; }
      const stLines = gameState.station && gameState.station.autoLines && typeof gameState.station.autoLines === "object"
        ? gameState.station.autoLines : {};
      let runningCount = 0;
      for (const lid of Object.keys(stLines)) {
        if (stLines[lid] && typeof stLines[lid] === "object" && stLines[lid].enabled === true) runningCount++;
      }
      if (runningCount > statistics.station.maxConcurrentAutoLines) statistics.station.maxConcurrentAutoLines = runningCount;
      break;
    }
    case "offline:settlementCompleted": {
      // 离线结算完成（applyOfflineGains 在 settleOfflineTimeline 真实成功后发射，唯一入口）：
      // 更新历史最长单次离线结算秒数（取 max）。settledSeconds 仅接受 typeof number 的有限非负值，
      // 先 floor 再比较；非法 payload 拒绝（handled=false，不 dirty、不增 events）。
      const settled = payload.settledSeconds;
      if (typeof settled !== "number" || !Number.isFinite(settled) || settled < 0) { handled = false; break; }
      const settledInt = Math.floor(settled);
      if (settledInt > statistics.station.maxOfflineSettlementSeconds) statistics.station.maxOfflineSettlementSeconds = settledInt;
      // Batch C-14A（J03/J04）：真实离线结算次数与累计已结算秒数。
      // 与 offline.js 的真实门槛一致——seconds <= 5 在 applyOfflineGains 内直接 return，
      // 不构成一次「真实离线收益结算」，故此处同样要求 > 5；累计量保留小数并按单次上限封顶。
      if (settled > 5) {
        statistics.lifecycle.offlineSettlements += 1;
        statistics.lifecycle.offlineSettledSeconds += Math.min(settled, getMaxOfflineSettledSecondsForStats());
      }
      break;
    }
    case "session:onlineElapsed": {
      // Batch C-14A（J01/J02）：在线会话时间片。唯一合法入口是 tick.js 的模块运行期私有锚点，
      // 它只发射有限正数 seconds。statistics 不信任契约（events.js 的 numbers 校验会放行数字串），
      // 此处严格要求 typeof number + 有限 + > 0，其余一律拒绝（handled=false，不 dirty、不增 events）。
      // 秒数保留小数：不整数化，否则亚秒级 tick 会被抹平导致在线时长永远不增长。
      const elapsed = payload.seconds;
      if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed <= 0) { handled = false; break; }
      statistics.lifecycle.onlineSeconds += elapsed;
      break;
    }
    case "queue:itemAdded": {
      // Batch C-14A（J05）：队列历史最大在列项数。payload.size 仅作诊断，不参与计算——
      // 权威事实只取 gameState.queue.items 的真实长度，防止伪造 size 解锁 J05。
      const qItems = gameState && gameState.queue && Array.isArray(gameState.queue.items)
        ? gameState.queue.items : null;
      if (!qItems) { handled = false; break; }
      if (qItems.length > statistics.lifecycle.maxQueueItems) {
        statistics.lifecycle.maxQueueItems = qItems.length;
      }
      break;
    }
    case "combat:resumedAfterRepair": {
      // Batch C-14A（J06）：重创维修完成后真实恢复出击。combat.js 只在
      // resumeCombatAfterRepair 内 dispatchGameAction("combat/start") 成功后发射一次，
      // 取消维修 / 维修未到期 / 普通手动开火均不会走到此处。
      statistics.lifecycle.combatRepairResumes += 1;
      break;
    }
    case "combat:enemyDefeated":
      statistics.totals.enemyKills++;
      if (payload.enemyKind === "elite") statistics.totals.eliteKills++;
      if (payload.enemyKind === "boss") statistics.totals.bossKills++;
      addStatistic(statistics.combat.factionKills, payload.faction, 1);
      addStatistic(statistics.combat.zoneKills, payload.zoneId, 1);
      // Batch C-11：按星带等级归类旗舰/超旗击杀。死亡空间击杀 payload.zoneId 为
      // deathspaceId，不会命中任何星带集合，天然不计入（无需显式过滤）。
      if (getCapitalCombatZoneIdsForStats().indexOf(payload.zoneId) !== -1) {
        statistics.combat.capitalEnemyKills++;
      } else if (getSupercapitalCombatZoneIdsForStats().indexOf(payload.zoneId) !== -1) {
        statistics.combat.supercapitalEnemyKills++;
      }
      // Batch C-12：仅 boss kind + 合法 faction → 阵营 Boss 击杀计数
      if (payload.enemyKind === "boss" && (payload.faction === "angel" || payload.faction === "blood" || payload.faction === "sansha")) {
        addStatistic(statistics.combat.factionBossKills, payload.faction, 1);
      }
      break;
    case "combat:waveCleared":
      statistics.totals.wavesCleared++;
      break;
    case "combat:zoneCleared": {
      statistics.totals.zonesCleared++;
      addStatistic(statistics.combat.zoneClears, payload.zoneId, 1);
      // Batch C-11（返修）：wave 仅接受 typeof number + 有限非负，严禁字符串等宽松转换。
      // 合法时 Math.floor 后取 max 更新（天然幂等）；否则不更新该字段。
      if (typeof payload.wave === "number" && Number.isFinite(payload.wave) && payload.wave >= 0) {
        const waveFloor = Math.floor(payload.wave);
        if (waveFloor > statistics.combat.maxWaveReached) statistics.combat.maxWaveReached = waveFloor;
      }
      // Batch C-11：weaponTypes 仅接受合法类型，事件内去重后逐类型 +1；非法/重复项忽略。
      const rawTypes = Array.isArray(payload.weaponTypes) ? payload.weaponTypes : [];
      const validTypes = getCombatWeaponTypeIds();
      const counted = [];
      for (const t of rawTypes) {
        if (validTypes.indexOf(t) !== -1 && counted.indexOf(t) === -1) {
          counted.push(t);
          statistics.combat.zoneClearsByWeapon[t] = (Number(statistics.combat.zoneClearsByWeapon[t]) || 0) + 1;
        }
      }
      // Batch C-12：damageTaken 严格 number、有限非负 → damageTaken===0 时无伤通关计数 +1
      if (typeof payload.damageTaken === "number" && Number.isFinite(payload.damageTaken) && payload.damageTaken >= 0) {
        if (payload.damageTaken === 0) statistics.combat.flawlessZoneClears++;
      }
      break;
    }
    case "combat:deathspaceEntered":
      // Batch C-12：先验证 deathspaceId 属于真实冻结 ID 集合，合法后才增加 statistics.combat.deathspaceEntries
      // totals.deathspaceEntries 不存在——权威只有 combat.deathspaceEntries
      {
        const dsIds = getDeathspaceIdsForStats();
        if (dsIds.indexOf(payload.deathspaceId) !== -1) {
          statistics.combat.deathspaceEntries++;
        } else {
          handled = false;
        }
      }
      break;
    case "combat:deathspaceWaveCleared":
      statistics.totals.deathspaceWavesCleared++;
      break;
    case "combat:deathspaceCleared":
      statistics.totals.deathspacesCleared++;
      addStatistic(statistics.combat.deathspaceClears, payload.deathspaceId, 1);
      break;
    case "combat:damageDealt":
      // Batch C-12：严格验证 mode/amount/runTotal；maxSingleBattleDamage 取 floor(runTotal) max
      if (typeof payload.amount !== "number" || !Number.isFinite(payload.amount) || payload.amount < 0 ||
          typeof payload.runTotal !== "number" || !Number.isFinite(payload.runTotal) || payload.runTotal < 0 ||
          (payload.mode !== "belt" && payload.mode !== "deathspace")) {
        handled = false;
        break;
      }
      {
        const dmgInt = Math.floor(payload.runTotal);
        if (dmgInt > statistics.combat.maxSingleBattleDamage) statistics.combat.maxSingleBattleDamage = dmgInt;
      }
      break;
    case "ship:destroyed":
      statistics.totals.shipsDestroyed++;
      break;
    case "ship:enhancementAttempted":
      statistics.totals.enhancementAttempts++;
      if (payload.success) statistics.totals.enhancementSuccesses++;
      else statistics.totals.enhancementFailures++;
      statistics.totals.enhancementComponentsSpent += Number(payload.componentsSpent) || 0;
      statistics.totals.highestEnhancementLevel = Math.max(statistics.totals.highestEnhancementLevel, Number(payload.toLevel) || 0);
      break;
    case "equipment:enhancementAttempted":
      // 装备强化（与舰船强化 enhancementAttempts 相互独立）：成功与失败的合法尝试均计数。
      statistics.totals.equipmentEnhancementAttempts++;
      break;
    case "booster:manufactured":
    case "boosters:manufactured":
      // 增幅剂制造：只接受 typeof number 的有限正数，先 floor 再累计。字符串/NaN/Infinity/负数/0/null 等全部拒绝。
      // 拒绝时 handled 保持 false 使 consumeStatisticsEvent 返回 false，不 dirty、不增 events。
      const q = payload.quantity;
      if (typeof q === "number" && Number.isFinite(q) && q > 0 && Math.floor(q) > 0) {
        const qty = Math.floor(q);
        statistics.totals.boostersManufactured += qty;
        addStatistic(statistics.production.boosters, payload.recipeId, qty);
      } else {
        handled = false;
      }
      break;
    case "archaeology:attemptCompleted": {
      // 考古尝试（在线/离线共用 resolveArchaeologyCycle 发射）：每事件恰计 1 次。
      statistics.totals.archaeologyAttempts += 1;
      break;
    }
    case "archaeology:success": {
      // 考古成功解析：按真实 siteId / tier 逐项累计（F02–F16 / F17 权威事实）。
      // siteId / tier 仅接受非空 string；非法 payload 拒绝（handled=false，不 dirty、不增 events）。
      const siteId = payload.siteId;
      const tierKey = payload.tier;
      if (typeof siteId === "string" && siteId.length > 0 &&
          typeof tierKey === "string" && tierKey.length > 0) {
        statistics.archaeology.sites[siteId] = (Number(statistics.archaeology.sites[siteId]) || 0) + 1;
        statistics.archaeology.tiers[tierKey] = (Number(statistics.archaeology.tiers[tierKey]) || 0) + 1;
      } else {
        handled = false;
      }
      break;
    }
    case "archaeology:artifactFound": {
      // 稀有掉落（F21 权威事实）：仅 category==="unique" 累计；其余类别不入账（handled=false）。
      // 实验室加成掉落同样经由本事件；station:archaeologyBonusTriggered 仅为附加信息，不消费以免双计数。
      if (payload.category === "unique") {
        statistics.totals.archaeologyRareFinds += 1;
      } else {
        handled = false;
      }
      break;
    }
    case "archaeology:artifactsSold":
    case "archaeology:artifactSold": {
      // 文物出售（F18/F19 权威事实）：批量与单售两事件互斥发射，无双计数。
      // 只接受 typeof number 的有限正数 quantity，先 floor 再累计；非法值拒绝。
      const soldQty = payload.quantity;
      if (typeof soldQty === "number" && Number.isFinite(soldQty) && soldQty > 0 && Math.floor(soldQty) > 0) {
        statistics.totals.artifactsSold += Math.floor(soldQty);
      } else {
        handled = false;
      }
      break;
    }
    case "archaeology:artifactsRedeemed":
    case "archaeology:artifactRedeemed": {
      // 考古 LP 兑换（F20 权威事实）：批量 totalLp / 单件 lp 互斥发射；只累计考古兑换 LP，不混入战斗 LP。
      // 只接受 typeof number 的有限正数，先 floor 再累计；非法值拒绝。
      const lpGain = (event.type === "archaeology:artifactsRedeemed") ? payload.totalLp : payload.lp;
      if (typeof lpGain === "number" && Number.isFinite(lpGain) && lpGain > 0 && Math.floor(lpGain) > 0) {
        statistics.totals.archaeologyLpEarned += Math.floor(lpGain);
      } else {
        handled = false;
      }
      break;
    }
    case "skill:levelUp":
      statistics.totals.skillLevelsGained += Math.max(1, Number(payload.level) - Number(payload.previousLevel) || 1);
      break;
    default:
      handled = false;
  }

  if (!handled) return false;
  statistics.totals.events++;
  if (event.meta.offline) {
    statistics.activity.offlineEvents++;
    statistics.activity.offlineCycles += cycles;
  } else {
    statistics.activity.onlineEvents++;
    statistics.activity.onlineCycles += cycles;
  }
  gameState._dirty = true;
  return true;
}

function getStatisticsSnapshot(state) {
  const statistics = state && state.statistics ? state.statistics : createDefaultStatisticsState();
  return JSON.parse(JSON.stringify(statistics));
}

ensureStatisticsState(gameState);
GameEvents.onIdempotent("*", {
  consumerId:"statistics",
  maxEntries:512,
  getLedger:() => ensureStatisticsState(gameState).eventLedger
}, consumeStatisticsEvent);

window.GameStatistics = Object.freeze({ snapshot:() => getStatisticsSnapshot(gameState) });
