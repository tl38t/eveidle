/* ================================================================
   旗舰战斗规则 — 纯函数层

   只描述索敌决策与舰体固有特性，不读取/写入 gameState，不操作 DOM。
   ================================================================ */

const CAPITAL_TARGETING_MODES = Object.freeze([
  Object.freeze({ id:"formation", name:"按编队顺序" }),
  Object.freeze({ id:"elite", name:"优先精英" }),
  Object.freeze({ id:"boss", name:"优先BOSS" }),
  Object.freeze({ id:"highest_damage", name:"优先最高攻击" }),
  Object.freeze({ id:"lowest_hp", name:"优先最低生命" }),
  // 2026-09-04 客户要求新增：优先最高生命。
  // 注意：纯单体攻击下清场轮数与「优先最低生命」基本相同（浪费只发生在击杀那一击，与顺序无关），
  //      但会让敌人存活更久、全程挨满伤害，通常更吃亏；真正有价值的场景是配合旗舰 AOE——
  //      主攻完整吸进高血量目标不浪费，溅射顺手清掉残血小怪。
  Object.freeze({ id:"highest_hp", name:"优先最高生命" })
]);

function isCapitalCombatShip(shipConfig) {
  // 2026-09-09：纳入泰坦（type "titan"）——索敌模式/capital-only 行为与旗舰同权。
  // 泰坦特质 id 带 titan_ 前缀，下方超旗特质函数按 id 精确匹配会自动 no-op，互不干扰。
  return Boolean(shipConfig && (shipConfig.type === "capital" || shipConfig.type === "supercapital" || shipConfig.type === "titan"));
}

function normalizeCapitalTargetingMode(mode) {
  const value = String(mode || "formation");
  return CAPITAL_TARGETING_MODES.some(item => item.id === value) ? value : "formation";
}

function getCapitalTargetingModeName(mode) {
  const normalized = normalizeCapitalTargetingMode(mode);
  const item = CAPITAL_TARGETING_MODES.find(option => option.id === normalized);
  return item ? item.name : CAPITAL_TARGETING_MODES[0].name;
}

function getCombatEnemyTotalHp(enemy) {
  if (!enemy || !enemy.hp) return Number.POSITIVE_INFINITY;
  return ["shield", "armor", "structure"].reduce((sum, layer) => sum + Math.max(0, Number(enemy.hp[layer]) || 0), 0);
}

function selectCapitalCombatTarget(enemies, mode, shipConfig) {
  const living = (Array.isArray(enemies) ? enemies : []).filter(enemy => enemy && !enemy.defeated && enemy.hp && enemy.hp.structure > 0);
  if (living.length === 0) return null;
  if (!isCapitalCombatShip(shipConfig)) return living[0];
  const normalized = normalizeCapitalTargetingMode(mode);
  if (normalized === "elite") return living.find(enemy => enemy.kind === "elite") || living[0];
  if (normalized === "boss") return living.find(enemy => enemy.kind === "boss") || living[0];
  if (normalized === "highest_damage") {
    return living.reduce((selected, enemy) => (Number(enemy.baseDamage) || 0) > (Number(selected.baseDamage) || 0) ? enemy : selected, living[0]);
  }
  if (normalized === "lowest_hp") {
    return living.reduce((selected, enemy) => getCombatEnemyTotalHp(enemy) < getCombatEnemyTotalHp(selected) ? enemy : selected, living[0]);
  }
  // 优先最高生命（与 lowest_hp 对称，仅比较符相反）
  if (normalized === "highest_hp") {
    return living.reduce((selected, enemy) => getCombatEnemyTotalHp(enemy) > getCombatEnemyTotalHp(selected) ? enemy : selected, living[0]);
  }
  return living[0];
}

function getCapitalCombatTrait(shipConfig) {
  return isCapitalCombatShip(shipConfig) && shipConfig.capitalTrait ? shipConfig.capitalTrait : null;
}

function applyCapitalShieldMitigation(shipConfig, damage, shieldHitsUsed, currentShield) {
  const trait = getCapitalCombatTrait(shipConfig);
  const baseDamage = Math.max(0, Number(damage) || 0);
  if (!trait || trait.id !== "deflection_shield" || currentShield <= 0 || baseDamage <= 0 || shieldHitsUsed >= trait.shieldHits) {
    return { damage:baseDamage, mitigated:0, shieldHitUsed:false };
  }
  const reducedDamage = baseDamage * (1 - trait.reduction);
  return { damage:reducedDamage, mitigated:baseDamage - reducedDamage, shieldHitUsed:true };
}

function getCapitalReactiveArmorRepair(shipConfig, armorDamageTaken, maxArmor) {
  const trait = getCapitalCombatTrait(shipConfig);
  if (!trait || trait.id !== "reactive_armor") return 0;
  const restored = Math.max(0, Number(armorDamageTaken) || 0) * trait.restoreRate;
  const cap = Math.max(0, Number(maxArmor) || 0) * trait.maxArmorRate;
  return Math.max(0, Math.round(Math.min(restored, cap)));
}

function getCapitalWeaponTraitMultiplier(shipConfig, weaponType, hp, maxHp) {
  const trait = getCapitalCombatTrait(shipConfig);
  if (!trait || trait.id !== "structure_overdrive" || weaponType !== "cannon") return 1;
  const maximum = Math.max(1, Number(maxHp && maxHp.structure) || 1);
  const current = Math.max(0, Math.min(maximum, Number(hp && hp.structure) || 0));
  const missingRatio = 1 - current / maximum;
  const layers = Math.min(trait.maxLayers, Math.floor((missingRatio + 1e-9) / 0.10));
  return 1 + layers * trait.perLayer;
}

function getCapitalAreaDamageTargets(enemies, primaryEnemy, aoeConfig) {
  if (!aoeConfig || !primaryEnemy) return [];
  const living = (Array.isArray(enemies) ? enemies : []).filter(enemy =>
    enemy && enemy !== primaryEnemy && !enemy.defeated && enemy.hp && enemy.hp.structure > 0);
  const multiplier = Math.max(0, Number(aoeConfig.multiplier) || 0);
  if (multiplier <= 0 || living.length === 0) return [];
  const maxTargets = aoeConfig.mode === "all"
    ? living.length
    : Math.max(0, Math.floor(Number(aoeConfig.maxTargets) || 0));
  return living.slice(0, maxTargets).map(enemy => ({ enemy, multiplier }));
}

// ================================================================
// 泰坦武器层纯函数（阶段 3 步骤 2，2026-09-09）
// 泰坦 = type "titan" 的第三类资本舰；特质 id 带 titan_ 前缀，与超旗特质互不触发。
// 公式真值在 js/data/titans.js（getTitanWeaponRoundDamage / getTitanExtraAttacks），
// 本层只做「特质结算 + 打击目标解析 + 透层扣血」，禁止在调用方重写这些公式。
// ================================================================

function isTitanCombatShip(shipConfig) {
  return Boolean(shipConfig && shipConfig.type === "titan");
}

function getTitanCombatTrait(shipConfig) {
  return isTitanCombatShip(shipConfig) && shipConfig.capitalTrait ? shipConfig.capitalTrait : null;
}

// 泰坦结构过载（B 案）：加成泰坦主武器，不限武器类型——与超旗 getCapitalWeaponTraitMultiplier
// 的火炮专属 gate 刻意不同（用户拍板），阶段 3+ 禁止复用超旗函数替代本函数。
function getTitanStructureOverdriveMultiplier(trait, hp, maxHp) {
  if (!trait || trait.id !== "titan_structure_overdrive") return 1;
  const maximum = Math.max(1, Number(maxHp && maxHp.structure) || 1);
  const current = Math.max(0, Math.min(maximum, Number(hp && hp.structure) || 0));
  const missingRatio = 1 - current / maximum;
  const threshold = Number(trait.thresholdPct) || 0.10;
  const layers = Math.min(trait.maxLayers, Math.floor((missingRatio + 1e-9) / threshold));
  return 1 + layers * trait.perLayer;
}

// 偏导护盾（泰坦版）：与超旗偏导同一数学形态（次数 × 减伤），id 不同；返回 triggered 供稳态回充计数。
// 盾空判定与超旗一致：命中瞬间盾 >0 才触发（currentShield 由调用方按命中时刻传入）。
function applyTitanShieldMitigation(trait, damage, shieldHitsUsed, currentShield) {
  const baseDamage = Math.max(0, Number(damage) || 0);
  if (!trait || trait.id !== "titan_deflection_shield" || currentShield <= 0 || baseDamage <= 0 || shieldHitsUsed >= trait.shieldHits) {
    return { damage: baseDamage, mitigated: 0, triggered: false };
  }
  const reducedDamage = baseDamage * (1 - trait.reduction);
  return { damage: reducedDamage, mitigated: baseDamage - reducedDamage, triggered: true };
}

// 稳态回充：每次偏导触发回盾 shieldPctPerTrigger × 最大护盾；护盾见底当轮起偏导不触发 → 回充自然归零。
// 返回基础回充量；通用维修乘区（技能/科研/脑插）由调用方应用（ship 级无 shieldRepair 字段，与星冕惯例一致）。
function getTitanSteadyRechargeRepair(trait, triggerCount, maxShield) {
  const hook = trait && trait.hook && trait.hook.id === "steady_recharge" ? trait.hook : null;
  if (!hook || !(triggerCount > 0)) return 0;
  return Math.max(0, Math.round(triggerCount * hook.shieldPctPerTrigger * Math.max(0, Number(maxShield) || 0)));
}

// 强化应激装甲（泰坦版）：回复 = min(本轮甲损 × restoreRate, 最大甲 × maxArmorRate)。
// armorRepair（舰体 1.00 + 装备）与通用维修乘区由调用方在 min 之后显式应用（consumesRepairMultiplier 语义）。
function getTitanReactiveArmorRepair(trait, armorDamageTaken, maxArmor) {
  if (!trait || trait.id !== "titan_reactive_armor") return 0;
  const restored = Math.max(0, Number(armorDamageTaken) || 0) * trait.restoreRate;
  const cap = Math.max(0, Number(maxArmor) || 0) * trait.maxArmorRate;
  return Math.max(0, Math.round(Math.min(restored, cap)));
}

// 过载密封：基础回复 = 本轮结构损失 × baseRestoreRate × (1 + perLayerRepairBonus × 当前过载层数)。
// structureRepair(+200%)/紧急维修(<70% 结构 +100%)/通用乘区由调用方显式应用。
function getTitanOverdriveSealRepair(trait, structureDamageTaken, overdriveLayers) {
  const hook = trait && trait.hook && trait.hook.id === "overdrive_seal" ? trait.hook : null;
  const taken = Math.max(0, Number(structureDamageTaken) || 0);
  if (!hook || taken <= 0) return 0;
  const layers = Math.max(0, Math.min(trait.maxLayers, Number(overdriveLayers) || 0));
  return Math.max(0, Math.round(taken * hook.baseRestoreRate * (1 + hook.perLayerRepairBonus * layers)));
}

// 泰坦武器打击解析：把 titans.js getTitanExtraAttacks 产出的抽象打击列表解析为具体目标。
//   sweep "next"：主目标以外、按存活序列逐个占位（count 个打击吃前 count 个存活其他目标）；
//   sweep "all"：主目标以外全部存活敌；retriggerSweep（破片回响）：占位游标归零后按武器
//   perShotSweep 的 mode 再展开一轮完整齐射；layerPierce / extra("current")：主目标；
//   extra("randomOther")：rng 掷一个其他存活敌（无其他存活时落空）。
// 暴击不在本函数内结算：调用方按 kind 逐发掷（sweep 仅在 crit.appliesToSweep 时参与）。
function resolveTitanWeaponStrikes(strikes, weapon, enemies, primaryEnemy, rng) {
  const out = [];
  const roll = (typeof rng === "function") ? rng : Math.random;
  const living = (Array.isArray(enemies) ? enemies : []).filter(enemy =>
    enemy && enemy !== primaryEnemy && !enemy.defeated && enemy.hp && enemy.hp.structure > 0);
  if (!primaryEnemy || !Array.isArray(strikes)) return out;
  const sweepMode = weapon && weapon.perShotSweep && weapon.perShotSweep.mode === "all" ? "all" : "next";
  let sweepIdx = 0;
  const expandSweep = (mode, count, damage) => {
    if (mode === "all") {
      for (const enemy of living) out.push({ kind: "sweep", enemy, damage });
    } else {
      const n = Math.max(0, Math.floor(Number(count) || 1));
      for (let i = 0; i < n; i++) {
        const enemy = living[sweepIdx];
        if (!enemy) break;
        out.push({ kind: "sweep", enemy, damage });
        sweepIdx++;
      }
    }
  };
  for (const strike of strikes) {
    if (!strike || !(Number(strike.damage) > 0)) continue;
    if (strike.kind === "sweep") {
      expandSweep(strike.target === "all" ? "all" : "next", 1, strike.damage);
    } else if (strike.kind === "retriggerSweep") {
      // 回响概率在解析器内掷：在线 rng 掷随机；离线统计等效不由本函数处理（步骤 5 用期望值，不经 resolver）。
      if (Number.isFinite(strike.chance) && roll() >= Number(strike.chance)) continue;
      sweepIdx = 0; // 回响 = 再触发一次完整齐射，目标重新从队首取
      expandSweep(sweepMode, strike.count || 1, strike.damage);
    } else if (strike.kind === "layerPierce") {
      out.push({ kind: "layerPierce", enemy: primaryEnemy, damage: strike.damage });
    } else if (strike.kind === "extra") {
      if (strike.target === "randomOther") {
        if (living.length > 0) out.push({ kind: "extra", enemy: living[Math.floor(roll() * living.length)], damage: strike.damage });
      } else {
        out.push({ kind: "extra", enemy: primaryEnemy, damage: strike.damage, debuff: strike.debuff || null });
      }
    }
  }
  return out;
}

// 透层贯穿：主命中最深触及哪一层，贯穿伤害从下一层开始吸收（盾→甲→结）；主命中触及结构层则不触发。
// mainDealt = applyLayeredCombatDamage 的返回明细（combat.js:804，在线/离线共用同一原语）。
// 返回贯穿自身的吸收明细；贯穿不再触发二次贯穿。
function applyTitanLayerPierceDamage(hp, mainDealt, pierceDamage) {
  const dealt = { shield: 0, armor: 0, structure: 0 };
  const remaining0 = Math.max(0, Math.floor(Number(pierceDamage) || 0));
  if (remaining0 <= 0 || !hp) return dealt;
  let startLayer;
  if (mainDealt && mainDealt.structure > 0) startLayer = null;
  else if (mainDealt && mainDealt.armor > 0) startLayer = "structure";
  else startLayer = "armor"; // 主命中只落在盾（或明细缺失）→ 透装甲
  if (!startLayer) return dealt;
  const order = ["shield", "armor", "structure"];
  let remaining = remaining0;
  for (let i = order.indexOf(startLayer); i < order.length && remaining > 0; i++) {
    const layer = order[i];
    if (hp[layer] <= 0) continue;
    const absorbed = Math.min(remaining, hp[layer]);
    hp[layer] -= absorbed;
    remaining -= absorbed;
    dealt[layer] += absorbed;
  }
  return dealt;
}

// 暴击结算：在线传 rng 逐发掷随机；离线（rng 非函数）返回期望乘数 1 + chance×(multiplier−1)，
// 与统计等效原则一致（对齐 offline-combat 期望伤害 rng=0.5 的既有口径）。
function rollTitanCritMultiplier(crit, rng) {
  if (!crit || !(crit.chance > 0) || !(crit.multiplier > 1)) return 1;
  if (typeof rng === "function") return rng() < crit.chance ? crit.multiplier : 1;
  return 1 + crit.chance * (crit.multiplier - 1);
}

// ===== 泰坦核心层（末日武器）纯函数：在线/离线共用 =====

// 天罚裁决点名：敌方 baseDamage 最高的存活目标（对齐数据层 targetSelection:"highestBaseDamageAlive"）。
function selectTitanDoomTarget(enemies) {
  const living = (Array.isArray(enemies) ? enemies : []).filter(enemy =>
    enemy && !enemy.defeated && enemy.hp && enemy.hp.structure > 0);
  if (living.length === 0) return null;
  let best = living[0];
  for (let i = 1; i < living.length; i++) {
    if ((living[i].baseDamage || 0) > (best.baseDamage || 0)) best = living[i];
  }
  return best;
}

// 眩晕递减判定：同目标（按 enemy.id 键控，JSON 可序列化进战斗快照）战斗内首次必晕，
// 之后每次以 resistAfterFirst 概率抵抗；眩晕失败伤害照常。
// stunCounts = { [enemyId]: 已成功眩晕次数 }，由调用方持有并在成功后 +1。
// 返回 { stunned:boolean }。
function rollTitanStun(stunDiminishing, priorStunCount, rng) {
  if (!stunDiminishing || !(priorStunCount > 0)) return { stunned: true };
  const resist = Number(stunDiminishing.resistAfterFirst) || 0;
  if (!(resist > 0)) return { stunned: true };
  const roll = (typeof rng === "function") ? rng : Math.random;
  return { stunned: roll() >= resist };
}

// 裂界侵蚀易伤标记：受击敌写入轮次戳（含当轮，持续 rounds 轮）。
// 存于 enemy.titanVuln = { pct, untilRound }，JSON 随敌对象进战斗快照/离线追算。
// 返回 boolean（是否写入）。
function applyTitanVulnerabilityMark(enemy, vulnerability, currentRound) {
  if (!enemy || !vulnerability || !(vulnerability.pct > 0) || !(vulnerability.rounds > 0)) return false;
  const until = (currentRound || 1) + Math.floor(vulnerability.rounds) - 1;
  const existing = enemy.titanVuln;
  // 同一来源重复命中：取更高 pct 与更晚到期（与「同类取最高」的光环聚合语义一致）
  if (existing && existing.untilRound >= until && (existing.pct || 0) >= vulnerability.pct) return false;
  enemy.titanVuln = { pct: Math.max(vulnerability.pct, (existing && existing.untilRound >= until) ? (existing.pct || 0) : 0), untilRound: until };
  return true;
}

// 易伤读取：敌当前受到小队伤害的乘数（>untilRound 过期自动失效，无需清理步）。
function getTitanDamageTakenMultiplier(enemy, currentRound) {
  const vuln = enemy && enemy.titanVuln;
  if (!vuln || !(vuln.pct > 0) || (currentRound || 1) > vuln.untilRound) return 1;
  return 1 + vuln.pct;
}

// 核心打击解析：把数据层 getTitanCoreStrikes 的待执行打击落到具体目标上。
//   doomStrike → 点名最高 baseDamage 存活敌 + 掷眩晕递减（成功则 stunCounts[id]+1）。
//   coreAoe   → 主目标 mainDamagePct + 其余存活敌 othersDamagePct，全部受击敌打易伤标记。
// 返回 { strikes:[{kind,enemy,damage,stunned?}], skipped:boolean }；
// skipped = 该轮非触发轮 / 无存活目标（不区分，调用方按 0 打击处理即可，这里仅便于调试）。
function resolveTitanCoreStrikes(coreStrikes, core, enemies, primaryEnemy, stunCounts, currentRound, rng) {
  const out = { strikes: [], skipped: false };
  if (!Array.isArray(coreStrikes) || coreStrikes.length === 0) { out.skipped = true; return out; }
  const counts = stunCounts || {};
  for (const strike of coreStrikes) {
    if (!strike || !(Number(strike.damage) > 0)) continue;
    if (strike.kind === "doomStrike") {
      const target = selectTitanDoomTarget(enemies);
      if (!target) { out.skipped = true; continue; }
      const roll = rollTitanStun(core && core.stunDiminishing, counts[target.id] || 0, rng);
      if (roll.stunned) counts[target.id] = (counts[target.id] || 0) + 1;
      out.strikes.push({ kind: "doomStrike", enemy: target, damage: strike.damage, stunned: roll.stunned });
    } else if (strike.kind === "coreAoe") {
      const living = (Array.isArray(enemies) ? enemies : []).filter(enemy =>
        enemy && !enemy.defeated && enemy.hp && enemy.hp.structure > 0);
      if (living.length === 0) { out.skipped = true; continue; }
      // 数据层已按主/副倍率算好：strike.damage = 主目标伤、strike.othersDamage = 副目标伤
      const main = Number(strike.damage);
      const others = (Number(strike.othersDamage) > 0) ? Number(strike.othersDamage) : main;
      for (const enemy of living) {
        const isPrimary = enemy === primaryEnemy;
        out.strikes.push({ kind: "coreAoe", enemy, damage: isPrimary ? main : others, isPrimary });
        applyTitanVulnerabilityMark(enemy, core && core.vulnerability, currentRound);
      }
    }
  }
  return out;
}

// 核心断供检查：本回合资源是否足够支撑本次核心触发/维持。
// cost = { fuel, ammo }（在线为当轮实耗，sustain 每轮、perTrigger 触发轮）。
// 不够 → 调用方跳过本次触发（不阻塞主武器），与 NPC no-fuel/no-ammo skip 语义对齐。
function hasTitanCoreSupply(cost, fuel, ammo) {
  if (!cost) return true;
  if ((cost.fuel || 0) > 0 && !((fuel || 0) >= cost.fuel)) return false;
  if ((cost.ammo || 0) > 0 && !((ammo || 0) >= cost.ammo)) return false;
  return true;
}

window.CapitalCombat = Object.freeze({
  targetingModes:CAPITAL_TARGETING_MODES,
  isCapitalShip:isCapitalCombatShip,
  isTitanShip:isTitanCombatShip,
  normalizeTargetingMode:normalizeCapitalTargetingMode,
  getTargetingModeName:getCapitalTargetingModeName,
  selectTarget:selectCapitalCombatTarget,
  getTrait:getCapitalCombatTrait,
  getTitanTrait:getTitanCombatTrait,
  applyShieldMitigation:applyCapitalShieldMitigation,
  applyTitanShieldMitigation:applyTitanShieldMitigation,
  getReactiveArmorRepair:getCapitalReactiveArmorRepair,
  getTitanReactiveArmorRepair:getTitanReactiveArmorRepair,
  getTitanSteadyRechargeRepair:getTitanSteadyRechargeRepair,
  getTitanOverdriveSealRepair:getTitanOverdriveSealRepair,
  getWeaponTraitMultiplier:getCapitalWeaponTraitMultiplier,
  getTitanStructureOverdriveMultiplier:getTitanStructureOverdriveMultiplier,
  getAreaDamageTargets:getCapitalAreaDamageTargets,
  resolveTitanWeaponStrikes:resolveTitanWeaponStrikes,
  applyTitanLayerPierceDamage:applyTitanLayerPierceDamage,
  rollTitanCritMultiplier:rollTitanCritMultiplier,
  selectTitanDoomTarget:selectTitanDoomTarget,
  rollTitanStun:rollTitanStun,
  applyTitanVulnerabilityMark:applyTitanVulnerabilityMark,
  getTitanDamageTakenMultiplier:getTitanDamageTakenMultiplier,
  resolveTitanCoreStrikes:resolveTitanCoreStrikes,
  hasTitanCoreSupply:hasTitanCoreSupply
});
