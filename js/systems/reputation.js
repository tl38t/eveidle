/* 三方势力声望：保存连续的舰级击毁积分，声望档位只负责映射显示与效果。 */
(function () {
  "use strict";

  const FACTIONS = Object.freeze({
    angel: Object.freeze({ name: "苍穹劫团", weaponSkill: "cannonOps", weaponName: "炮台" }),
    blood: Object.freeze({ name: "赤誓教团", weaponSkill: "laserOps", weaponName: "激光炮" }),
    sansha: Object.freeze({ name: "静默集群", weaponSkill: "missileOperations", weaponName: "导弹发射器" })
  });
  const SHIP_POINTS = Object.freeze({ frigate: 1, destroyer: 3, cruiser: 6, battlecruiser: 10, battleship: 16, capital: 28, supercapital: 45 });
  const BANDS = Object.freeze([
    Object.freeze({ id: "friendly", name: "友善", min: 100000, max: Infinity, eliteBonus: 0 }),
    Object.freeze({ id: "neutral", name: "中立", min: -99999, max: 99999, eliteBonus: 0 }),
    Object.freeze({ id: "alert", name: "警戒", min: -999999, max: -100000, eliteBonus: 0.05 }),
    Object.freeze({ id: "enemy", name: "敌对", min: -3999999, max: -1000000, eliteBonus: 0.15 }),
    Object.freeze({ id: "nemesis", name: "死敌", min: -Infinity, max: -4000000, eliteBonus: 0.30 })
  ]);

  function ensureState(state) {
    const target = state || window.gameState;
    if (!target) return null;
    if (!target.reputation || typeof target.reputation !== "object") target.reputation = {};
    if (!target.reputation.weightedKills || typeof target.reputation.weightedKills !== "object") target.reputation.weightedKills = {};
    for (const faction of Object.keys(FACTIONS)) {
      const value = Number(target.reputation.weightedKills[faction]);
      target.reputation.weightedKills[faction] = Number.isFinite(value) && value >= 0 ? value : 0;
    }
    return target.reputation;
  }

  function shipClassForZone(zone) {
    const level = Number(zone && zone.level) || 1;
    if (level >= 90) return "supercapital";
    if (level >= 80) return "capital";
    if (level >= 60) return "battleship";
    if (level >= 40) return "cruiser";
    if (level >= 20) return "destroyer";
    return "frigate";
  }

  function getScores(state) {
    const rep = ensureState(state);
    const raw = rep ? rep.weightedKills : {};
    const total = Object.keys(FACTIONS).reduce((sum, faction) => sum + (Number(raw[faction]) || 0), 0);
    const scores = {};
    for (const faction of Object.keys(FACTIONS)) scores[faction] = Math.round(total - 3 * (Number(raw[faction]) || 0));
    return scores;
  }

  function getBand(score) {
    return BANDS.find(band => score >= band.min && score <= band.max) || BANDS[1];
  }

  function getFactionReputation(faction, state) {
    const score = getScores(state)[faction] || 0;
    const band = getBand(score);
    return { faction, score, band, data: FACTIONS[faction] || { name: faction, weaponSkill: "", weaponName: "" } };
  }

  function getEliteChanceBonus(faction, state) {
    return getFactionReputation(faction, state).band.eliteBonus;
  }

  // ⚠️ 性能红线（2026-09-18 实测）：applyReputationKill 是**逐击杀**调用（在线走
  // combat:enemyDefeated 事件、离线由 offline-combat.js recordKill 直接调用），而技能总览页
  // 是整页 innerHTML 重渲染。8h 离线战斗实测 25,380 次击杀 ⇒ 25,380 次全页重渲染，
  // 登录结算阻塞 29~38s（两次实测 29,284ms / 38,3xx ms；占比 83.0%~89.4%），**同期采矿离线 8h 仅 3~4ms**。
  // ⚠️ 引入版本 = a426ad2（0.9.6，2026-09-17，声望系统新增）—— 故「战斗离线上线后才卡、采矿不卡」。
  // 故重渲染必须先问「现在真的需要刷吗」：
  //   ① 离线结算临界区内一律不刷（结算结束后页面自会刷新，中途刷 2.5 万次纯属浪费）；
  //      标志由 js/core/offline.js 的 applyOfflineGains 置位/复位（与 combat-log 的
  //      __combatLogOfflineFlush 同一机制，try/finally 保证复位）。
  //   ② 当前不在技能总览页（面板 display:none）不刷 —— 玩家看不见，重绘毫无意义。
  // 取状态异常时按「需要刷新」处理：宁可多刷一次，不可漏刷。
  function shouldRefreshSkillOverview() {
    try {
      if (typeof globalThis !== "undefined" && globalThis.__offlineSettling === true) return false;
      const doc = (typeof document !== "undefined") ? document : null;
      if (doc && typeof doc.getElementById === "function") {
        const panel = doc.getElementById("skill-overview-panel");
        if (panel && panel.style && panel.style.display === "none") return false;
      }
    } catch (err) { /* 忽略：按需刷新 */ }
    return true;
  }

  function applyReputationKill(state, faction, zoneId, enemyClass) {
    if (!FACTIONS[faction]) return;
    const zone = typeof COMBAT_ZONES !== "undefined" ? COMBAT_ZONES.find(item => item.id === zoneId) : null;
    const shipClass = enemyClass || shipClassForZone(zone);
    const points = SHIP_POINTS[shipClass] || SHIP_POINTS.frigate;
    const rep = ensureState(state || window.gameState);
    rep.weightedKills[faction] += points;
    if (state || window.gameState) (state || window.gameState)._dirty = true;
    if (typeof renderSkillOverviewPage === "function" && shouldRefreshSkillOverview()) renderSkillOverviewPage();
  }

  function onEnemyDefeated(event) {
    const payload = event && event.payload ? event.payload : event;
    applyReputationKill(window.gameState, payload && payload.faction, payload && payload.zoneId, payload && payload.enemyClass);
  }

  if (typeof GameEvents !== "undefined") GameEvents.on("combat:enemyDefeated", onEnemyDefeated);
  window.REPUTATION_FACTIONS = FACTIONS;
  window.REPUTATION_BANDS = BANDS;
  window.REPUTATION_SHIP_POINTS = SHIP_POINTS;
  window.ensureReputationState = ensureState;
  window.getFactionReputation = getFactionReputation;
  window.getFactionReputationScores = getScores;
  window.getFactionEliteChanceBonus = getEliteChanceBonus;
  window.getReputationShipClass = shipClassForZone;
  window.applyReputationKill = applyReputationKill;
})();
