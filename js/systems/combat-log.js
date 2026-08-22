/* ================================================================
   战斗日志（combat-log）
   ----------------------------------------------------------------
   目标：呈现「一场战斗」（自用户开始战斗、直到停止/切走为止）的累计统计，
   在线战斗与离线挂机结算合并为同一份，不分开。

   设计（lootAccountingVersion: 2）：
   - 计数器（清剿波次 / 星带肃清 / 死亡空间波·全通 / 击杀 / 精英·BOSS / 被击败）
     走领域事件（在线）与 offline:combatSettled（离线）累计，确定性、无双计。
   - 产物 / ISK / LP **只统计战斗系统自己产生的收益**，由战斗代码在发放奖励时
     实打实写入 runLog.lootGained / iskGained / lpGained（在线经 combat:enemyDefeated
     与死亡空间 LP 事件，离线经 offline:combatSettled.payload.lootGained / iskDelta /
     lpDelta）。
   - **彻底移除对库存快照差的依赖**：库存差会混入生产、开箱、考古等非战斗收益，
     无法区分来源；v2 起正式逻辑不再使用它，老存档（无 lootAccountingVersion:2）
     不回退快照差，而是显示「历史战斗日志无法精确还原掉落」或返回空战利品。
   - ISK / LP 防双计：死亡空间每波 LP 走 combat:deathspaceWaveCleared.payload.lp，
     全通额外 LP 走 combat:deathspaceCleared.payload.clearLp；严禁读取
     deathspaceCleared.payload.lp（那是每波×波数+全通的合计，用于兼容旧逻辑）。
   - 技能经验：钩住战斗唯一经验入口 addStationModifiedCombatXp，仅累计「战斗授予」
     的每技能经验（含在线+离线），排除空间站授予的非战斗经验。
   ================================================================ */

// 技能图标（仅用于日志展示）
const COMBAT_LOG_SKILL_ICON = {
  laserOps: "⚡", cannonOps: "🔥", missileOperations: "🚀", targeting: "🎯",
  defense: "🛡️", shieldOperation: "🔵", armorReinforcement: "🟠", hullEngineering: "🔧",
  drones: "🛸", piloting: "🎮", capacitorManagement: "🔋", combat: "⚔️"
};

// 战斗技能中文名（SKILL_LABEL 只覆盖采矿/冶炼等非战斗技能，不含这些战斗子技能；
// 名称取自游戏内成就文案 / SKILL_DESC 描述，保持一致）。
const COMBAT_LOG_SKILL_NAME = {
  laserOps: "激光操作", cannonOps: "炮台操作", missileOperations: "导弹操作",
  targeting: "瞄准术", defense: "防御", shieldOperation: "护盾操作",
  armorReinforcement: "装甲强化", hullEngineering: "舰船结构工程",
  piloting: "驾驶", capacitorManagement: "电容管理", combat: "战斗"
};

function getCombatLogSkillIcon(key) {
  return (COMBAT_LOG_SKILL_ICON && COMBAT_LOG_SKILL_ICON[key]) || "▶";
}

function getCombatLogSkillName(key) {
  if (COMBAT_LOG_SKILL_NAME && COMBAT_LOG_SKILL_NAME[key]) return COMBAT_LOG_SKILL_NAME[key];
  if (typeof SKILL_LABEL !== "undefined" && SKILL_LABEL && SKILL_LABEL[key]) return SKILL_LABEL[key];
  return key;
}

// 累计「战斗授予」的技能经验。钩住战斗唯一经验入口 addStationModifiedCombatXp
// （在线 combat.js 与离线 offline-combat.js 的 grantXp 都经此函数），
// 该函数的返回值即实际加到技能上的经验量，故只统计战斗经验、天然排除空间站非战斗经验。
function combatLogAddSkillXp(skillId, amount) {
  if (typeof gameState === "undefined" || !gameState || !gameState.combat) return;
  const rl = gameState.combat.runLog;
  if (!rl || typeof rl !== "object") return;
  if (!rl.skillXp || typeof rl.skillXp !== "object") rl.skillXp = {};
  const a = Number(amount) || 0;
  if (a <= 0 || !skillId) return;
  rl.skillXp[skillId] = (Number(rl.skillXp[skillId]) || 0) + a;
}

(function installCombatXpHook() {
  if (typeof window === "undefined") return;
  const orig = window.addStationModifiedCombatXp;
  if (typeof orig !== "function" || orig.__combatLogHooked) return;
  const wrapped = function (state, skillId, baseXp, job) {
    const gained = orig(state, skillId, baseXp, job);
    try { combatLogAddSkillXp(skillId, gained); } catch (e) { /* 不干扰主流程 */ }
    return gained;
  };
  wrapped.__combatLogHooked = true;
  window.addStationModifiedCombatXp = wrapped;
})();

// 确保本场 runLog 存在（旧存档或从未初始化时兜底）。
// v2：初始化 lootAccountingVersion / lootGained / iskGained / lpGained；不再依赖库存快照差。
function ensureCombatRunLog() {
  if (typeof gameState === "undefined" || !gameState || !gameState.combat) return null;
  const combat = gameState.combat;
  if (!combat.runLog || typeof combat.runLog !== "object") {
    const now0 = (typeof Date !== "undefined") ? Date.now() : 0;
    const rl = {
      lootAccountingVersion: 2,
      startedAt: now0, lastActivityAt: now0, runToken: combat.runToken,
      waves: 0, zones: 0, dsWaves: 0, dsClears: 0,
      kills: 0, eliteKills: 0, bossKills: 0, defeats: 0,
      lootGained: {}, iskGained: 0, lpGained: 0,
      startSkills: {},
      skillXp: {}
    };
    if (gameState.skills) {
      for (const k of Object.keys(gameState.skills)) {
        const s = gameState.skills[k];
        rl.startSkills[k] = { xp: s ? (Number(s.xp) || 0) : 0, lvl: s ? (Number(s.lvl) || 1) : 1 };
      }
    }
    combat.runLog = rl;
  } else {
    // 旧存档补齐 v2 字段（不回退库存快照差）
    const rl = combat.runLog;
    if (rl.lootAccountingVersion !== 2) rl.lootAccountingVersion = 2;
    if (!rl.lootGained || typeof rl.lootGained !== "object") rl.lootGained = {};
    if (typeof rl.iskGained !== "number") rl.iskGained = 0;
    if (typeof rl.lpGained !== "number") rl.lpGained = 0;
  }
  return combat.runLog;
}

function combatLogInc(field, n) {
  const rl = ensureCombatRunLog();
  if (!rl) return;
  rl[field] = (Number(rl[field]) || 0) + (Number(n) || 0);
  rl.lastActivityAt = (typeof Date !== "undefined") ? Date.now() : rl.lastActivityAt;
}

// ---- v2 统一累计函数：只统计战斗系统自身产生的收益 ----

// 累计一项战利品（resourceId 为资源键，quantity 为正向数量）。
function combatLogAddLoot(resourceId, quantity) {
  const qty = Number(quantity) || 0;
  if (!resourceId || qty <= 0) return;
  const rl = ensureCombatRunLog();
  if (!rl) return;
  if (!rl.lootGained || typeof rl.lootGained !== "object") rl.lootGained = {};
  rl.lootGained[resourceId] = (Number(rl.lootGained[resourceId]) || 0) + qty;
  rl.lastActivityAt = (typeof Date !== "undefined") ? Date.now() : rl.lastActivityAt;
}

// 累计战斗获得的 ISK（仅来自战斗发放路径）。
function combatLogAddIsk(quantity) {
  const qty = Number(quantity) || 0;
  if (qty <= 0) return;
  const rl = ensureCombatRunLog();
  if (!rl) return;
  rl.iskGained = (Number(rl.iskGained) || 0) + qty;
  rl.lastActivityAt = (typeof Date !== "undefined") ? Date.now() : rl.lastActivityAt;
}

// 累计战斗获得的 LP（仅来自战斗发放路径：死亡空间每波 + 全通额外）。
function combatLogAddLp(quantity) {
  const qty = Number(quantity) || 0;
  if (qty <= 0) return;
  const rl = ensureCombatRunLog();
  if (!rl) return;
  rl.lpGained = (Number(rl.lpGained) || 0) + qty;
  rl.lastActivityAt = (typeof Date !== "undefined") ? Date.now() : rl.lastActivityAt;
}

// 合并一份标准化 lootGained 字典（离线 payload / 在线事件 payload 复用同格式）。
function combatLogMergeLoot(dict) {
  if (!dict || typeof dict !== "object") return;
  for (const id in dict) combatLogAddLoot(id, Number(dict[id]) || 0);
}

function combatLogMergeOffline(payload) {
  // 注意：offline:combatSettled 的 handler 只接收 payload（第一参数），offline 标记在事件
  // context（第三参数）里、不进入 payload，故此处不判断 payload.offline。该事件本身即离线会话。
  if (!payload || typeof payload !== "object") return;
  const rl = ensureCombatRunLog();
  if (!rl) return;
  const sumObj = (o) => {
    if (!o || typeof o !== "object") return 0;
    let s = 0; for (const k in o) s += (Number(o[k]) || 0); return s;
  };
  rl.kills = (Number(rl.kills) || 0) + (Number(payload.kills) || 0);
  const kbk = payload.killsByKind || {};
  rl.eliteKills = (Number(rl.eliteKills) || 0) + (Number(kbk.elite) || 0);
  rl.bossKills = (Number(rl.bossKills) || 0) + (Number(kbk.boss) || 0);
  rl.defeats = (Number(rl.defeats) || 0) + (Number(payload.defeats) || 0);
  rl.waves = (Number(rl.waves) || 0) + sumObj(payload.wavesByZone);
  rl.zones = (Number(rl.zones) || 0) + sumObj(payload.zoneClearsByZone);
  rl.dsWaves = (Number(rl.dsWaves) || 0) + sumObj(payload.deathspaceWavesById);
  rl.dsClears = (Number(rl.dsClears) || 0) + sumObj(payload.deathspaceClearsById);
  // v2：仅合并战斗自身产生的收益（禁止从全局库存算差）。
  if (payload.lootGained && typeof payload.lootGained === "object") combatLogMergeLoot(payload.lootGained);
  if (typeof payload.iskDelta === "number" && payload.iskDelta > 0) combatLogAddIsk(payload.iskDelta);
  if (typeof payload.lpDelta === "number" && payload.lpDelta > 0) combatLogAddLp(payload.lpDelta);
  rl.lastActivityAt = (typeof Date !== "undefined") ? Date.now() : rl.lastActivityAt;
}

// 取本场战斗日志（惰性计算产物 / ISK / LP / 技能经验）
function getCombatLog() {
  if (typeof gameState === "undefined" || !gameState || !gameState.combat) return null;
  const combat = gameState.combat;
  const rl = combat.runLog;
  if (!rl || typeof rl !== "object") return null;
  const running = combat.active === true || (gameState.currentAction && gameState.currentAction.skill === "combat");

  // v2：产物 / ISK / LP 只读战斗自身累计的 lootGained / iskGained / lpGained。
  // 老存档（无 lootAccountingVersion:2）不回退库存快照差——返回空战利品并附提示，
  // 因为快照差会混入生产/开箱/考古等非战斗收益，无法精确还原。
  let isk = 0, lp = 0;
  const loot = [];
  const legacy = rl.lootAccountingVersion !== 2;
  if (!legacy) {
    isk = Number(rl.iskGained) || 0;
    lp = Number(rl.lpGained) || 0;
    const lg = (rl.lootGained && typeof rl.lootGained === "object") ? rl.lootGained : {};
    const names = (typeof getResourceDisplayName === "function") ? getResourceDisplayName : null;
    for (const id of Object.keys(lg)) {
      const qty = Number(lg[id]) || 0;
      if (qty <= 0) continue;
      loot.push({ id, quantity: qty, name: (names ? names(id) : null) });
    }
    loot.sort((a, b) => b.quantity - a.quantity);
  }

  // 技能经验（仅战斗授予，经 addStationModifiedCombatXp 累计到 runLog.skillXp）。
  // 不含空间站授予的非战斗经验；天然覆盖在线 + 离线。
  const skills = [];
  const skillXp = (rl.skillXp && typeof rl.skillXp === "object") ? rl.skillXp : {};
  const startSkills = rl.startSkills || {};
  const curSkills = gameState.skills || {};
  for (const key of Object.keys(skillXp)) {
    const xp = Number(skillXp[key]) || 0;
    if (xp <= 0) continue;
    const cur = curSkills[key];
    const lvlNow = cur ? (Number(cur.lvl) || 1) : 1;
    const startLvl = (startSkills[key] && Number(startSkills[key].lvl)) || lvlNow;
    const leveled = lvlNow > startLvl;
    let progress = 0;
    if (cur && typeof xpForLevel === "function") {
      const need = xpForLevel(lvlNow);
      if (need > 0) progress = Math.max(0, Math.min(100, Math.floor((Number(cur.xp) || 0) / need * 100)));
    }
    skills.push({
      key,
      name: getCombatLogSkillName(key),
      icon: getCombatLogSkillIcon(key),
      xp: xp,
      lvlNow,
      startLvl,
      leveled,
      progress
    });
  }
  skills.sort((a, b) => b.xp - a.xp);

  const endRef = running ? ((typeof Date !== "undefined") ? Date.now() : rl.lastActivityAt) : (rl.lastActivityAt || rl.startedAt);
  const elapsedMs = Math.max(0, (endRef || 0) - (rl.startedAt || 0));

  return {
    startedAt: rl.startedAt || 0,
    running: running,
    elapsedMs,
    legacyLoot: legacy,
    legacyLootNote: legacy ? "历史战斗日志无法精确还原掉落" : null,
    waves: Number(rl.waves) || 0,
    zones: Number(rl.zones) || 0,
    dsWaves: Number(rl.dsWaves) || 0,
    dsClears: Number(rl.dsClears) || 0,
    kills: Number(rl.kills) || 0,
    eliteKills: Number(rl.eliteKills) || 0,
    bossKills: Number(rl.bossKills) || 0,
    defeats: Number(rl.defeats) || 0,
    isk: isk,
    lp: lp,
    loot: loot,
    skills: skills
  };
}

// ---- 事件接线 ----
if (typeof GameEvents !== "undefined" && GameEvents && typeof GameEvents.on === "function") {
  GameEvents.on("combat:enemyDefeated", function (e) {
    if (!e) return;
    combatLogInc("kills", 1);
    // GameEvents.emit 传入的是完整 event 对象（{type, payload, meta, ...}），payload 在 e.payload 里。
    const ek = e.payload && e.payload.enemyKind;
    if (ek === "elite") combatLogInc("eliteKills", 1);
    else if (ek === "boss") combatLogInc("bossKills", 1);
    // v2：直接累计本场战斗自身产生的掉落（lootGained 为标准化字典，已含 ISK）。
    const p = e.payload || {};
    if (p.lootGained && typeof p.lootGained === "object") combatLogMergeLoot(p.lootGained);
    if (typeof p.isk === "number" && p.isk > 0) combatLogAddIsk(p.isk);
  });
  GameEvents.on("combat:waveCleared", function () { combatLogInc("waves", 1); });
  GameEvents.on("combat:zoneCleared", function () { combatLogInc("zones", 1); });
  GameEvents.on("combat:deathspaceWaveCleared", function (e) {
    combatLogInc("dsWaves", 1);
    // 死亡空间每波 LP 走本事件的 lp 字段（禁止读 deathspaceCleared.payload.lp 以免双计）。
    const lp = e && e.payload && (typeof e.payload.lp === "number") ? e.payload.lp : 0;
    if (lp > 0) combatLogAddLp(lp);
  });
  GameEvents.on("combat:deathspaceCleared", function (e) {
    combatLogInc("dsClears", 1);
    // 全通额外 LP 走独立 clearLp 字段；严禁读 payload.lp（那是每波×波数+全通的合计）。
    const clearLp = e && e.payload && (typeof e.payload.clearLp === "number") ? e.payload.clearLp : 0;
    if (clearLp > 0) combatLogAddLp(clearLp);
  });
  // 在线战败→维修→恢复计一次被击败。离线战斗走 offline:combatSettled 的 defeats 字段，
  // 且离线 combat 不会发射 combat:resumedAfterRepair，故这里无需按 offline 过滤，也不会双计。
  GameEvents.on("combat:resumedAfterRepair", function () {
    combatLogInc("defeats", 1);
  });
  // 离线战斗聚合结算：合并战斗自身收益（lootGained / iskDelta / lpDelta）。
  GameEvents.on("offline:combatSettled", function (e) { combatLogMergeOffline(e && e.payload); });
}
