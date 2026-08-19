/* ================================================================
   Batch S · 统计等效离线战斗结算
   ----------------------------------------------------------------
   设计红线（来自 Batch S 指令）：
   - 禁止循环调用 combatTick / advanceCombatRound / 每秒模拟。
   - 复用 combat.js（已冻结）的**真实单轮战斗数学**：calcCombatDamage /
     applyLayeredCombatDamage / applyCapitalShieldMitigation / 各 state
     选择器 / computeVolleyFuel / nextCombatRandom。伤害用期望值
     （rng=()=>0.5 ⇒ 方差恒为 1.0，命中系数即命中概率），掉落用 Batch R
     确定性 RNG（nextCombatRandom）批量计算。
   - 资源：会话级 collector 跨段累计，flush 时每种 resourceId 一次性
     ResourceRegistry.add/spend（resource:changed ≤ 不同资源 ID 数）。
   - 事件：settle() 仅累积，flush() 发**一次**聚合事件
     offline:combatSettled（早于 offline:settlementCompleted）；
     不重发逐敌/逐波/damageDealt/deathspaceCleared 等在线事件，防双计。
   - 维修：战败 repairUntil = 虚拟战败时刻 + 180000；虚拟时间只在离散
     事件点跳（波清/战败/连刷续入/增强剂到期）。
   - 允许文件：本文件为 Batch S 新增文件（js/systems/offline-combat.js）。
   ================================================================ */
(function () {
  "use strict";

  // ---- 全局解析（生产环境 index.html 在 combat.js/selectors/actions 之后加载；
  //       verify 沙箱里均为 sandbox 全局）----
  function G(name) {
    if (typeof globalThis !== "undefined" && globalThis[name] !== undefined) return globalThis[name];
    if (typeof window !== "undefined" && window[name] !== undefined) return window[name];
    return undefined;
  }
  function emitOffline(type, payload, meta) {
    const fn = G("emitOfflineGameEvent");
    if (typeof fn === "function") fn(type, payload, meta);
  }
  // 离线战斗队列终结（fail-closed）：找不到 finalizeCombatQueueItem 时不得伪报 queue-target-reached，
  // 必须上报错误并保留当前队列/战斗进度/剩余离线时间，返回 false；成功返回 true。
  function finishOfflineCombatQueueItem(state, nowRef) {
    const ts = (nowRef && typeof nowRef.t === "number") ? nowRef.t : (typeof Date !== "undefined" ? Date.now() : 0);
    const fin = G("finalizeCombatQueueItem");
    if (typeof fin !== "function") {
      const msg = "离线战斗队列终结函数 finalizeCombatQueueItem 未导出，队列项无法推进（已保留当前队列与战斗进度，等待登录后处理）";
      const rg = G("RuntimeGuard");
      if (rg && typeof rg.report === "function") rg.report(new Error(msg), { source: "offline-combat", fatal: false, kind: "queue-finalize" });
      else if (typeof console !== "undefined") console.error("[offline-combat] " + msg);
      return false;
    }
    fin(state, ts);
    return true;
  }
  // 期望值 RNG：calcCombatDamageVariance 在 r=0.5 时 = 0.90+(0.5+0.5)*0.10 = 1.0
  function EXPECT() { return 0.5; }
  // 确定性掉落 RNG（Batch R 的 combat.randomState）
  function detRng(combat) {
    return function () { return G("nextCombatRandom")(combat); };
  }

  const ROUND_SECONDS = 1;        // 每轮等效 1 秒（与在线 tick 同尺度）
  const REPAIR_MS = 180000;       // 战败维修 180 秒
  const MAX_WAVE_ROUNDS = 6000;   // 单波防呆上限

  // 会话聚合器：key = offline runId（applyOfflineGains 每次离线结算唯一）
  const _sessions = {};

  function ensureSession(runId) {
    if (!_sessions[runId]) {
      _sessions[runId] = {
        runId: runId,
        startedAt: null, endedAt: null, simulatedSeconds: 0,
        mode: null, roundsEstimated: 0, kills: 0,
        killsByFaction: {}, killsByZone: {}, killsByKind: {},
        killsByFactionKind: {},
        wavesByZone: {}, zoneClearsByZone: {},
        deathspaceEntriesById: {}, deathspaceWavesById: {}, deathspaceClearsById: {},
        chainContinuations: 0, ticketsConsumed: 0, defeats: 0, repairsCompleted: 0,
        totalDamageDealt: 0, totalDamageTaken: 0, maxSingleHit: 0, noDamageClears: 0,
        maxWaveReached: 0,
        iskDelta: 0, lpDelta: 0,
        resourceNet: {},
        runs: 0, runsDetail: [],
        firstCrossings: {
          firstKill: null, firstWaveClear: null, firstZoneClear: null,
          firstDeathspaceEntry: null, firstDeathspaceClear: null,
          firstChainContinuation: null, firstDefeat: null, firstRepairComplete: null
        },
        stopReason: null,
        // 会话级虚拟弹药/燃料（跨段累计，flush 一次性 apply）
        ammo: {}, fuel: 0, ammoInit: {}, fuelInit: 0,
        ammoRead: false,
        // 掉落累计（按 category 累计 N 与精英/Boss 细分）
        dropAccum: {
          factionData: {},  // key: zoneId -> {elite, boss}
          zoneSpecial: {}, // key: zoneId -> [{resourceId, qty, elite, boss}]
          ticket: {},      // key: zoneId -> {elite, boss}
          leader: {},      // key: siteId -> [{wave, isFinal, core, proto}]
          stationCore: {}, // key: zoneId -> {elite, boss}（Tier3 四核心，唯一产出）
          cargo: {},       // key: zoneId -> { class -> {normal, elite, boss} }（货柜，按船级+kind 计数）
          tactical: { normal: 0, elite: 0, boss: 0 }
        },
        activeAtStart: false
      };
    }
    return _sessions[runId];
  }

  function recordFirst(s, key, now) {
    if (s.firstCrossings[key] === null && typeof now === "number" && Number.isFinite(now)) {
      s.firstCrossings[key] = now;
    }
  }
  function bump(obj, key, n) { obj[key] = (obj[key] || 0) + (n || 1); }

  // ---- 读取战斗输入（每波开始从真实状态重读，符合指令三）----
  function readInputs(state) {
    const combat = state.combat;
    const ship = G("getActiveShip")(state);
    const shipInstance = G("getActiveCombatShipInstance")(state);
    const zone = G("getCombatEncounterZone")(combat);
    const faction = zone ? zone.faction : null;
    const weapons = G("getInstalledCombatWeapons")(state).filter(m => m.equipment && m.equipment.combat && m.equipment.combat.kind === "weapon");
    const repairers = G("getInstalledCombatRepairers")(state); // 已按 combat.kind==="repair" 过滤（与在线 advanceCombatRound:825 同来源，勿再二次过滤）
    const maxHp = G("calcCombatMaxHp")(undefined, undefined, state);
    const playerDodge = G("calcPlayerDodge")(undefined, state);
    const booster = (typeof G("getBoosterEffectState") === "function") ? G("getBoosterEffectState")(state) : null;
    const boosterDmg = booster ? booster.weaponDamageMultiplier : null;
    const boosterRep = booster ? booster.repairMultiplier : null;
    return { ship, shipInstance, zone, faction, weapons, repairers, maxHp, playerDodge, boosterDmg, boosterRep };
  }

  // ---- 虚拟弹药/燃料（会话级，跨段累计）----
  function ensureVirtualAmmoFuel(state, s) {
    if (s.ammoRead) return;
    s.ammoRead = true;
    const RR = G("ResourceRegistry");
    const weapons = G("getInstalledCombatWeapons")(state);
    const ammoMap = {};
    for (const m of weapons) {
      const cb = m.equipment && m.equipment.combat;
      if (cb && cb.weaponType) ammoMap[cb.weaponType] = (ammoMap[cb.weaponType] || 0) + (cb.ammoCost || 1);
    }
    s.ammo = {}; s.ammoInit = {}; s.ammoTier = {};
    for (const type in ammoMap) {
      const cur = getSelectedCount(state, type);
      s.ammo[type] = cur; s.ammoInit[type] = cur;
    }
    s.fuel = RR.get(state, "consumable:fuel");
    s.fuelInit = s.fuel;
    // 同位素标记打捞臂：主动打捞同位素消耗（会话级虚拟余额，跨段累计，flush 一次性 apply；与燃料同机制）
    s.iso = RR.get(state, "planetary:同位素");
    s.isoInit = s.iso;
  }
  function canFireVirtual(inputs, zone, s, state) {
    if (!inputs.weapons || inputs.weapons.length === 0) return false;
    if (s.fuel <= 0) { s.blockedBy = "fuel"; return false; }
    // 与 combat.js 同算法：每种武器类型累计 ammoCost，全部满足才开火；优先高级预存档位
    const need = {};
    for (const m of inputs.weapons) {
      const cb = m.equipment.combat;
      need[cb.weaponType] = (need[cb.weaponType] || 0) + (cb.ammoCost || 1);
    }
    s.ammoTier = {};
    for (const type in need) {
      const stacks = getSelectedStacks(state, type);
      s.ammoTier[type] = stacks.length ? stacks[0].tier : "T1";
      if ((s.ammo[type] || 0) < need[type]) { s.blockedBy = "ammo"; return false; }
    }
    return true;
  }
  function consumeVolleyVirtual(inputs, zone, s) {
    const RR = G("ResourceRegistry");
    const need = {};
    for (const m of inputs.weapons) {
      const cb = m.equipment.combat;
      need[cb.weaponType] = (need[cb.weaponType] || 0) + (cb.ammoCost || 1);
    }
    for (const type in need) s.ammo[type] = (s.ammo[type] || 0) - need[type];
    const volleyFuel = G("computeVolleyFuel")(_stateRef, zone);
    s.fuel = Math.max(0, s.fuel - volleyFuel);
    return volleyFuel;
  }
  // computeVolleyFuel 需要 state；用模块级 _stateRef 捕获当前 state
  let _stateRef = null;

  function addResource(s, id, delta) {
    if (!delta) return;
    s.resourceNet[id] = (s.resourceNet[id] || 0) + delta;
  }

  // ---- XP（直接调 state-aware 函数，无事件；每波后重读技能）----
  function grantXp(state, skillId, amount) {
    const fn = G("addStationModifiedCombatXp");
    if (typeof fn === "function" && amount) fn(state, skillId, amount);
  }

  // ---- 单波等效模拟（期望伤害，不重放 RNG）----
  // enemies: 本波敌人数组（结构 {hp:{shield,armor,structure}, hit, dodge, baseDamage, kind, iskDrop, xpDrop, deathspaceLeader?, deathspaceWave?, id}）—— hit 必填，敌方反击 calcCombatDamage(attacker.hit,...) 依赖它
  // 返回 {outcome:'cleared'|'defeated', rounds, kills:[]}
  function simulateWave(state, enemies, zone, isDeathspace, site, s, nowRef) {
    const inputs = readInputs(state);
    const c = state.combat;
    c.maxHp = inputs.maxHp;
    // 钳制当前 HP 不超 maxHp
    if (c.hp.shield > c.maxHp.shield) c.hp.shield = c.maxHp.shield;
    if (c.hp.armor > c.maxHp.armor) c.hp.armor = c.maxHp.armor;
    if (c.hp.structure > c.maxHp.structure) c.hp.structure = c.maxHp.structure;

    const living = () => enemies.filter(e => e && e.hp && e.hp.structure > 0);
    let current = living()[0] || null;
    let rounds = 0;
    const kills = [];

    while (true) {
      if (rounds >= MAX_WAVE_ROUNDS) { return { outcome: "cleared", rounds, kills }; }
      const fire = canFireVirtual(inputs, zone, s, state);
      if (fire) {
        let roundDealt = 0;
        for (const m of inputs.weapons) {
          const cb = m.equipment.combat;
          const weapon = WEAPON_CONFIG[cb.weaponType];
          if (!weapon) continue;
          if (!current) break;
          const ammoProps = getAmmoTierProps(s.ammoTier[cb.weaponType] || "T1");
          const playerHit = G("calcPlayerHit")(cb.weaponType, m.equipment, state) * ammoProps.hitMult;
          const dmgMult = G("calcPlayerDmgMult")(cb.weaponType, state);
          let counterMult = 1.0;
          if (weapon.counterType === "shield" && current.hp.shield > 0) counterMult = 1.25;
          else if (weapon.counterType === "armor" && current.hp.shield <= 0 && current.hp.armor > 0) counterMult = 1.25;
          else if (weapon.counterType === "structure" && current.hp.shield <= 0 && current.hp.armor <= 0 && current.hp.structure > 0) counterMult = 1.25;
          const traitMult = G("getCapitalWeaponTraitMultiplier")(inputs.ship, cb.weaponType, c.hp, c.maxHp);
          const wbm = (inputs.boosterDmg && inputs.boosterDmg[cb.weaponType]) ? inputs.boosterDmg[cb.weaponType] : 1;
          const dmg = G("calcCombatDamage")(playerHit, current.dodge, cb.baseDamage * (m.multiplier || 1) * wbm, counterMult * dmgMult * traitMult * ammoProps.dmgMult, EXPECT);
          const dealt = G("applyLayeredCombatDamage")(current.hp, dmg);
          const total = dealt.shield + dealt.armor + dealt.structure;
          roundDealt += total;
          // AOE
          const targets = G("getCapitalAreaDamageTargets")(enemies, current, weapon.aoe);
          for (const t of targets) {
            const ad = Math.max(1, Math.round(dmg * t.multiplier));
            const ad2 = G("applyLayeredCombatDamage")(t.enemy.hp, ad);
            roundDealt += ad2.shield + ad2.armor + ad2.structure;
          }
          // 武器技能 XP
          const wskill = state.skills[weapon.skillKey];
          if (wskill) grantXp(state, weapon.skillKey, 2);
          grantXp(state, "targeting", 1);
        }
        s.totalDamageDealt += roundDealt;
        if (roundDealt > s.maxSingleHit) s.maxSingleHit = roundDealt;
        consumeVolleyVirtual(inputs, zone, s);
      }
      // 结算本波被击毁的敌人（玩家先手 + AOE）
      for (const e of enemies) {
        if (e && e.hp && e.hp.structure <= 0 && !e._rewarded) {
          e._rewarded = true;
          kills.push(e);
        }
      }
      if (living().length === 0) {
        return { outcome: "cleared", rounds: rounds + 1, kills };
      }
      // 敌人反击
      const playerDodge = G("calcPlayerDodge")(undefined, state);
      const ship = inputs.ship;
      let shieldHitsUsed = 0;
      let roundTaken = 0;
      for (const attacker of living()) {
        const raw = G("calcCombatDamage")(attacker.hit, playerDodge, attacker.baseDamage || 1, 1.0, EXPECT);
        const mit = G("applyCapitalShieldMitigation")(ship, raw, shieldHitsUsed, c.hp.shield);
        if (mit.shieldHitUsed) shieldHitsUsed++;
        const enemyDmg = Math.max(0, Math.round(mit.damage));
        const dmg = G("applyLayeredCombatDamage")(c.hp, enemyDmg);
        const actual = dmg.shield + dmg.armor + dmg.structure;
        roundTaken += actual;
        if (dmg.shield > 0) grantXp(state, "shieldOperation", 1);
        if (dmg.armor > 0) grantXp(state, "armorReinforcement", 1);
        if (dmg.structure > 0) grantXp(state, "hullEngineering", 1);
        if (actual > 0) grantXp(state, "piloting", 1);
        if (c.hp.structure <= 0) {
          s.totalDamageTaken += roundTaken;
          return { outcome: "defeated", rounds: rounds + 1, kills };
        }
      }
      s.totalDamageTaken += roundTaken;
      // 维修（仅读真实维修装备；满血层不扣维修燃料，与在线一致）
      const boosterRep = inputs.boosterRep;
      for (const m of inputs.repairers) {
        const cb = m.equipment.combat;
        const repFuel = Math.max(1, Math.round((cb.fuelCost || 1) * G("calcFuelMult")(zone, state)));
        if (s.fuel < repFuel) continue;
        if (c.hp[cb.target] < c.maxHp[cb.target]) {
          const repMult = (boosterRep && boosterRep[cb.target]) ? boosterRep[cb.target] : 1;
          const heal = Math.round(cb.amount * (m.multiplier || 1) * G("calcRepairMult")(cb.target, state, c.hp.structure / c.maxHp.structure) * repMult);
          c.hp[cb.target] = Math.min(c.maxHp[cb.target], c.hp[cb.target] + heal);
          s.fuel = Math.max(0, s.fuel - repFuel);
          grantXp(state, "defense", 1);
        }
      }
      // 推进回合与虚拟时间
      rounds++;
      nowRef.t += ROUND_SECONDS * 1000;
      advanceBoosterTime(state, ROUND_SECONDS * 1000, nowRef.t);
      // 重新读取（技能可能升级、HP 变化）
      const ni = readInputs(state);
      inputs.maxHp = ni.maxHp; inputs.playerDodge = ni.playerDodge;
      inputs.boosterDmg = ni.boosterDmg; inputs.boosterRep = ni.boosterRep;
      current = living()[0] || null;
    }
  }

  // ---- 增强剂离线时间推进（打破"战斗增强剂离线冻结"；不得双扣）----
  // 复用与在线 tickBoosterTimers 完全相同的纯计算函数 applyBoosterTimeConsumption，
  // 仅推进战斗相关两槽（combatWeapon / combatRepair），与在线战斗分支严格一致：
  // 正确消费库存并在耗尽时自动续装；不再 delete 槽位、不再漏扣库存、不再波及非战斗槽。
  function advanceBoosterTime(state, ms, now) {
    if (!state || !state.boosters || !state.boosters.active) return;
    if (!(ms > 0)) return;
    const t = (typeof now === "number" && Number.isFinite(now)) ? now : Date.now();
    const combatSlots = ["combatWeapon", "combatRepair"];
    for (const slot of combatSlots) {
      const entry = state.boosters.active[slot];
      if (entry && entry.itemId) {
        applyBoosterTimeConsumption(state, slot, ms, t, { offline:true });
      }
    }
  }

  // ---- 记录击杀（掉落累计 + 计数）----
  function recordKill(state, s, enemy, zone, isDeathspace, site) {
    s.kills++;
    bump(s.killsByKind, enemy.kind, 1);
    if (zone) {
      bump(s.killsByZone, zone.id, 1);
      bump(s.killsByFaction, zone.faction, 1);
      const fk = s.killsByFactionKind[zone.faction] = s.killsByFactionKind[zone.faction] || { normal: 0, elite: 0, boss: 0 };
      bump(fk, enemy.kind, 1);
    }
    // ISK（确定性：iskDrop*iskMulti）
    const isk = Math.round((enemy.iskDrop || 0) * (zone ? zone.iskMulti : 1));
    s.iskDelta += isk;
    // LP（若有）
    if (typeof enemy.lpDrop === "number") s.lpDelta += Math.round(enemy.lpDrop * (zone ? (zone.lpMulti || 1) : 1));
    // 掉落累计（按 category 记录 N 与精英/Boss 细分）
    const da = s.dropAccum;
    if (isDeathspace && site) {
      if (enemy.deathspaceLeader) {
        const cfgs = G("getDeathspaceLeaderLootConfigs")(site);
        const wc = cfgs[Math.max(0, (enemy.deathspaceWave || 1) - 1)];
        if (wc) {
          (da.leader[site.id] = da.leader[site.id] || []).push({ wave: wc.wave, isFinal: wc.isFinal, core: true, proto: wc.isFinal });
        }
      }
      // 死亡空间无 faction data / ticket / zone special（与 roll* 一致）
    } else if (zone) {
      if (enemy.kind === "elite" || enemy.kind === "boss") {
        (da.factionData[zone.id] = da.factionData[zone.id] || { elite: 0, boss: 0 });
        da.factionData[zone.id][enemy.kind]++;
        const tcfg = G("getDeathspaceTicketDropConfig")(zone);
        if (tcfg) {
          (da.ticket[zone.id] = da.ticket[zone.id] || { elite: 0, boss: 0 });
          da.ticket[zone.id][enemy.kind]++;
        }
      }
      const sc = G("getCombatZoneSpecialDropConfigs")(zone);
      for (const cfg of sc) {
        (da.zoneSpecial[zone.id] = da.zoneSpecial[zone.id] || []).push({ resourceId: cfg.resourceId, qty: cfg.qty, kind: enemy.kind });
      }
      const coreCfgs = G("getStationCoreDropConfigs")(zone);
      if (coreCfgs.length && (enemy.kind === "elite" || enemy.kind === "boss")) {
        (da.stationCore[zone.id] = da.stationCore[zone.id] || { elite: 0, boss: 0 });
        da.stationCore[zone.id][enemy.kind]++;
      }
      // 货柜（按敌方船级+kind 记录计数，flush 时确定性重滚；死亡空间不计入）
      const cargoCls = (typeof getEnemyCargoClass === "function") ? getEnemyCargoClass(zone.faction, enemy.type) : "frigate";
      const cargoZoneMap = (da.cargo[zone.id] = da.cargo[zone.id] || {});
      const cargoClsMap = (cargoZoneMap[cargoCls] = cargoZoneMap[cargoCls] || { normal: 0, elite: 0, boss: 0 });
      cargoClsMap[enemy.kind]++;
    }
    // 同位素标记打捞臂：主动打捞（开关开启 + 已装备打捞臂 + 有同位素才记录；死亡空间不触发，与货柜一致）
    if (!isDeathspace && state.combat.salvageArmActive && (typeof getSalvageEfficiency === "function" ? getSalvageEfficiency(state) : 0) > 0) {
      const isoCost = (typeof getSalvageComponentQty === "function") ? getSalvageComponentQty(enemy.kind) : 1; // 1/2/3
      if ((s.iso || 0) >= isoCost) {
        s.iso -= isoCost;
        const tier = (typeof getSalvageComponentTier === "function") ? getSalvageComponentTier(enemy.level) : "";
        const sk = (s.salvageByTier = s.salvageByTier || {});
        const tk = (sk[tier] = sk[tier] || { normal: 0, elite: 0, boss: 0 });
        tk[enemy.kind] = (tk[enemy.kind] || 0) + 1;
      }
    }
    // 战术材料（按 kind 累计 N；期望数量在 flush 计算）
    if (enemy.kind === "elite") da.tactical.elite++;
    else if (enemy.kind === "boss") da.tactical.boss++;
    else da.tactical.normal++;
  }

  // ---- 普通星带结算 ----
  function simulateBelt(state, segSec, s, nowRef) {
    const c = state.combat;
    s.mode = "belt";
    if (!c.active) { s.stopReason = "inactive"; return 0; }
    let budgetMs = segSec * 1000;

    while (budgetMs > 0 && c.active) {
      // zone/waveNum 在循环内重算以支持队列下一项续战（combat→combat 打到正确星带）
      const zone = G("getCombatEncounterZone")(c);
      if (!zone) { s.stopReason = "no-zone"; return budgetMs / 1000; }
      let waveNum = c.wave && c.wave >= 1 ? c.wave : 1;
      const maxWave = zone.maxWave || 99;
      // 每波重新读状态 + 生成波次（确定性 RNG）
      const rng = detRng(c);
      const built = G("buildCombatWave")(zone, waveNum, rng, c);
      const enemies = built.enemies.map(e => ({
        id: e.id, hit: e.hit, hp: { shield: e.hp.shield, armor: e.hp.armor, structure: e.hp.structure },
        dodge: e.dodge, baseDamage: e.baseDamage, kind: e.kind, iskDrop: e.iskDrop, xpDrop: e.xpDrop,
        level: e.level,
        deathspaceLeader: false, deathspaceWave: 0, _rewarded: false
      }));
      const res = simulateWave(state, enemies, zone, false, null, s, nowRef);
      // 扣除本波耗时
      const waveMs = res.rounds * ROUND_SECONDS * 1000;
      budgetMs -= waveMs;
      s.simulatedSeconds += res.rounds * ROUND_SECONDS;
      s.roundsEstimated += res.rounds;
      for (const k of res.kills) recordKill(state, s, k, zone, false, null);
      if (res.kills.length > 0) recordFirst(s, "firstKill", nowRef.t);

      if (res.outcome === "defeated") {
        handleDefeat(state, s, nowRef, zone, "belt");
        s.stopReason = (c.active ? "belt-continue-after-repair" : "repairing");
        if (!c.active) return; // 剩余离线不足，保存维修中（维修延续到登录后，不计入本段离线战斗时间）
        // 维修完成 → 扣除 180s 真实维修时间（与在线每战败耗 180s 一致），再回该星带第 1 波继续
        budgetMs -= REPAIR_MS;
        waveNum = 1;
        continue;
      }
      // 清波
      bump(s.wavesByZone, zone.id, 1);
      if (waveNum > s.maxWaveReached) s.maxWaveReached = waveNum;
      if (s.currentRunToken !== null) {
        const rd = s.runsDetail.find(r => r.token === s.currentRunToken);
        if (rd) rd.wavesCleared++;
      }
      recordFirst(s, "firstWaveClear", nowRef.t);
      if (waveNum < maxWave) {
        waveNum++;
      } else {
        bump(s.zoneClearsByZone, zone.id, 1);
        s.lpDelta += (zone.clearLp || 0); // 对齐在线 resolveCombatWaveVictory 的清区 LP（belt 敌无 lpDrop，离线 LP 仅此来源）
        recordFirst(s, "firstZoneClear", nowRef.t);
        waveNum = 1; // 从第 1 波继续（不自动换区）
      }
      // 队列感知：普通星带每清一波累计 queueWavesDone（与在线 resolveCombatWaveVictory 一致）；
      // 达标则停止离线模拟并终结队列项（受时间/资源约束，离线最多清到目标即停）。
      if (c.queueItemId && c.queueWavesTarget > 0) {
        c.queueWavesDone = (c.queueWavesDone || 0) + 1;
        if (state.resumeAfterRepair && state.resumeAfterRepair.type === "combat" && state.resumeAfterRepair.queueItemId === c.queueItemId) {
          state.resumeAfterRepair.queueWavesDone = c.queueWavesDone;
        }
        if (c.queueWavesDone >= c.queueWavesTarget) {
          const ok = finishOfflineCombatQueueItem(state, nowRef);
          if (!ok) { s.stopReason = s.stopReason || "queue-finalize-error"; return budgetMs / 1000; }
          s.stopReason = "queue-target-reached";
          // 下一项若为战斗（c.active 仍为 true）则本循环续清；否则 c.active 已 false，
          // 循环退出后由离线时间轴交接给生产结算，继续消耗剩余离线时间。
          continue;
        }
      }
      c.wave = waveNum;
      // 资源不足 → 停止进攻（敌人仍会造成伤害已在 simulateWave 内处理；此处判定无法继续开火）
      if (budgetMs <= 0) { s.stopReason = "time"; return; }
      const inputs = readInputs(state);
      ensureVirtualAmmoFuel(state, s);
      if (!canFireVirtual(inputs, zone, s, state)) { s.stopReason = (s.blockedBy === "ammo") ? "ammo" : "resources"; return; }
    }
    if (!c.active) s.stopReason = s.stopReason || "resolved";
    else s.stopReason = s.stopReason || "time";
    return budgetMs / 1000;
  }

  // ---- 死亡空间连刷结算 ----
  function simulateDeathspace(state, segSec, s, nowRef) {
    const c = state.combat;
    s.mode = "deathspace";
    let budgetMs = segSec * 1000;
    const site = G("getDeathspaceById")(c.deathspaceId);
    if (!site) { s.stopReason = "no-site"; c.deathspaceChainPending = false; c.deathspaceChainRemaining = 0; return; }
    const zone = G("getCombatEncounterZone")(c) || COMBAT_ZONES.find(z => z.id === site.sourceZoneId);

    while (budgetMs > 0 && (c.active || c.deathspaceChainPending)) {
      if (!c.active && c.deathspaceChainPending) {
        // 连刷续入：消耗 1 秒虚拟时间
        nowRef.t += ROUND_SECONDS * 1000; advanceBoosterTime(state, ROUND_SECONDS * 1000, nowRef.t); budgetMs -= ROUND_SECONDS * 1000;
        s.simulatedSeconds += ROUND_SECONDS;
        if (c.deathspaceChainRemaining <= 0) { c.deathspaceChainPending = false; break; }
        // 校验（等级/武器/维修/密钥）
        if (G("getCombatLevelFromState")(state) < site.requiredCL) { c.deathspaceChainPending = false; c.deathspaceChainRemaining = 0; s.stopReason = "level-locked"; break; }
        if (G("getInstalledCombatWeapons")(state).length === 0) { c.deathspaceChainPending = false; c.deathspaceChainRemaining = 0; s.stopReason = "no-weapons"; break; }
        const RR = G("ResourceRegistry");
        if (RR.get(state, "special:" + site.ticketMaterial) < 1) {
          // 密钥不足：不扣、不进入、remaining/pending 清零、连刷结束
          c.deathspaceChainRemaining = 0; c.deathspaceChainPending = false;
          s.stopReason = "no-keys"; break;
        }
        // 成功续入：同 runToken（continuation），扣 1 密钥，remaining--
        const rng = detRng(c);
        const built = G("buildDeathspaceWave")(site, 1, rng, c);
        const enemies = built.enemies.map(e => ({
          id: e.id, hit: e.hit, hp: { shield: e.hp.shield, armor: e.hp.armor, structure: e.hp.structure },
          dodge: e.dodge, baseDamage: e.baseDamage, kind: e.kind, iskDrop: e.iskDrop, xpDrop: e.xpDrop,
          deathspaceLeader: Boolean(e.deathspaceLeader), deathspaceWave: e.deathspaceWave || 1, _rewarded: false
        }));
        RR.spend(state, "special:" + site.ticketMaterial, 1);
        s.ticketsConsumed++;
        c.deathspaceChainRemaining--;
        c.deathspaceChainPending = false;
        c.active = true; c.mode = "deathspace"; c.enemies = enemies; c.currentEnemy = enemies[0] || null;
        c.wave = 1; c.totalKills = 0; c.runEliteKills = 0;
        c.lastStatus = "通行密钥已消耗";
        s.chainContinuations++;
        recordFirst(s, "firstChainContinuation", nowRef.t);
        bump(s.deathspaceEntriesById, site.id, 1);
        bump(s.deathspaceWavesById, site.id, 1);
        if (s.currentRunToken !== null) {
          const rd = s.runsDetail.find(r => r.token === s.currentRunToken);
          if (rd) rd.wavesCleared++;
        }
      }
      // 模拟当前死亡空间波（可能多 wave 的 site：逐 wave 推进）
      let waveIdx = c.wave && c.wave >= 1 ? c.wave : 1;
      const siteWaves = Array.isArray(site.waves) ? site.waves.length : 1;
      while (waveIdx <= siteWaves && budgetMs > 0 && c.active) {
        const rng = detRng(c);
        const built = G("buildDeathspaceWave")(site, waveIdx, rng, c);
        const enemies = built.enemies.map(e => ({
          id: e.id, hit: e.hit, hp: { shield: e.hp.shield, armor: e.hp.armor, structure: e.hp.structure },
          dodge: e.dodge, baseDamage: e.baseDamage, kind: e.kind, iskDrop: e.iskDrop, xpDrop: e.xpDrop,
          deathspaceLeader: Boolean(e.deathspaceLeader), deathspaceWave: waveIdx, _rewarded: false
        }));
        const res = simulateWave(state, enemies, zone, true, site, s, nowRef);
        budgetMs -= res.rounds * ROUND_SECONDS * 1000;
        s.simulatedSeconds += res.rounds * ROUND_SECONDS;
        s.roundsEstimated += res.rounds;
        for (const k of res.kills) recordKill(state, s, k, zone, true, site);
        if (res.kills.length > 0) {
          bump(s.deathspaceWavesById, site.id, 1);
          recordFirst(s, "firstKill", nowRef.t);
        }
        if (res.outcome === "defeated") {
          // 战败：当前密钥不退；remaining/pending 清零；进入 180 秒维修；修好只回来源普通星带
          c.deathspaceChainRemaining = 0; c.deathspaceChainPending = false;
          handleDefeat(state, s, nowRef, zone, "deathspace");
          s.stopReason = (c.active ? "ds-continue-after-repair" : "repairing");
          if (!c.active) return;
          budgetMs -= REPAIR_MS; // 维修完成：扣除 180s 真实维修时间（与在线一致）
          return; // 回来源普通星带由调用方决定；此处结束死亡空间模拟
        }
        if (waveIdx < siteWaves) { waveIdx++; c.wave = waveIdx; }
        else break;
      }
      if (!c.active) break;
      // 整条死亡空间通关
      bump(s.deathspaceClearsById, site.id, 1);
      recordFirst(s, "firstDeathspaceClear", nowRef.t);
      // 队列感知：死亡空间每全通一次计 1 入场（与在线 resolveDeathspaceWaveVictory 一致）；
      // 达标则停止离线模拟并终结队列项；未达标则手动重入下一入场（消耗密钥），由 queueEntries 接管连刷计数。
      if (c.queueItemId && c.queueEntriesTarget > 0) {
        c.queueEntriesDone = (c.queueEntriesDone || 0) + 1;
        if (state.resumeAfterRepair && state.resumeAfterRepair.type === "combat" && state.resumeAfterRepair.queueItemId === c.queueItemId) {
          state.resumeAfterRepair.queueEntriesDone = c.queueEntriesDone;
        }
        if (c.queueEntriesDone >= c.queueEntriesTarget) {
          const ok = finishOfflineCombatQueueItem(state, nowRef);
          if (!ok) { s.stopReason = s.stopReason || "queue-finalize-error"; return budgetMs / 1000; }
          s.stopReason = "queue-target-reached";
          return budgetMs / 1000;
        }
        // 未达标：手动重入下一入场（消耗密钥），绕过既有链 break 以便继续清场
        const RRd = G("ResourceRegistry");
        if (!RRd || RRd.get(state, "special:" + site.ticketMaterial) < 1) {
          const ok = finishOfflineCombatQueueItem(state, nowRef);
          if (!ok) { s.stopReason = "queue-finalize-error"; return budgetMs / 1000; }
          s.stopReason = "no-keys";
          return budgetMs / 1000;
        }
        const nw = G("buildDeathspaceWave")(site, 1, detRng(c), c);
        const nen = nw.enemies.map(e => ({ id:e.id, hit:e.hit, hp:{shield:e.hp.shield,armor:e.hp.armor,structure:e.hp.structure}, dodge:e.dodge, baseDamage:e.baseDamage, kind:e.kind, iskDrop:e.iskDrop, xpDrop:e.xpDrop, deathspaceLeader:Boolean(e.deathspaceLeader), deathspaceWave:1, _rewarded:false }));
        RRd.spend(state, "special:" + site.ticketMaterial, 1);
        s.ticketsConsumed++;
        c.active = true; c.mode = "deathspace"; c.enemies = nen; c.currentEnemy = nen[0] || null;
        c.wave = 1; c.totalKills = 0; c.runEliteKills = 0;
        c.deathspaceChainRemaining = 1; // 仅用于绕过下方 506 的 break；连刷计数由 queueEntries 接管
        c.deathspaceChainPending = false;
        c.lastStatus = "通行密钥已消耗";
        bump(s.deathspaceEntriesById, site.id, 1);
        bump(s.deathspaceWavesById, site.id, 1);
        if (typeof G("setCombatQueueResume") === "function") G("setCombatQueueResume")(state);
        continue; // 外层 while：以新入场重新清场
      }
      if (c.deathspaceChainRemaining > 0) {
        // 写 pending，下一秒虚拟时间续入（循环顶部处理）
        c.deathspaceChainPending = true;
        // 离线时间恰好截止于通关时：保留 pending=true，不提前扣下一枚密钥
        if (budgetMs <= 0) { s.stopReason = "time-pending"; break; }
      } else {
        c.deathspaceChainPending = false;
        s.stopReason = "chain-complete";
        break; // 连刷正常完成，不自动转普通星带
      }
    }
    return budgetMs / 1000;
  }

  function handleDefeat(state, s, nowRef, zone, fromMode) {
    const c = state.combat;
    // 战败：repairUntil = 虚拟战败时刻 + 180000
    const defeatNow = nowRef.t;
    // 剩余离线时间 = 整段离线虚拟结束点 - 战败时刻（offlineEnd 由 offline.js 注入；
    // 未注入时退化为 0，安全保留维修中状态，不误判完成）
    const remainMs = (typeof s.offlineEnd === "number") ? Math.max(0, s.offlineEnd - defeatNow) : 0;
    s.defeats++;
    recordFirst(s, "firstDefeat", defeatNow);
    const inst = c.activeShip || (G("getActiveCombatShipInstance")(state) && G("getActiveCombatShipInstance")(state).instanceId) || null;
    c.repairs = c.repairs || {};
    c.repairs[inst] = defeatNow + REPAIR_MS;
    c.active = false;
    c.mode = (fromMode === "deathspace") ? "deathspace" : "belt";
    // 维修是否能在剩余离线时间内完成
    if (remainMs >= REPAIR_MS) {
      // 完成维修
      delete c.repairs[inst];
      c.hp = { shield: c.maxHp.shield, armor: c.maxHp.armor, structure: c.maxHp.structure };
      s.repairsCompleted++;
      recordFirst(s, "firstRepairComplete", defeatNow + REPAIR_MS);
      // 回来源（belt: 该星带第1波；deathspace: 来源普通星带第1波）——由调用方设置 c.zone/c.wave
      if (fromMode === "deathspace") {
        const site = G("getDeathspaceById")(c.deathspaceId);
        const srcZone = site ? site.sourceZoneId : (zone ? zone.id : null);
        if (srcZone) { c.zone = srcZone; c.mode = "belt"; c.wave = 1; c.active = true; }
        c.deathspaceChainPending = false; c.deathspaceChainRemaining = 0;
      } else {
        c.wave = 1; c.active = true;
      }
    }
    // 否则保持维修中（active=false），登录后继续剩余维修
  }

  // =================== 公共入口 ===================
  const OfflineCombatSystem = {
    // 每段由 settleOfflineTimeline 调用；仅累积，不发射事件
    settle: function (state, segSec, context) {
      context = context || {};
      const runId = context.runId || ("offline_" + (context.now || 0).toString(36));
      const s = ensureSession(runId);
      _stateRef = state;
      if (s.startedAt === null) {
        s.startedAt = (typeof context.now === "number") ? context.now : (G("Date") ? G("Date").now() : 0);
        s.endedAtRef = { t: s.startedAt };
        if (typeof context.offlineEnd === "number") s.offlineEnd = context.offlineEnd;
        ensureVirtualAmmoFuel(state, s);
        const c = state.combat;
        s.activeAtStart = Boolean(c.active) || Boolean(c.deathspaceChainPending);
        s.mode = c.mode || (c.deathspaceChainPending ? "deathspace" : "belt");
        if (c.active || c.deathspaceChainPending) {
          // 把同一权威教程 sortie token（activeCombatRunToken）与来源星带 zoneId / 战斗模式 带入离线快照：
          // 在线/离线共用同一 token；仅普通星带（mode==="belt"）且三个一级普通星带之一可完成 C6，
          // 死亡空间（mode==="deathspace"）或高级星带 sortieToken/zone/mode 任一不符 → 不得误完成。
          // token(combat.runToken) 保留供离线内部续波链接使用，不改动。
          const tutToken = (state.tutorial && typeof state.tutorial.activeCombatRunToken === "string") ? state.tutorial.activeCombatRunToken : null;
          s.runs++; s.currentRunToken = c.runToken;
          s.runsDetail.push({ token: c.runToken, sortieToken: tutToken, zoneId: c.zone, mode: c.mode, wavesCleared: 0, defeated: false, zoneClears: 0 });
        }
      }
      if (!s.activeAtStart) { s.stopReason = "inactive"; return 0; } // 离线前无有效战斗，跳过；段内时间已由生产结算接管
      const nowRef = s.endedAtRef;
      const segStart = nowRef.t;
      // 按当前模式模拟；left = 段内未被战斗消耗的剩余秒数，交回时间轴给生产结算
      let left = 0;
      if (state.combat.mode === "deathspace" || state.combat.deathspaceChainPending) {
        left = simulateDeathspace(state, segSec, s, nowRef);
      } else if (state.combat.active) {
        left = simulateBelt(state, segSec, s, nowRef);
      }
      s.endedAt = nowRef.t;
      s.simulatedSeconds = Math.round((nowRef.t - s.startedAt) / 1000);
      if (s.stopReason === null) s.stopReason = "time";
      return left;
    },

    // 离线结算结束（applyOfflineGains 内、offline:settlementCompleted 之前）调用一次
    flush: function (state, context) {
      context = context || {};
      const runId = context.runId || ("offline_" + (context.now || 0).toString(36));
      const s = _sessions[runId];
      if (!s) return null;
      _stateRef = state;
      // 若离线前无有效战斗，跳过（不发空事件）
      if (!s.activeAtStart) { delete _sessions[runId]; return null; }

      // ---- 资源一次性 apply（每种 resourceId 至多一次）----
      const RR = G("ResourceRegistry");
      // 弹药/燃料：初始 - 当前虚拟 = 净消耗
      for (const type in s.ammoInit) {
        const used = s.ammoInit[type] - (s.ammo[type] || 0);
        if (used > 0) { applyAmmoDelta(state, type, used); }
      }
      const fuelUsed = s.fuelInit - s.fuel;
      if (fuelUsed > 0) { RR.spend(state, "consumable:fuel", fuelUsed); addResource(s, "consumable:fuel", -fuelUsed); }

      // ---- 掉落批量（确定性 RNG）----
      applyBatchedDrops(state, s);

      // ISK / LP 入账
      if (s.iskDelta) { RR.add(state, "currency:isk", s.iskDelta); addResource(s, "currency:isk", s.iskDelta); }
      if (s.lpDelta) { RR.add(state, "currency:lp", s.lpDelta); addResource(s, "currency:lp", s.lpDelta); }

      // ---- 聚合事件 payload ----
      const payload = {
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        simulatedSeconds: s.simulatedSeconds,
        mode: s.mode,
        roundsEstimated: s.roundsEstimated,
        kills: s.kills,
        killsByFaction: s.killsByFaction,
        killsByZone: s.killsByZone,
        killsByKind: s.killsByKind,
        killsByFactionKind: s.killsByFactionKind,
        wavesByZone: s.wavesByZone,
        zoneClearsByZone: s.zoneClearsByZone,
        deathspaceEntriesById: s.deathspaceEntriesById,
        deathspaceWavesById: s.deathspaceWavesById,
        deathspaceClearsById: s.deathspaceClearsById,
        chainContinuations: s.chainContinuations,
        ticketsConsumed: s.ticketsConsumed,
        defeats: s.defeats,
        repairsCompleted: s.repairsCompleted,
        totalDamageDealt: s.totalDamageDealt,
        totalDamageTaken: s.totalDamageTaken,
        maxSingleHit: s.maxSingleHit,
        noDamageClears: s.noDamageClears,
        maxWaveReached: s.maxWaveReached,
        iskDelta: s.iskDelta,
        lpDelta: s.lpDelta,
        resourceNet: s.resourceNet,
        runs: s.runs,
        runsDetail: s.runsDetail,
        firstCrossings: s.firstCrossings,
        stopReason: s.stopReason
      };
      emitOffline("offline:combatSettled", payload, {
        timestamp: s.endedAt,
        source: "offline-combat",
        runId: runId,
        offline: true
      });
      // gains.combat 累加击杀数（供离线摘要）
      if (context.gains) context.gains.combat = (context.gains.combat || 0) + s.kills;
      delete _sessions[runId];
      return payload;
    }
  };

  // ---- 掉落批量（确定性 RNG；不逐敌 Math.random；不超过实际击杀上限）----
  function batchCount(n, p, rng) {
    if (!(n > 0) || !(p > 0)) return 0;
    const expected = n * p;
    const base = Math.floor(expected);
    const frac = expected - base;
    return base + (rng() < frac ? 1 : 0);
  }
  function applyBatchedDrops(state, s) {
    const RR = G("ResourceRegistry");
    const c = state.combat;
    const rng = detRng(c);
    const da = s.dropAccum;
    // 1) 势力加密数据
    for (const zoneId in da.factionData) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const cfg = G("getEncryptedDataDropConfig")(zone);
      if (!cfg) continue;
      const fd = da.factionData[zoneId];
      if (fd.elite) { const n = batchCount(fd.elite, cfg.eliteChance, rng); if (n > 0) { RR.add(state, "special:" + cfg.material, cfg.qty * n); addResource(s, "special:" + cfg.material, cfg.qty * n); } }
      if (fd.boss) { const n = batchCount(fd.boss, cfg.bossChance, rng); if (n > 0) { RR.add(state, "special:" + cfg.material, cfg.qty * n); addResource(s, "special:" + cfg.material, cfg.qty * n); } }
    }
    // 1.5) 装备专用料（Tier2，zone-bound；死亡空间不计入，复用 elite/boss 计数）
    for (const zoneId in da.factionData) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const gearConfigs = G("getGearDropConfigs")(zone);
      if (!gearConfigs.length) continue;
      const fd = da.factionData[zoneId];
      for (const cfg of gearConfigs) {
        if (fd.elite) { const n = batchCount(fd.elite, cfg.eliteChance, rng); if (n > 0) { RR.add(state, cfg.resourceId, cfg.qty * n); addResource(s, cfg.resourceId, cfg.qty * n); } }
        if (fd.boss) { const n = batchCount(fd.boss, cfg.bossChance, rng); if (n > 0) { RR.add(state, cfg.resourceId, cfg.qty * n); addResource(s, cfg.resourceId, cfg.qty * n); } }
      }
    }
    // 1.6) 空间站四核心（Tier3，唯一产出；死亡空间不计入，复用 elite/boss 计数）
    const obtainedCores = state.stationCoresObtained = state.stationCoresObtained || {};
    for (const zoneId in da.stationCore) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const coreConfigs = G("getStationCoreDropConfigs")(zone);
      if (!coreConfigs.length) continue;
      const cc = da.stationCore[zoneId];
      for (const cfg of coreConfigs) {
        if (obtainedCores[cfg.coreId]) continue;
        const n = (cc.elite ? batchCount(cc.elite, cfg.eliteChance, rng) : 0) + (cc.boss ? batchCount(cc.boss, cfg.bossChance, rng) : 0);
        if (n > 0) { RR.add(state, cfg.resourceId, cfg.qty); addResource(s, cfg.resourceId, cfg.qty); obtainedCores[cfg.coreId] = true; break; }
      }
    }
    // 1.7) 货柜（按船级+kind 计数，flush 时确定性重滚）
    for (const zoneId in da.cargo) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const cz = da.cargo[zoneId];
      for (const cls in cz) {
        const spec = (typeof CARGO_CLASS_SIZES !== "undefined" && CARGO_CLASS_SIZES[cls]) || null;
        if (!spec) continue;
        const kindCounts = cz[cls];
        for (const kind of ["normal", "elite", "boss"]) {
          const n = kindCounts[kind] || 0;
          if (!n) continue;
          // 同位素标记打捞臂：被动提升货柜掉率（与在线 rollCargoDrop 同公式 min(base*(1+b),0.5)）
          const salvageBonus = (typeof getSalvageEfficiency === "function") ? getSalvageEfficiency(state) : 0;
          const baseChance = (typeof CARGO_DROP_CHANCE !== "undefined" && CARGO_DROP_CHANCE[kind]) || 0;
          const chance = Math.min(baseChance * (1 + salvageBonus), 0.5);
          const drops = batchCount(n, chance, rng);
          for (let d = 0; d < drops; d++) {
            const size = cargoWeightedPick(spec.sizes.map((sz, i) => ({ id: sz, weight: spec.weights[i] })), rng).id;
            const itemId = cargoItemId(size);
            RR.add(state, itemId, 1);
            addResource(s, itemId, 1);
          }
        }
      }
    }
    // 1.8) 同位素标记打捞臂：主动打捞舰船组件（按敌舰等级档位，确定性重滚；同位素消耗已在 recordKill 按会话虚拟余额门控）
    const salvageBonus2 = (typeof getSalvageEfficiency === "function") ? getSalvageEfficiency(state) : 0;
    const sb = s.salvageByTier;
    if (sb) {
      for (const tier in sb) {
        const ids = (typeof SALVAGE_COMPONENT_IDS !== "undefined" && SALVAGE_COMPONENT_IDS[tier]) || null;
        if (!ids) continue;
        const tk = sb[tier];
        for (const kind of ["normal", "elite", "boss"]) {
          const n = tk[kind] || 0;
          if (!n) continue;
          const baseChance = (typeof CARGO_DROP_CHANCE !== "undefined" && CARGO_DROP_CHANCE[kind]) || 0;
          const chance = Math.min(baseChance * (1 + salvageBonus2), 0.5);
          const drops = batchCount(n, chance, rng);
          const qty = (typeof getSalvageComponentQty === "function") ? getSalvageComponentQty(kind) : 1;
          for (let d = 0; d < drops; d++) {
            const compId = ids[Math.floor(rng() * ids.length)];
            RR.add(state, "component:" + compId, qty);
            addResource(s, "component:" + compId, qty);
          }
        }
      }
    }
    // 主动打捞同位素消耗（每击毁扣，开状态才记；flush 一次性 apply，与燃料同机制）
    const isoUsed = (s.isoInit || 0) - (s.iso || 0);
    if (isoUsed > 0) {
      RR.spend(state, "planetary:同位素", isoUsed);
      addResource(s, "planetary:同位素", -isoUsed);
    }
    // 打捞臂燃料消耗（装备即收，按总击毁数；开主动×3）；与同位素同机制 flush。
    const salvageFuelPK = (typeof getSalvageFuelPerKill === "function") ? getSalvageFuelPerKill(state) : 0;
    if (salvageFuelPK > 0 && (s.kills || 0) > 0) {
      const fuelAmt = salvageFuelPK * s.kills * (state.combat && state.combat.salvageArmActive ? 3 : 1);
      if (fuelAmt > 0) { RR.spend(state, "consumable:fuel", fuelAmt); addResource(s, "consumable:fuel", -fuelAmt); }
    }
    // 2) 区域特殊掉落
    for (const zoneId in da.zoneSpecial) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const configs = G("getCombatZoneSpecialDropConfigs")(zone);
      const entries = da.zoneSpecial[zoneId];
      // 按 config 聚合每种 material 的精英/Boss 击杀数
      const byRes = {};
      for (const e of entries) {
        const cfg = configs.find(cc => cc.resourceId === e.resourceId);
        if (!cfg) continue;
        const chance = e.kind === "boss" ? cfg.bossChance : (e.kind === "elite" ? cfg.eliteChance : 0);
        if (!chance) continue;
        byRes[e.resourceId] = byRes[e.resourceId] || { qty: cfg.qty, n: 0, chance };
        byRes[e.resourceId].n++;
      }
      for (const resId in byRes) {
        const b = byRes[resId];
        const n = batchCount(b.n, b.chance, rng);
        if (n > 0) { RR.add(state, resId, b.qty * n); addResource(s, resId, b.qty * n); }
      }
    }
    // 3) 通行密钥
    for (const zoneId in da.ticket) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const tcfg = G("getDeathspaceTicketDropConfig")(zone);
      if (!tcfg) continue;
      const tk = da.ticket[zoneId];
      if (tk.elite) { const n = batchCount(tk.elite, tcfg.eliteChance, rng); if (n > 0) { RR.add(state, "special:" + tcfg.material, n); addResource(s, "special:" + tcfg.material, n); } }
      if (tk.boss) { const n = batchCount(tk.boss, tcfg.bossChance, rng); if (n > 0) { RR.add(state, "special:" + tcfg.material, n); addResource(s, "special:" + tcfg.material, n); } }
    }
    // 4) 死亡空间首领战利品
    const dsCovered = {};
    for (const siteId in da.leader) {
      const site = G("getDeathspaceById")(siteId);
      if (!site) continue;
      const cfgs = G("getDeathspaceLeaderLootConfigs")(site);
      for (const entry of da.leader[siteId]) {
        const wc = cfgs[Math.max(0, entry.wave - 1)];
        if (!wc) continue;
        if (entry.core) { const n = batchCount(1, wc.coreChance, rng); if (n > 0) { RR.add(state, "special:" + site.coreMaterial, n); addResource(s, "special:" + site.coreMaterial, n); } }
        if (entry.proto && wc.isFinal) { const n = batchCount(1, wc.protocolChance, rng); if (n > 0) { RR.add(state, "special:" + site.protocolMaterial, n); addResource(s, "special:" + site.protocolMaterial, n); } }
      }
      dsCovered[siteId] = true;
    }
    // 5) 战术材料（按 kind 期望数量一次抽取）
    const tc = da.tactical;
    if (tc.normal + tc.elite + tc.boss > 0) {
      const zone = s._tacticalZone || (state.combat.mode === "deathspace" ? G("getDeathspaceById")(state.combat.deathspaceId) : null);
      const anyZone = (s.killsByZone && Object.keys(s.killsByZone)[0]) ? COMBAT_ZONES.find(z => z.id === Object.keys(s.killsByZone)[0]) : null;
      const tzc = anyZone ? G("getTacticalMaterialDropConfig")(anyZone) : null;
      if (tzc) {
        // 期望数量：普通 0.7×1，精英 2.5，Boss 8（与 rollTacticalMaterialDrop 同口径）
        let expectedQty = tc.normal * 0.7 * 1 + tc.elite * 1 * 2.5 + tc.boss * 1 * 8;
        const base = Math.floor(expectedQty);
        const frac = expectedQty - base;
        const n = base + (rng() < frac ? 1 : 0);
        if (n > 0) { RR.add(state, "special:" + tzc.materialId, n); addResource(s, "special:" + tzc.materialId, n); }
      }
    }
  }

  // 导出
  if (typeof globalThis !== "undefined") globalThis.OfflineCombatSystem = OfflineCombatSystem;
  if (typeof window !== "undefined") window.OfflineCombatSystem = OfflineCombatSystem;
  if (typeof module !== "undefined" && module.exports) module.exports = OfflineCombatSystem;
})();
