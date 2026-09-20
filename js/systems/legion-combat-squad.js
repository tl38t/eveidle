// ================================================================
// 军团 DLC —— NPC 战斗小队（M1：状态结构 / 研究门禁 / 参战资格 / 占用保护）
// ----------------------------------------------------------------
// 职责边界（M1）：
//   1. state.combat.squad 结构的创建与幂等迁移（权威结构见 createDefaultSquad）；
//   2. NPC 本体持久化战斗字段（destroyed / repairUntil / occupiedByCombat / combatHp）
//      的归一化 —— NPC 本体是修复状态的权威来源，squad.members 只存引用与临时态；
//   3. 双人 / 三人协议研究门禁（消费 research.js 的 legion_dual_squad / legion_triple_squad
//      协议节点，读 state.research.completedLevels，缺失时安全回退单舰战斗）；
//   4. 参战资格判定（稳定 reason，不抛异常）；
//   5. 占用保护原语（战斗占用 / 爆船修复期间锁定换舰、解雇、拆解）。
//
// 明确不做（M2/M3/M4/M5）：
//   舰船属性计算、伤害倍率应用、在线战斗接入、离线结算、UI 渲染。
//   本模块不复制任何战斗伤害 / 弹药 / 燃料公式。
//
// 依赖：legion-npc.js（UMD 同目录；缺失时全部接口安全回退，不崩溃）。
// 兼容双环境：浏览器挂 window.LEGION_COMBAT_SQUAD，Node 下 module.exports。
// ================================================================
(function (root, factory) {
  let npc = null;
  if (typeof require !== "undefined") {
    try { npc = require("./legion-npc.js"); } catch (_) { npc = null; }
  } else if (root && root.LEGION_NPC) {
    npc = root.LEGION_NPC;
  }
  const mod = factory({ npc: npc });
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  if (typeof window !== "undefined") window.LEGION_COMBAT_SQUAD = mod;
  else if (root) root.LEGION_COMBAT_SQUAD = mod;
})(typeof self !== "undefined" ? self : this, function (deps) {
  "use strict";

  const NPC = deps && deps.npc ? deps.npc : null;

  // —— 常量 ——
  const NPC_REPAIR_DURATION_MS = 180000; // NPC 舰船爆船后固定修复 180 秒（M3 写入，M1 暴露常量供测试）

  // 参战资格稳定 reason 集合（UI / 测试按 key 显示，禁止直拼）
  const JOIN_REASONS = {
    "legion-unavailable": "军团 NPC 系统不可用",
    "legion-inactive": "军团系统未激活（本体/议事大厅条件未满足）",
    "dual-squad-locked": "双人战斗小队协议未完成",
    "triple-squad-locked": "三人战斗小队协议未完成",
    "squad-full": "小队成员已满",
    "npc-not-found": "NPC 不存在",
    "already-in-squad": "该 NPC 已在小队中",
    "not-combat": "该 NPC 的技能类别不是战斗",
    "salary-overdue": "该 NPC 欠薪，不能新加入战斗",
    "no-ship": "该 NPC 未绑定舰船",
    "ship-not-found": "该 NPC 绑定的舰船实例不存在",
    "ship-not-combat": "绑定的舰船不是战斗舰",
    "no-weapon": "绑定舰船未装备任何有效武器",
    "npc-destroyed": "该 NPC 舰船已爆船，等待修复",
    "npc-repairing": "该 NPC 舰船修复中，暂不能参战",
    "npc-occupied": "该 NPC 已被其他战斗场景占用"
  };

  // —— 小队默认结构（唯一事实来源；state.js 默认值与本函数保持一致）——
  // lastRound：本回合小队结果临时快照（战斗结束清理），不参与存档语义。
  function createDefaultSquad() {
    return { enabled: false, members: [], deployables: [], deployableStorage: [], targetId: null, battleId: null, lastRound: null, pendingNpcIds: [] };
  }

  // —— state.combat.squad 幂等迁移（旧档缺字段补默认值；重复调用结果不变）——
  function ensureCombatSquadState(state) {
    if (!state || typeof state !== "object") return null;
    if (!state.combat || typeof state.combat !== "object") state.combat = {};
    const c = state.combat;
    if (!c.squad || typeof c.squad !== "object" || Array.isArray(c.squad)) {
      c.squad = createDefaultSquad();
      if (typeof state._dirty === "boolean") state._dirty = true;
      return c.squad;
    }
    const s = c.squad;
    let touched = false;
    if (typeof s.enabled !== "boolean") { s.enabled = false; touched = true; }
    if (!Array.isArray(s.members)) { s.members = []; touched = true; }
    else {
      // 非法成员（缺 npcId / 非对象）安全丢弃；成员仅保留 M1 规定的引用字段
      const kept = s.members.filter(m => m && typeof m === "object" && m.npcId != null);
      if (kept.length !== s.members.length) { s.members = kept; touched = true; }
    }
    if (!Array.isArray(s.deployables)) { s.deployables = []; touched = true; }
    else {
      const dk = s.deployables.filter(d => d && typeof d === "object" && d.deployableId != null);
      if (dk.length !== s.deployables.length) { s.deployables = dk; touched = true; }
    }
    if (!Array.isArray(s.deployableStorage)) { s.deployableStorage = []; touched = true; }
    if (s.targetId === undefined) { s.targetId = null; touched = true; }
    if (s.battleId === undefined) { s.battleId = null; touched = true; }
    if (s.lastRound === undefined) { s.lastRound = null; touched = true; }
    if (!Array.isArray(s.pendingNpcIds)) { s.pendingNpcIds = []; touched = true; }
    // 容量门控：未解锁双人/三人协议时（capacity<=0），MTU 等部署物失去小队槽位，
    // 强制从 deployables 召回 storage，避免「单舰战斗却享受 MTU 加成」的脏数据漏洞。
    const capacity = getLegionSquadCapacity(state);
    if (capacity <= 0) {
      if (s.enabled) { s.enabled = false; touched = true; }
      if (!Array.isArray(s.pendingNpcIds) || s.pendingNpcIds.length > 0) { s.pendingNpcIds = []; touched = true; }
      if (Array.isArray(s.deployables) && s.deployables.length > 0) {
        for (const d of s.deployables) {
          if (d && d.deployableId && !s.deployableStorage.includes(d.deployableId)) {
            s.deployableStorage.push(d.deployableId);
          }
        }
        s.deployables = [];
        touched = true;
      }
    }
    if (touched && typeof state._dirty === "boolean") state._dirty = true;
    return s;
  }

  // —— NPC 本体战斗字段归一化（幂等；权威存储在 state.legion.npcs[]）——
  function ensureLegionNpcCombatFields(npc) {
    if (!npc || typeof npc !== "object") return npc;
    if (npc.destroyed === undefined) npc.destroyed = false;
    else npc.destroyed = Boolean(npc.destroyed);
    if (npc.repairUntil === undefined) npc.repairUntil = null;
    if (npc.occupiedByCombat === undefined) npc.occupiedByCombat = false;
    else npc.occupiedByCombat = Boolean(npc.occupiedByCombat);
    if (!npc.combatHp || typeof npc.combatHp !== "object") npc.combatHp = { shield: null, armor: null, structure: null };
    else {
      ["shield", "armor", "structure"].forEach(function (k) {
        if (npc.combatHp[k] === undefined) npc.combatHp[k] = null;
      });
    }
    return npc;
  }

  // 批量归一化：state.legion.npcs 全量补默认（旧存档迁移入口，幂等）
  function ensureLegionNpcsCombatFields(state) {
    const L = state && state.legion;
    if (!L || !Array.isArray(L.npcs)) return 0;
    let touched = 0;
    L.npcs.forEach(function (npc) {
      const before = JSON.stringify([npc.destroyed, npc.repairUntil, npc.occupiedByCombat, npc.combatHp]);
      ensureLegionNpcCombatFields(npc);
      if (JSON.stringify([npc.destroyed, npc.repairUntil, npc.occupiedByCombat, npc.combatHp]) !== before) touched++;
    });
    if (touched > 0 && typeof state._dirty === "boolean") state._dirty = true;
    return touched;
  }

  // —— 研究门禁（消费现有协议节点；研究系统缺失 → 安全回退单舰战斗）——
  function getCompletedLevels(state) {
    return (state && state.research && state.research.completedLevels &&
      typeof state.research.completedLevels === "object") ? state.research.completedLevels : null;
  }
  function isLegionDualSquadUnlocked(state) {
    const cl = getCompletedLevels(state);
    if (!cl) return false; // 研究系统缺失 → 只能玩家单舰
    return (Number(cl.legion_dual_squad) || 0) >= 1;
  }
  function isLegionTripleSquadUnlocked(state) {
    if (!isLegionDualSquadUnlocked(state)) return false; // 三人协议前置含双人协议
    const cl = getCompletedLevels(state);
    return (Number(cl.legion_triple_squad) || 0) >= 1;
  }
  // 当前允许的 NPC 成员上限（不含玩家）：0 / 1 / 2
  function getLegionSquadCapacity(state) {
    if (isLegionTripleSquadUnlocked(state)) return 2;
    if (isLegionDualSquadUnlocked(state)) return 1;
    return 0;
  }

  // —— 内部工具 ——
  function findNpc(state, npcId) {
    const L = state && state.legion;
    if (!L || !Array.isArray(L.npcs)) return null;
    for (let i = 0; i < L.npcs.length; i++) {
      if (L.npcs[i] && L.npcs[i].npcId === npcId) return L.npcs[i];
    }
    return null;
  }
  function findShipInstance(state, instanceId) {
    const ships = state && state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
    for (let i = 0; i < ships.length; i++) {
      if (ships[i] && ships[i].instanceId === instanceId) return ships[i];
    }
    return null;
  }
  function resolveNow(opts) {
    const n = opts ? Number(opts.now) : NaN;
    return (Number.isFinite(n)) ? n : Date.now();
  }
  function markDirty(state) {
    if (state && typeof state._dirty === "boolean") state._dirty = true;
  }

  // 装备定义表读取：浏览器走全局 EQUIPMENT_DB（经典 script 顶层 const，跨脚本按名可访问），
  // Node/测试可注入 globalThis.EQUIPMENT_DB。缺失 → 视为无法证明有武器（保守拒绝）。
  function getEquipmentDb() {
    try {
      if (typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB) return EQUIPMENT_DB;
    } catch (_) { /* Node 下未定义 */ }
    if (typeof globalThis !== "undefined" && globalThis.EQUIPMENT_DB) return globalThis.EQUIPMENT_DB;
    return null;
  }

  // 解析 fitted 引用 → 装备定义。优先复用现有 resolveEquipmentReference（浏览器已加载时），
  // 否则退化为本地最小解析（仅判定「是否武器」所需字段，不复制任何战斗公式）。
  function resolveFittedDefinition(state, ref) {
    const resolver = (typeof resolveEquipmentReference === "function") ? resolveEquipmentReference
      : (typeof globalThis !== "undefined" && typeof globalThis.resolveEquipmentReference === "function")
        ? globalThis.resolveEquipmentReference : null;
    if (resolver) {
      const resolved = resolver(state, ref);
      return resolved ? resolved.definition : null;
    }
    const db = getEquipmentDb();
    if (!db) return null;
    let itemId = ref;
    if (state && state.equipment && Array.isArray(state.equipment.instances)) {
      const inst = state.equipment.instances.find(e => e && String(e.instanceId) === String(ref));
      if (inst) itemId = inst.itemId;
    }
    return db[itemId] || null;
  }

  // 判定舰船实例是否至少装有一件有效武器（combat.kind === "weapon"）
  function shipHasWeapon(state, ship) {
    if (!ship) return false;
    const high = (ship.fitted && Array.isArray(ship.fitted.high)) ? ship.fitted.high : [];
    for (let i = 0; i < high.length; i++) {
      const ref = high[i];
      if (ref === null || ref === undefined || ref === "") continue;
      const def = resolveFittedDefinition(state, ref);
      if (def && def.combat && def.combat.kind === "weapon") return true;
    }
    // 泰坦特例（2026-09-13）：泰坦高槽出厂被末日武器占位（slots.highUsable=0 → fitted.high 无真实武器），
    // 主武器为舰体自带（config.weapon，不在 fitting 表内）。与 combat.js / actions.js(CombatStateActions.start)
    // / offline-combat.js 死亡空间链门禁同口径：主武器存在即视为有武器，否则泰坦无法加入军团战斗小队。
    const isTitanFn = getGlobalFn("isTitanCombatShip");
    if (typeof isTitanFn === "function" && ship.instanceId) {
      const cfg = getShipConfigFor(state, ship.instanceId);
      if (cfg && isTitanFn(cfg) && cfg.weapon) return true;
    }
    return false;
  }

  // —— 参战资格（稳定 reason，不抛异常）——
  // 返回 { ok:boolean, reason?:key, npc?:摘要 }；M1 只判定资格，不写入任何状态。
  function canLegionNpcJoinCombat(state, npcId, opts) {
    opts = opts || {};
    const now = resolveNow(opts);
    const squad = ensureCombatSquadState(state);

    if (!NPC || typeof NPC.isLegionSystemActive !== "function") return { ok: false, reason: "legion-unavailable" };
    if (!NPC.isLegionSystemActive(state)) return { ok: false, reason: "legion-inactive" };
    if (!isLegionDualSquadUnlocked(state)) return { ok: false, reason: "dual-squad-locked" };

    const npc = findNpc(state, npcId);
    if (!npc) return { ok: false, reason: "npc-not-found" };
    ensureLegionNpcCombatFields(npc);

    if (squad && Array.isArray(squad.members) && squad.members.some(m => m.npcId === npcId)) {
      return { ok: false, reason: "already-in-squad" };
    }
    const capacity = getLegionSquadCapacity(state);
    const memberCount = squad && Array.isArray(squad.members) ? squad.members.length : 0;
    if (memberCount >= capacity) {
      return { ok: false, reason: capacity >= 2 ? "squad-full" : "triple-squad-locked" };
    }

    const skill = NPC.getSkillById ? NPC.getSkillById(npc.skillId) : null;
    if (!skill || skill.category !== "combat") return { ok: false, reason: "not-combat" };
    if (npc.mustered) return { ok: false, reason: "muster" }; // 集结待命：主动停效，不可参战
    if (npc.salaryState !== "paid") return { ok: false, reason: "salary-overdue" };

    if (!npc.boundShipInstanceId) return { ok: false, reason: "no-ship" };
    const ship = findShipInstance(state, npc.boundShipInstanceId);
    if (!ship) return { ok: false, reason: "ship-not-found" };
    const shipType = NPC.getShipTypeDef ? NPC.getShipTypeDef(ship.shipId) : null;
    if (!shipType || !NPC.getShipRole || NPC.getShipRole(shipType) !== "combat") {
      return { ok: false, reason: "ship-not-combat" };
    }
    if (!shipHasWeapon(state, ship)) return { ok: false, reason: "no-weapon" };

    if (npc.destroyed) return { ok: false, reason: "npc-destroyed" };
    const until = Number(npc.repairUntil);
    if (Number.isFinite(until) && until > now) return { ok: false, reason: "npc-repairing" };
    if (npc.occupiedByCombat) return { ok: false, reason: "npc-occupied" };

    return {
      ok: true,
      npc: {
        npcId: npc.npcId, name: npc.name, level: npc.level,
        skillId: npc.skillId, salaryState: npc.salaryState,
        shipInstanceId: npc.boundShipInstanceId, shipId: ship.shipId
      }
    };
  }

  // —— 可参战 NPC 列表（UI 只读；逐 NPC 给出 eligible / reason）——
  function getEligibleLegionCombatNpcs(state, opts) {
    opts = opts || {};
    const now = resolveNow(opts);
    ensureCombatSquadState(state);
    ensureLegionNpcsCombatFields(state);
    const L = state && state.legion;
    const npcs = (L && Array.isArray(L.npcs)) ? L.npcs : [];
    const memberIds = new Set((state.combat.squad.members || []).map(m => m.npcId));
    return npcs.map(function (npc) {
      ensureLegionNpcCombatFields(npc);
      const verdict = canLegionNpcJoinCombat(state, npc.npcId, { now: now });
      return {
        npcId: npc.npcId,
        name: npc.name,
        level: npc.level,
        skillId: npc.skillId,
        salaryState: npc.salaryState,
        shipInstanceId: npc.boundShipInstanceId,
        inSquad: memberIds.has(npc.npcId),
        eligible: Boolean(verdict.ok),
        reason: verdict.ok ? null : verdict.reason
      };
    });
  }

  // —— 占用保护原语 ——
  // 舰船是否被军团 NPC 战斗占用/修复锁定（selectors.getShipDismantleBlockReason 与本口径共用）。
  // 返回 null = 未锁定；"npc-combat" = 战斗占用中；"npc-repairing" = 爆船/修复期间。
  // 规则 7：爆船后 occupiedByCombat=false，但仍处于修复锁定（destroyed / repairUntil 未到）。
  function getShipCombatLockReason(state, instanceId, now) {
    if (!state || !instanceId) return null;
    const L = state.legion;
    if (!L || !Array.isArray(L.npcs)) return null;
    const t = Number(now);
    const nowFinite = Number.isFinite(t) ? t : Date.now();
    for (let i = 0; i < L.npcs.length; i++) {
      const npc = L.npcs[i];
      if (!npc || npc.boundShipInstanceId !== instanceId) continue;
      if (npc.occupiedByCombat) return "npc-combat";
      if (npc.destroyed) return "npc-repairing";
      const until = Number(npc.repairUntil);
      if (Number.isFinite(until) && until > nowFinite) return "npc-repairing";
    }
    return null;
  }

  // 舰船是否绑定给任意军团 NPC（无论战斗/修复/空闲）。返回 NPC 对象或 null。
  // 与 getShipCombatLockReason 区分：后者仅在战斗/修复期间返回锁定，本函数对所有绑定关系都返回
  // （用于船坞徽标、拆解/改装统一拦截）。
  function findLegionNpcByBoundShip(state, instanceId) {
    if (!state || !instanceId) return null;
    const L = state.legion;
    if (!L || !Array.isArray(L.npcs)) return null;
    for (let i = 0; i < L.npcs.length; i++) {
      const npc = L.npcs[i];
      if (npc && npc.boundShipInstanceId === instanceId) return npc;
    }
    return null;
  }

  // —— 小队成员操作（M1 原语；M3 在线战斗将复用）——
  function generateBattleId() {
    return "squad_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 0xFFFFFF).toString(36);
  }

  // 开始一场小队战斗：enabled=true，重置成员列表（玩家成员由战斗系统自身状态承载，不入 members）
  function beginLegionSquadBattle(state, opts) {
    opts = opts || {};
    const squad = ensureCombatSquadState(state);
    if (!squad) return { changed: false, reason: "no-state" };
    if (squad.enabled) return { changed: false, reason: "squad-active" };
    squad.enabled = true;
    squad.members = [];
    squad.targetId = null;
    squad.lastRound = null;
    squad.battleId = (typeof opts.battleId === "string" && opts.battleId) ? opts.battleId : generateBattleId();
    if (state && state.combat) state.combat.runSquadDamageDealt = 0;
    markDirty(state);
    return { changed: true, battleId: squad.battleId };
  }

  // 加入一名 NPC 成员（完整走资格判定；成功后置 occupiedByCombat=true）
  function addLegionNpcToCombatSquad(state, npcId, opts) {
    const squad = ensureCombatSquadState(state);
    if (!squad || !squad.enabled) return { changed: false, reason: "squad-inactive" };
    const verdict = canLegionNpcJoinCombat(state, npcId, opts);
    if (!verdict.ok) return { changed: false, reason: verdict.reason };
    const npc = findNpc(state, npcId);
    npc.occupiedByCombat = true;
    const entryHp = ensureNpcCombatHp(state, npc, resolveNow(opts)); // 入队即按满血初始化（战斗开始新的一场）
    if (entryHp && !npc.destroyed && entryHp.shield <= 0 && entryHp.armor <= 0 && entryHp.structure <= 0) {
      const stats = getLegionNpcCombatStats(state, npc.npcId, {});
      if (stats.ok && stats.maxHp) npc.combatHp = { shield: stats.maxHp.shield, armor: stats.maxHp.armor, structure: stats.maxHp.structure };
    }
    squad.members.push({
      npcId: npc.npcId,
      shipInstanceId: npc.boundShipInstanceId, // 锁定本舰：战斗期间不可更换
      active: true,
      destroyedInBattle: false
    });
    markDirty(state);
    return { changed: true, member: squad.members[squad.members.length - 1] };
  }

  // 移除一名 NPC 成员（战斗结束清理 / 爆船退场共用；释放占用）
  function removeLegionNpcFromCombatSquad(state, npcId) {
    const squad = state && state.combat ? state.combat.squad : null;
    if (!squad || !Array.isArray(squad.members)) return { changed: false, reason: "no-squad" };
    const idx = squad.members.findIndex(m => m && m.npcId === npcId);
    if (idx < 0) return { changed: false, reason: "not-in-squad" };
    squad.members.splice(idx, 1);
    const npc = findNpc(state, npcId);
    if (npc) {
      ensureLegionNpcCombatFields(npc);
      npc.occupiedByCombat = false; // 规则 7：爆船退场同样释放占用（修复锁定由 destroyed/repairUntil 承担）
    }
    markDirty(state);
    return { changed: true };
  }

  // —— 部署物（激光定向打捞单元等）：容量共享原语 ——
  // 最大部署数 1；与 NPC 成员共享 state.combat.squad 容量（members.length + deployables.length ≤ capacity）。
  // 制造完成：优先自动部署，满则转入 deployableStorage（召回待部署，不丢失）。
  const MTU_MAX_DEPLOYED = 1;
  // NPC select 选项里"虚拟装备一台激光定向打捞单元"的特殊 id 前缀（与 npcId 同空间）。
  // 走向：拆给 setLegionSquadSelection 的 deployable 同步分支（不动 storage；与"工程制造+手动部署"双轨制）。
  const MTU_DEPLOYABLE_PREFIX = "deployable:";
  function addDeployableToSquad(state, deployableId) {
    const squad = ensureCombatSquadState(state);
    if (!squad || !deployableId) return { changed: false, reason: "no-squad" };
    const def = (typeof getDeployableDefinition === "function") ? getDeployableDefinition(deployableId) : null;
    const name = def ? def.name : deployableId;
    const capacity = getLegionSquadCapacity(state);
    // 未解锁小队协议时无共享槽位，制造完成的部署物只能进库存，不能自动部署。
    if (capacity > 0 && squad.deployables.length < MTU_MAX_DEPLOYED) {
      squad.deployables.push({ deployableId: deployableId, name: name });
      markDirty(state);
      return { changed: true, where: "deployed", deployableId: deployableId };
    }
    if (!squad.deployableStorage.includes(deployableId)) squad.deployableStorage.push(deployableId);
    markDirty(state);
    return { changed: true, where: "storage", deployableId: deployableId };
  }

  // 从库存部署（占用 1 个共享格；与 NPC 成员互斥抢格）
  function deployDeployable(state, deployableId) {
    const squad = ensureCombatSquadState(state);
    if (!squad || !deployableId) return { changed: false, reason: "no-squad" };
    const capacity = getLegionSquadCapacity(state);
    if (capacity <= 0) return { changed: false, reason: "dual-squad-locked" };
    if (squad.deployables.length >= MTU_MAX_DEPLOYED) return { changed: false, reason: "deploy-full" };
    const idx = squad.deployableStorage.indexOf(deployableId);
    if (idx < 0) return { changed: false, reason: "not-in-storage" };
    if (squad.members.length + squad.deployables.length >= capacity) return { changed: false, reason: "squad-full" };
    squad.deployableStorage.splice(idx, 1);
    const def = (typeof getDeployableDefinition === "function") ? getDeployableDefinition(deployableId) : null;
    squad.deployables.push({ deployableId: deployableId, name: def ? def.name : deployableId });
    markDirty(state);
    return { changed: true, deployableId: deployableId };
  }

  // 取消部署（召回库存；部署=生效，取消部署=关闭）
  function undeployDeployable(state, deployableId) {
    const squad = ensureCombatSquadState(state);
    if (!squad || !deployableId) return { changed: false, reason: "no-squad" };
    const idx = squad.deployables.findIndex(d => d && d.deployableId === deployableId);
    if (idx < 0) return { changed: false, reason: "not-deployed" };
    squad.deployables.splice(idx, 1);
    if (!squad.deployableStorage.includes(deployableId)) squad.deployableStorage.push(deployableId);
    markDirty(state);
    return { changed: true, deployableId: deployableId };
  }

  // 部署物拆解（按舰船拆解公式回收材料）：仅允许「库存中（未部署）」的部署物。
  // 归还 = getShipDismantleQuote(recipe, null, 0, 冶炼回收率) 逐项 floor(总量×rate)；与舰船拆解同源同口径。
  // 已部署（生效中）的须先取消部署才能回收，避免"在用即退料"。
  function dismantleDeployable(state, deployableId) {
    const squad = ensureCombatSquadState(state);
    if (!squad || !deployableId) return { changed: false, reason: "no-squad" };
    if (Array.isArray(squad.deployables) && squad.deployables.some(d => d && d.deployableId === deployableId)) {
      return { changed: false, reason: "deployed" };
    }
    const idx = (squad.deployableStorage || []).indexOf(deployableId);
    if (idx < 0) return { changed: false, reason: "not-in-storage" };
    const recipe = (typeof SHIP_ASSEMBLY_RECIPES !== "undefined")
      ? SHIP_ASSEMBLY_RECIPES.find(r => r.deployableId === deployableId) : null;
    if (!recipe) return { changed: false, reason: "no-recipe" };
    const reclaimRate = (typeof getReclaimRate === "function") ? getReclaimRate(state) : 0.5;
    const preview = getShipDismantleQuote(recipe, null, 0, reclaimRate);
    const refundedResources = {};
    for (const entry of preview) {
      if (entry.refId) {
        ResourceRegistry.add(state, entry.refId, entry.returned);
        refundedResources[entry.refId] = (refundedResources[entry.refId] || 0) + entry.returned;
      }
    }
    squad.deployableStorage.splice(idx, 1);
    markDirty(state);
    if (typeof GameEvents !== "undefined") {
      GameEvents.emit("item:recycled", {
        totalBase: preview.reduce((s, e) => s + (Number(e.total) || 0), 0),
        totalFinal: preview.reduce((s, e) => s + (Number(e.returned) || 0), 0)
      }, { offline: false, source: "deployable-dismantle" });
    }
    return { changed: true, deployableId: deployableId, returned: preview, refundedResources: refundedResources };
  }

  // 结束小队战斗：清理 squad 临时状态；不清理 NPC 本体的 destroyed / repairUntil / 舰船 HP
  function endLegionSquadBattle(state) {
    const squad = ensureCombatSquadState(state);
    if (!squad) return { changed: false, reason: "no-state" };
    if (!squad.enabled && (!squad.members || squad.members.length === 0)) {
      return { changed: false, reason: "squad-inactive" };
    }
    const memberIds = (squad.members || []).map(m => m.npcId);
    squad.members = [];
    squad.targetId = null;
    squad.battleId = null;
    squad.lastRound = null;
    squad.enabled = false;
    memberIds.forEach(function (npcId) {
      const npc = findNpc(state, npcId);
      if (npc) {
        ensureLegionNpcCombatFields(npc);
        npc.occupiedByCombat = false; // 爆船者此处再清一次（destroyed/repairUntil 保留）
        // M5 修复：存活 NPC 战斗结束即回满血（与玩家下场重置满血对称；爆船者由修复流程在
        // completeLegionNpcRepair 回满，此处跳过 destroyed，避免覆盖修复倒计时）。
        if (!npc.destroyed) {
          const stats = getLegionNpcCombatStats(state, npcId, {});
          if (stats.ok && stats.maxHp) {
            npc.combatHp = { shield: stats.maxHp.shield, armor: stats.maxHp.armor, structure: stats.maxHp.structure };
          }
        }
      }
    });
    markDirty(state);
    return { changed: true, releasedNpcIds: memberIds };
  }

  // —— 只读快照（UI / 测试用；返回防御性拷贝，禁止外部直接改 state）——
  function getLegionCombatSquadState(state) {
    const squad = ensureCombatSquadState(state);
    if (!squad) return null;
    const capacity = getLegionSquadCapacity(state);
    return {
      enabled: capacity > 0 ? squad.enabled : false,
      battleId: capacity > 0 ? squad.battleId : null,
      targetId: capacity > 0 ? squad.targetId : null,
      members: capacity > 0 ? squad.members.map(m => ({
        npcId: m.npcId, shipInstanceId: m.shipInstanceId,
        active: Boolean(m.active), destroyedInBattle: Boolean(m.destroyedInBattle)
      })) : [],
      deployables: capacity > 0 ? squad.deployables.map(d => ({ deployableId: d.deployableId, name: d.name })) : [],
      deployableStorage: squad.deployableStorage.slice(),
      deployedCount: capacity > 0 ? squad.deployables.length : 0,
      capacity: capacity,
      dualUnlocked: isLegionDualSquadUnlocked(state),
      tripleUnlocked: isLegionTripleSquadUnlocked(state)
    };
  }

  // ================================================================
  // M2：NPC 伤害倍率与舰船属性（显式实例化 + 脑插排除）
  // ----------------------------------------------------------------
  // 伤害倍率（只作用于 NPC 输出伤害，不影响 NPC 防御/电容/射程/冷却/命中）：
  //   damageMultiplier = 0.30 + (npcLevel - 1) / 69 * 0.70
  //   LV1=30%，LV20≈49.28%，LV70=100%；等级下限 1，倍率封顶 1
  //   （等级上限 70 由 getLegionNpcLevelCap 保证，>70 的脏数据此处钳制）。
  // 舰船属性：调用 selectors.js 既有选择器（同一套公式，零复制），传显式
  //   { shipInstanceId, excludeImplants:true }；选择器缺失（Node 直载 / 脚本
  //   缺失）时安全返回 combat-selectors-unavailable，不崩溃。
  // ================================================================
  function getLegionNpcDamageMultiplier(npc) {
    const level = Math.max(1, Math.floor(Number(npc && npc.level) || 1));
    const raw = 0.30 + (level - 1) / 69 * 0.70;
    return Math.min(1, Math.max(0.30, raw));
  }

  // selectors 访问器：浏览器为经典 script 顶层函数（跨脚本按名可见）；缺失返回 null。
  function getCombatSelector(name) {
    try {
      if (typeof globalThis !== "undefined" && typeof globalThis[name] === "function") return globalThis[name];
    } catch (_) { /* ignore */ }
    return null;
  }

  function offlineModuleCache(context) {
    const v = context && context.virtual;
    // 仅虚拟资源池代表离线结算；在线路径不带 virtual，保持原逻辑。
    if (!v || typeof v !== "object") return null;
    if (!v._offlineSquadModuleCache) v._offlineSquadModuleCache = Object.create(null);
    return v._offlineSquadModuleCache;
  }

  // NPC 战斗属性快照（纯只读；不修改玩家舰船、不写入任何 state）。
  // 返回 { ok, reason?, npcId, name, level, shipInstanceId, shipId,
  //        maxHp{shield,armor,structure}, dodge, fuelMultiplier,
  //        weapons[{ref,weaponType,baseDamage,ammoCost,fuelCost,hit,damageMultiplier}],
  //        levelDamageMultiplier, excludeImplants:true }
  function getLegionNpcCombatStats(state, npcId, opts) {
    opts = opts || {};
    const npc = findNpc(state, npcId);
    if (!npc) return { ok: false, reason: "npc-not-found" };
    ensureLegionNpcCombatFields(npc);
    if (!npc.boundShipInstanceId) return { ok: false, reason: "no-ship" };
    const ship = findShipInstance(state, npc.boundShipInstanceId);
    if (!ship) return { ok: false, reason: "ship-not-found" };

    const selMaxHp = getCombatSelector("getCombatMaxHpFromState");
    const selHit = getCombatSelector("getCombatWeaponHitFromState");
    const selDmgMult = getCombatSelector("getCombatDamageMultiplierFromState");
    const selDodge = getCombatSelector("getCombatPlayerDodgeFromState");
    const selFuel = getCombatSelector("getCombatFuelMultiplierFromState");
    if (!selMaxHp || !selHit || !selDmgMult || !selDodge || !selFuel) {
      return { ok: false, reason: "combat-selectors-unavailable" };
    }

    // 统一显式参数：按绑定实例计算 + 排除脑插；绝不回退到玩家当前出战舰。
    const shipOpts = { shipInstanceId: npc.boundShipInstanceId, excludeImplants: true };
    if (opts._offlineModuleCache) shipOpts._offlineModuleCache = opts._offlineModuleCache;

    const maxHp = selMaxHp(state, undefined, shipOpts);
    const dodge = selDodge(state, undefined, shipOpts);
    const fuelMultiplier = selFuel(state, opts.zone || undefined, undefined, shipOpts);

    // 武器清单：遍历绑定舰 fitted.high，combat.kind === "weapon"（与战斗系统同口径）
    const weapons = [];
    const high = (ship.fitted && Array.isArray(ship.fitted.high)) ? ship.fitted.high : [];
    for (const ref of high) {
      if (ref === null || ref === undefined || ref === "") continue;
      const def = resolveFittedDefinition(state, ref);
      if (!def || !def.combat || def.combat.kind !== "weapon") continue;
      const combat = def.combat;
      weapons.push({
        ref: ref,
        weaponType: combat.weaponType,
        baseDamage: combat.baseDamage,
        ammoCost: combat.ammoCost != null ? combat.ammoCost : 1,
        fuelCost: combat.fuelCost != null ? combat.fuelCost : 1,
        hit: selHit(state, combat.weaponType, combat, undefined, shipOpts),
        damageMultiplier: selDmgMult(state, combat.weaponType, undefined, shipOpts)
      });
    }

    // 2026-09-05：面板攻击力（单轮齐射基准伤害）
    //   = Σ [combat.baseDamage × 模块强化倍率(m.multiplier) × 武器类型伤害倍率(技能/改装等 selDmgMult) × 武器增强剂] × NPC等级伤害倍率
    // 与实弹 volley 同源取模块（getInstalledCombatWeapons + 同一 shipOpts，见 processLegionNpcVolley），杜绝公式双写。
    // 刻意不含：弹药 dmgMult / 克制倍率 / 命中-闪避系数 / 0.9~1.1 随机浮动 —— 均依赖目标或弹药池，面板口径排除。
    // 2026-09-09：面板明细（与玩家舰「实战属性」同构）——纯只读，不消耗任何资源、不改任何 state。
    // 攻击逐件：基础伤害 × 模块强化倍率 × 武器类型倍率 × 武器增强剂 × NPC 等级倍率（与 attackPower 同一循环，杜绝公式双写）。
    // 2026-09-12 修复：补武器增强剂（攻击药）乘区 —— 实弹管线 boosterMult 早已计入（见 fireSingleNpcMember），
    //   面板此前漏乘 ⇒ 玩家吃攻击药时 NPC 面板攻击力低于实弹实际输出（玩家报「面板不显示药剂加的攻击」）。
    //   与玩家舰面板（selectors.js getCombatActualStatsFromState）逐项同构：同一 getBoosterEffectState 入口、
    //   同一 weaponDamageMultiplier[weaponType] 取值、同一「缺失即 1」退化。
    //   泰坦主武器走虚拟模块（不在 getInstalledCombatWeapons 结果内，其 booster 已单点并入 titanExtraMult），
    //   本循环天然不重复乘算，无需额外排除。
    const levelMult = getLegionNpcDamageMultiplier(npc);
    const boosterDmgMap = (function () {
      const fn = getGlobalFn("getBoosterEffectState");
      const st = fn ? fn(state) : null;
      return (st && st.weaponDamageMultiplier) ? st.weaponDamageMultiplier : null;
    })();
    const attackItems = [];
    let attackPower = 0;
    const volleyWeaponsFn = getCombatSelector("getInstalledCombatWeapons");
    if (volleyWeaponsFn) {
      const mods = volleyWeaponsFn(state, shipOpts) || [];
      for (const m of mods) {
        const cb = m && m.equipment && m.equipment.combat;
        if (!cb) continue;
        const typeMult = Number(selDmgMult(state, cb.weaponType, undefined, shipOpts)) || 1;
        const enhancement = Number(m.multiplier) || 1;
        const atkBooster = (boosterDmgMap && boosterDmgMap[cb.weaponType]) ? Number(boosterDmgMap[cb.weaponType]) || 1 : 1;
        const raw = (Number(cb.baseDamage) || 0) * enhancement * typeMult * atkBooster;
        attackPower += raw;
        attackItems.push({
          name: (m.equipment && m.equipment.name) || cb.weaponType,
          weaponType: cb.weaponType,
          base: Math.round(Number(cb.baseDamage) || 0),
          enhancement: enhancement,
          typeMult: typeMult,
          atkBooster: atkBooster,
          levelMult: levelMult,
          value: Math.round(raw * levelMult)
        });
      }
    }
    // ── 攻击（泰坦）：舰体自带主武器（2026-09-17，玩家报「NPC 泰坦不显示攻击」）──
    // 泰坦高槽被末日武器占位（highUsable=0）、主武器随舰体自带（config.weapon，不在 fitting 表）
    // ⇒ 上面 getInstalledCombatWeapons 循环恒不命中，NPC 绑定泰坦面板恒显「攻击 0 / 未安装武器」。
    // 与 fireSingleNpcMember 泰坦虚拟模块实弹链同口径：类型乘区(selDmgMult) × 武器增强剂 × 结构过载 ×
    // 脑突触 × 暴击期望 × 等级倍率；统御矩阵团队光环经 total 的 panelAuraDmgMult 已计入（stacking=max，
    // 含 NPC 泰坦自身核心，见 getTitanSquadAura ②-a），条目内不重复乘。
    // 面板惯例排除：弹药档/克制/易伤/命中-闪避/±10% 随机浮动；联盟加成 NPC 实弹链本身不含，故不乘。
    let titanPanelFuel = 0;
    const npcTitanLoadout = resolveNpcTitanLoadout(state, shipOpts);
    if (npcTitanLoadout && npcTitanLoadout.weapon) {
      const tw = npcTitanLoadout.weapon;
      const rdFn = getGlobalFn("getTitanWeaponRoundDamage");
      const critFn = getGlobalFn("rollTitanCritMultiplier");
      const adbmFn = getGlobalFn("getAdBuffMultiplier");
      const odFn = getGlobalFn("getTitanStructureOverdriveMultiplier");
      const rd = rdFn ? rdFn(tw, { round: 1, targetHpRatio: 1 }) : null;
      const mainBase = Math.max(0, Number((rd && rd.mainDamage != null) ? rd.mainDamage : tw.baseDamage) || 0);
      const titanTypeMult = Number(selDmgMult(state, tw.weaponType, undefined, shipOpts)) || 1;
      const titanBooster = (boosterDmgMap && boosterDmgMap[tw.weaponType]) ? Number(boosterDmgMap[tw.weaponType]) || 1 : 1;
      const adBuffMult = adbmFn ? (Number(adbmFn(state)) || 1) : 1;
      const critExpected = critFn ? (Number(critFn(tw.crit, null)) || 1) : 1;   // rng 传 null = 期望乘数
      // 结构过载：与实弹同输入（npc.combatHp / stats.maxHp），缺战斗态时退化为 1（与 fireSingleNpcMember 同退化）
      let overdriveMult = 1;
      if (odFn && npcTitanLoadout.trait && npc.combatHp && maxHp) {
        overdriveMult = Number(odFn(npcTitanLoadout.trait, npc.combatHp, maxHp)) || 1;
      }
      const raw = mainBase * titanTypeMult * titanBooster * overdriveMult * adBuffMult * critExpected;
      attackPower += raw;
      const chainNote = [["类型", titanTypeMult], ["结构过载", overdriveMult], ["增强剂", titanBooster],
        ["脑突触", adBuffMult], ["暴击期望", critExpected]]
        .filter(pair => Math.abs(pair[1] - 1) > 1e-9).map(pair => pair[0] + " ×" + pair[1].toFixed(2)).join(" · ");
      attackItems.push({
        name: (tw.name || "舰载主武器") + "（舰体自带）",
        weaponType: tw.weaponType,
        base: Math.round(mainBase),
        enhancement: 1,
        typeMult: titanTypeMult,
        atkBooster: titanBooster,
        levelMult: levelMult,
        value: Math.round(raw * levelMult),
        titanMain: true,
        note: "基伤 " + Math.round(mainBase) + (chainNote ? " · " + chainNote : "")
      });
      // 泰坦主武器齐射燃料（含核心维持供能）：直接复用 fireSingleNpcMember 同一实现，禁公式双写
      const tFuel = computeTitanVolleyFuel(state, opts.zone, shipOpts, npcTitanLoadout.weapon, npcTitanLoadout.core);
      if (tFuel > 0) titanPanelFuel = tFuel;
    }
    // 面板与实战保持同口径：NPC 的攻击力显示包含统御矩阵当前生效的团队伤害加成。
    const panelTitanAura = getTitanSquadAura(state);
    const panelAuraDmgMult = (panelTitanAura && panelTitanAura.squadDamageBonus)
      ? 1 + Number(panelTitanAura.squadDamageBonus) : 1;
    attackPower = Math.round(attackPower * levelMult * panelAuraDmgMult);

    // 维修明细：与 repairLegionSquadNpcs 同源（collectNpcRepairUnits），面板按满结构基准估算
    const repairItems = [];
    let repairRaw = 0, repairFuel = 0;
    const repairMultFn = getGlobalFn("calcRepairMult");
    const boosterRep = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(state).repairMultiplier : null;
    for (const u of collectNpcRepairUnits(state, npc, opts.zone)) {
      const repairMult = repairMultFn ? (Number(repairMultFn(u.target, state, 1)) || 1) : 1;
      const repMult = (boosterRep && boosterRep[u.target]) ? (Number(boosterRep[u.target]) || 1) : 1;
      const value = u.amount * u.multiplier * repairMult * repMult;
      repairRaw += value;
      repairFuel += u.fuel;
      repairItems.push({
        name: u.name, target: u.target, amount: Math.round(u.amount),
        enhancement: u.multiplier, repairMult: repairMult, repMult: repMult,
        value: Math.round(value), fuel: u.fuel
      });
    }

    // 减伤明细：DCU 多件求和封顶 50%（与 computeNpcDcReduction 同源）+ 偏导护盾（船体特性）
    const dcUnits = collectNpcDamageControlUnits(state, npc, opts.zone);
    let dcuRaw = 0, dcFuel = 0;
    for (const u of dcUnits) { dcuRaw += u.reduction; dcFuel += u.fuel; }
    const dcu = Math.min(0.5, Math.max(0, dcuRaw));
    const shipCfgPanel = getShipConfigFor(state, npc.boundShipInstanceId);
    const trait = shipCfgPanel && shipCfgPanel.capitalTrait ? shipCfgPanel.capitalTrait : null;
    const isDeflector = Boolean(trait && trait.id && String(trait.id).indexOf("deflection_shield") >= 0);
    const deflector = isDeflector ? (Number(trait.reduction) || 0) : 0;
    const deflectorHits = isDeflector ? (Number(trait.shieldHits) || 0) : 0;

    // 燃料明细：武器齐射 / 损伤控制 / 维修 三项分列（泰坦主武器齐射燃料已并入 titanPanelFuel）
    let fuelWeapon = titanPanelFuel;
    for (const w of weapons) {
      const fc = Number(w.fuelCost);
      if (!(fc > 0)) continue;
      fuelWeapon += Math.max(1, Math.round(fc * fuelMultiplier));
    }

    return {
      ok: true,
      npcId: npc.npcId,
      name: npc.name,
      level: npc.level,
      shipInstanceId: npc.boundShipInstanceId,
      shipId: ship.shipId,
      shipName: (shipCfgPanel && shipCfgPanel.name) || ship.shipId,
      maxHp: maxHp,
      dodge: dodge,
      fuelMultiplier: fuelMultiplier,
      weapons: weapons,
      attackPower: attackPower,
      titanAuraDamageMultiplier: panelAuraDmgMult,
      titanAuraHitBonus: panelTitanAura ? Number(panelTitanAura.squadHitBonus) || 0 : 0,
      attack: { total: attackPower, count: attackItems.length, items: attackItems },
      repair: {
        total: Math.round(repairRaw), count: repairItems.length, items: repairItems,
        byTarget: (function () {
          // 与玩家侧同口径：三层血条独立回充，分层小计供 UI 展示，不做跨层求和
          const out = {};
          for (const it of repairItems) {
            if (!(it.value > 0)) continue;
            out[it.target] = (out[it.target] || 0) + it.value;
          }
          for (const k in out) out[k] = Math.round(out[k]);
          return out;
        })()
      },
      mitigation: {
        dcu: dcu,
        dcuCount: dcUnits.length,
        deflector: deflector,
        deflectorHits: deflectorHits,
        traitName: trait && trait.name ? trait.name : "",
        combined: 1 - (1 - dcu) * (1 - deflector)
      },
      fuel: {
        weapon: fuelWeapon,
        damageControl: dcFuel,
        repair: repairFuel,
        total: fuelWeapon + dcFuel + repairFuel,
        mult: fuelMultiplier
      },
      levelDamageMultiplier: levelMult,
      excludeImplants: true
    };
  }

  // ================================================================
  // M3：在线战斗小队接入（目标选择 / NPC 攻击 / 受伤爆船 / 180s 修复）
  // ----------------------------------------------------------------
  // 设计原则：
  //   - 不复制任何战斗公式：伤害用 combat.js 的 calcCombatDamage / applyLayeredCombatDamage /
  //     calcWeaponCounterMultiplier，属性用 selectors.js 选择器（显式实例 + 排除脑插），
  //     弹药用 ammo.js 的 consumeAmmoForType / getSelectedCount，燃料用 combat.js 的
  //     computeVolleyFuel（参数化实例版）与 ResourceRegistry。
  //   - 非小队模式（squad.enabled !== true）完全不介入，主战斗行为逐字节不变。
  //   - 随机数：优先战斗上下文 rng；缺省沿用战斗系统既有入口 nextCombatRandom(combat)，
  //     不 new 一套全局随机、不污染 Math.random 语义。
  // ================================================================

  // 通用全局函数访问器（浏览器经典 script 顶层函数可见）
  function getGlobalFn(name) {
    try {
      if (typeof globalThis !== "undefined" && typeof globalThis[name] === "function") return globalThis[name];
    } catch (_) { /* ignore */ }
    return null;
  }

  // 统御矩阵小队光环（2026-09-09 阶段3步骤6）：玩家出战泰坦且装备光环核心时，
  // NPC 小队成员伤害 ×(1+squadDamageBonus)、命中 +squadHitBonus。
  // 在线（processLegionNpcAttack→fireSingleNpcMember）与离线（offline-combat.js 直调
  // fireSingleNpcMember）共用本函数 → 单点接线双路径自动统计等效。
  // 光环按配置静态生效（与核心安装绑定），不做供能联动（核心供能仅约束泰坦自身开火）。
  // 面板口径（getLegionNpcCombatStats.attackPower）排除弹药/克制/命中，但包含当前有效的泰坦团队伤害光环。
  // ②-a（2026-09-10 用户拍板）：光环源 = 玩家出战舰 + 小队内每个在岗 NPC 的绑定舰，
  //   同类光环按配置 stacking="max" 取最高、不叠加。此前只读玩家出战舰，
  //   导致 NPC 泰坦的统御矩阵对全队（含玩家）零贡献。纯只读，不调用 ensureCombatSquadState。
  function getTitanSquadAura(state) {
    try {
      const activeSel = getCombatSelector("getActiveCombatShipState");
      const isTitanFn = getCombatSelector("isTitanCombatShip");
      const auraFn = getCombatSelector("getTitanCoreAura");
      if (!activeSel || !isTitanFn || !auraFn) return null;
      let best = null;
      const consider = (cfg) => {
        if (!cfg || !isTitanFn(cfg)) return;
        const a = auraFn(cfg.core || null);
        if (!a) return;
        if (!best) { best = a; return; }
        best = {
          squadDamageBonus: Math.max(Number(best.squadDamageBonus) || 0, Number(a.squadDamageBonus) || 0),
          squadHitBonus: Math.max(Number(best.squadHitBonus) || 0, Number(a.squadHitBonus) || 0)
        };
      };
      const active = activeSel(state);
      if (active && active.config) consider(active.config);
      const squad = (state && state.combat) ? state.combat.squad : null;
      if (squad && squad.enabled && Array.isArray(squad.members)) {
        for (const m of squad.members) {
          if (!m || m.npcId == null || m.active !== true || m.destroyedInBattle) continue;
          const npc = findNpc(state, m.npcId);
          if (!npc || npc.destroyed || !npc.boundShipInstanceId) continue;
          const inst = activeSel(state, { shipInstanceId: npc.boundShipInstanceId });
          if (inst && inst.config) consider(inst.config);
        }
      }
      return best;
    } catch (_) { return null; }
  }

  // 随机数解析：opts.rng > 战斗系统既有 nextCombatRandom(c) > Math.random 兜底
  function resolveBattleRng(opts, state) {
    if (opts && typeof opts.rng === "function") return opts.rng;
    const c = state && state.combat;
    const next = getGlobalFn("nextCombatRandom");
    if (c && next) return function () { return next(c); };
    return Math.random;
  }

  // —— 有效目标池：玩家 + 当前战斗中 active 且未爆船/未修复中的 NPC ——
  function getLegionCombatTargets(state, opts) {
    const now = resolveNow(opts);
    const targets = [{ kind: "player", npcId: null, shipInstanceId: null }];
    const squad = ensureCombatSquadState(state);
    if (!squad || !squad.enabled) return targets; // 单舰模式：恒为玩家
    for (const m of (squad.members || [])) {
      if (!m || m.npcId == null) continue;
      if (m.active !== true || m.destroyedInBattle) continue;
      const npc = findNpc(state, m.npcId);
      if (!npc) continue;
      ensureLegionNpcCombatFields(npc);
      if (npc.destroyed) continue;                       // 爆船 → 立即移出目标池
      const until = Number(npc.repairUntil);
      if (Number.isFinite(until) && until > now) continue; // 修复中 → 不在目标池
      targets.push({ kind: "npc", npcId: npc.npcId, shipInstanceId: npc.boundShipInstanceId });
    }
    return targets;
  }

  // —— 敌人攻击目标：所有有效目标等概率（无嘲讽/仇恨/玩家保护；可连续同目标）——
  // 每次调用只随一次；由 processLegionEnemyAttack 对每个敌人/每段攻击单独调用。
  function selectLegionCombatTarget(state, rng) {
    const targets = getLegionCombatTargets(state);
    const r = (typeof rng === "function") ? rng : Math.random;
    const raw = r();
    const roll = (typeof raw === "number" && Number.isFinite(raw)) ? Math.min(0.9999999999, Math.max(0, raw)) : 0;
    const index = Math.min(targets.length - 1, Math.floor(roll * targets.length));
    const picked = targets[index] || targets[0];
    return { kind: picked.kind, npcId: picked.npcId, shipInstanceId: picked.shipInstanceId, targetCount: targets.length, roll: roll };
  }

  // —— NPC 战斗 HP 初始化（缺失时按选择器满血初始化；属性不可得返回 null）——
  function ensureNpcCombatHp(state, npc, now) {
    ensureLegionNpcCombatFields(npc);
    const hp = npc.combatHp;
    // 严格判定：null 表示"未进入战斗/无有效 HP"，不能直接当 0（Number(null)===0 的陷阱）
    const isNum = (v) => typeof v === "number" && Number.isFinite(v);
    const complete = Boolean(hp) && isNum(hp.shield) && isNum(hp.armor) && isNum(hp.structure);
    if (complete) return hp;
    const stats = getLegionNpcCombatStats(state, npc.npcId, {});
    if (!stats.ok || !stats.maxHp) return null;
    npc.combatHp = { shield: stats.maxHp.shield, armor: stats.maxHp.armor, structure: stats.maxHp.structure };
    markDirty(state);
    return npc.combatHp;
  }

  // 回合开始时刷新小队成员状态（步骤 2）：初始化 HP、剔除失效成员、推进修复倒计时
  function syncLegionSquadMembers(state, opts) {
    opts = opts || {};
    const now = resolveNow(opts);
    const squad = ensureCombatSquadState(state);
    if (!squad) return { ok: false, reason: "no-state", members: [] };
    tickLegionSquadRepairs(state, now);
    if (!squad.enabled) return { ok: true, members: [] };
    const kept = [];
    for (const m of (squad.members || [])) {
      if (!m || m.npcId == null) continue;
      const npc = findNpc(state, m.npcId);
      if (!npc) continue;                                  // NPC 已不存在（被其它路径移除）→ 丢弃引用
      ensureLegionNpcCombatFields(npc);
      if (m.active === true && !m.destroyedInBattle) ensureNpcCombatHp(state, npc, now);
      kept.push(m);
    }
    squad.members = kept;
    return { ok: true, members: kept.map(m => ({ npcId: m.npcId, active: m.active, destroyedInBattle: Boolean(m.destroyedInBattle) })) };
  }

  // ================================================================
  // M4：虚拟资源注入（在线/离线共用同一原语）
  //   ctx.virtual 为离线会话快照 { ammo:{type:qty}, fuel:number } 时，消耗落在虚拟池
  //   （由 offline-combat.js 的 flush 一次性 apply，天然不重复扣费、不产生负库存）；
  //   否则走真实库存入口 ResourceRegistry / consumeAmmoForType（在线行为不变）。
  // ================================================================
  function spendFuelVirtual(ctx, amount) {
    const v = ctx && ctx.virtual;
    if (!v) return null;
    const before = Number(v.fuel) || 0;
    if (before < amount) return false; // 不足：调用方判定后停火，不产生负数
    v.fuel = Math.max(0, before - amount);
    return true;
  }
  function fuelAvailable(ctx, state, amount) {
    const v = ctx && ctx.virtual;
    if (v) return (Number(v.fuel) || 0) >= amount;
    const registry = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry
      : (typeof globalThis !== "undefined" ? globalThis.ResourceRegistry : null);
    return registry ? registry.get(state, "consumable:fuel") >= amount : false;
  }
  function spendFuel(ctx, state, amount) {
    const v = ctx && ctx.virtual;
    if (v) { v.fuel = Math.max(0, (Number(v.fuel) || 0) - amount); return true; }
    const registry = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry
      : (typeof globalThis !== "undefined" ? globalThis.ResourceRegistry : null);
    if (!registry) return false;
    registry.spend(state, "consumable:fuel", amount);
    return true;
  }
  // 弹药：虚拟模式按类型扣虚拟池；真实模式走 consumeAmmoForType（返回实际档位）
  function ammoAvailable(ctx, state, type, amount) {
    const v = ctx && ctx.virtual;
    if (v) return (Number(v.ammo[type]) || 0) >= amount;
    const count = getGlobalFn("getSelectedCount");
    return count ? count(state, type) >= amount : false;
  }
  function ammoTierFor(ctx, state, type) {
    const v = ctx && ctx.virtual;
    if (v) return (v.ammoTier && v.ammoTier[type]) ? v.ammoTier[type] : "T1";
    const stacksFn = getGlobalFn("getSelectedStacks");
    if (stacksFn) {
      const stacks = stacksFn(state, type) || [];
      if (stacks.length) return stacks[0].tier || "T1"; // D2：沿用玩家口径「已装载栈最高档」
    }
    return "T1";
  }
  function spendAmmo(ctx, state, type, amount) {
    const v = ctx && ctx.virtual;
    if (v) { v.ammo[type] = Math.max(0, (Number(v.ammo[type]) || 0) - amount); return true; }
    const consume = getGlobalFn("consumeAmmoForType");
    if (!consume) return false;
    consume(state, type, amount);
    return true;
  }

  // ================================================================
  // M5：战前选择与 UI 状态（只读快照 + 选择写入；UI 不直接改 state）
  // ================================================================
  function getLegionSquadSelection(state) {
    const squad = ensureCombatSquadState(state);
    if (!squad) return [];
    if (!Array.isArray(squad.pendingNpcIds)) squad.pendingNpcIds = [];
    return squad.pendingNpcIds.slice();
  }

  // 战前选择：写入 squad.pendingNpcIds，并按 MTU_DEPLOYABLE_PREFIX 同时维护 deployables。
  // 战斗中（squad.enabled）禁止修改（成员锁定）。
  // 防重复绑定：同次调用去重 + 按容量钳制（NPC + deployable 共享 capacity）+ 统一走 canLegionNpcJoinCombat 资格口径。
  // deployable 语义：以"本次 requested 的 deployable id 列表"为权威；旧 deployable id 不在新列表里就剔除。
  //   这样：玩家切走 select 里 deployable 的那项 → 对应 MTU 自动从 deployables 消失（与"虚拟装备"语义一致）。
  //   双轨制保留：工程制造完成的 `addDeployableToSquad`（自动部署或入 storage）和手动 `deployDeployable`
  //   仍然走 storage 路径，与本函数的"虚拟装备"互不干扰。
  function setLegionSquadSelection(state, npcIds, opts) {
    opts = opts || {};
    const squad = ensureCombatSquadState(state);
    if (!squad) return { changed: false, reason: "no-state", npcIds: [], deployableIds: [], skipped: [] };
    if (squad.enabled) return { changed: false, reason: "squad-locked", npcIds: getLegionSquadSelection(state), deployableIds: (Array.isArray(squad.deployables) ? squad.deployables.map(d => d.deployableId) : []), skipped: [] };
    const capacity = getLegionSquadCapacity(state);
    if (capacity <= 0) return { changed: false, reason: "dual-squad-locked", npcIds: [], deployableIds: [], skipped: [] };
    const requested = Array.isArray(npcIds) ? npcIds : [npcIds];
    // 拆分 NPC vs deployable（用 MTU_DEPLOYABLE_PREFIX 前缀识别）。null/空跳过。
    const npcReq = [];
    const depReq = [];
    for (const id of requested) {
      if (id == null) continue;
      if (typeof id === "string" && id.indexOf(MTU_DEPLOYABLE_PREFIX) === 0) {
        const rest = id.substring(MTU_DEPLOYABLE_PREFIX.length);
        if (rest && depReq.indexOf(rest) < 0) depReq.push(rest);
      } else if (typeof id === "string" || typeof id === "number") {
        if (npcReq.indexOf(id) < 0) npcReq.push(id);
      }
    }
    // deployable 集合：以本次 depReq 为权威（去重 + 硬上限 MTU_MAX_DEPLOYED 截断）。
    // 防御纵深：未拥有的部署物（不在 deployableStorage 且未处于已部署）一律拒绝，杜绝"未制造即部署"漏洞。
    const ownedDep = [];
    const skippedDep = [];
    for (const did of depReq) {
      const isOwned = (squad.deployableStorage || []).indexOf(did) >= 0
        || (Array.isArray(squad.deployables) && squad.deployables.some(d => d && d.deployableId === did));
      if (isOwned) { if (ownedDep.indexOf(did) < 0) ownedDep.push(did); }
      else skippedDep.push({ kind: "deployable", deployableId: did, reason: "not-owned" });
    }
    const depHardCap = Math.min(MTU_MAX_DEPLOYED, capacity);
    const cappedDep = ownedDep.slice(0, depHardCap);
    // 已拥有但超出硬上限（容量满）的部署物也进 skipped（与旧 deploy-full 语义一致）。
    ownedDep.slice(depHardCap).forEach(did => skippedDep.push({ kind: "deployable", deployableId: did, reason: "deploy-full" }));
    // NPC 入选：剩余容量 = capacity - cappedDep.length（deployable 已占的）
    const accepted = [];
    const skipped = [];
    const seen = new Set();
    for (const id of npcReq) {
      if (seen.has(id)) continue; // 防重复
      if (accepted.length + cappedDep.length >= capacity) {
        skipped.push({ kind: "npc", npcId: id, reason: "squad-full" });
        continue;
      }
      const verdict = canLegionNpcJoinCombat(state, id, opts);
      if (!verdict.ok) { skipped.push({ kind: "npc", npcId: id, reason: verdict.reason }); continue; }
      seen.add(id);
      accepted.push(id);
    }
    // 写入 pendingNpcIds
    squad.pendingNpcIds = accepted;
    // 同步 deployables：以本次 cappedDep 为权威——旧 deployable id 没在 cappedDep 就被淘汰。
    // 2026-09-03 修复（玩家反馈「MTU 卸下来之后就没了」）：此前只整体覆盖 deployables，
    // 被淘汰的旧 id 直接丢弃、不回库存，玩家在下拉里取消勾选 MTU 就彻底没了。
    // 现在与 deployDeployable / undeployDeployable 口径归一，保证同一台部署物永远只存在一处：
    //   ① 淘汰项召回 deployableStorage（去重，已在库存的不重复 push）；
    //   ② 入选项从 deployableStorage 移除（此前下拉选入不动库存，导致同一台同时存在于
    //      "已部署"与"库存"两处，玩家可在船坞拆解"库存那台"白拿退款而生效那台仍在）。
    // ② 无条件执行，兼治历史脏数据（旧存档可能出现 deployed 与 storage 各一份）。
    const curIds = (Array.isArray(squad.deployables) ? squad.deployables : []).map(d => d.deployableId);
    const curSame = curIds.length === cappedDep.length && curIds.every((v, i) => v === cappedDep[i]);
    if (!Array.isArray(squad.deployableStorage)) squad.deployableStorage = [];
    for (const did of cappedDep) {
      const si = squad.deployableStorage.indexOf(did);
      if (si >= 0) squad.deployableStorage.splice(si, 1);
    }
    for (const pid of curIds) {
      if (cappedDep.indexOf(pid) < 0 && squad.deployableStorage.indexOf(pid) < 0) {
        squad.deployableStorage.push(pid);
      }
    }
    if (!curSame) {
      squad.deployables = cappedDep.map(id => {
        const def = (typeof getDeployableDefinition === "function") ? getDeployableDefinition(id) : null;
        return { deployableId: id, name: def ? def.name : id };
      });
    }
    markDirty(state);
    return { changed: true, npcIds: accepted.slice(), deployableIds: cappedDep.slice(), skipped: skipped.concat(skippedDep) };
  }

  function clearLegionSquadSelection(state) {
    const squad = ensureCombatSquadState(state);
    if (!squad) return { changed: false, reason: "no-state" };
    if (squad.enabled) return { changed: false, reason: "squad-locked" };
    squad.pendingNpcIds = [];
    markDirty(state);
    return { changed: true };
  }

  // 开战入口：把战前选择固化为本场小队成员（由 actions.js combat/start、enterDeathspace
  // 与死亡空间连刷调用；无选择时保持玩家单舰，零副作用）。
  function startLegionSquadBattleWithMembers(state, opts) {
    opts = opts || {};
    const squad = ensureCombatSquadState(state);
    if (!squad) return { changed: false, reason: "no-state", squadEnabled: false };
    if (squad.enabled) return { changed: false, reason: "squad-active", squadEnabled: true };
    const selection = getLegionSquadSelection(state);
    if (selection.length === 0) return { changed: false, reason: "no-selection", squadEnabled: false, members: 0, skipped: [] };
    const skipped = [];
    let added = 0;
    for (const npcId of selection) {
      const verdict = canLegionNpcJoinCombat(state, npcId, opts);
      if (!verdict.ok) { skipped.push({ npcId: npcId, reason: verdict.reason }); continue; }
      if (added === 0) beginLegionSquadBattle(state, opts);
      const res = addLegionNpcToCombatSquad(state, npcId, opts);
      if (res.changed) added++;
      else skipped.push({ npcId: npcId, reason: res.reason });
    }
    return { changed: added > 0, squadEnabled: added > 0, members: added, skipped: skipped };
  }

  // UI 只读快照：协议 / 容量 / 选择 / 候选明细（等级、倍率、舰船、武器、弹药燃料、
  // 三层 HP、修复倒计时、欠薪与状态文案）
  function getLegionCombatSquadUiState(state, opts) {
    const now = resolveNow(opts);
    const squad = ensureCombatSquadState(state);
    const dual = isLegionDualSquadUnlocked(state);
    const capacity = getLegionSquadCapacity(state);
    const active = Boolean(squad && squad.enabled);
    const out = {
      dualUnlocked: dual,
      tripleUnlocked: isLegionTripleSquadUnlocked(state),
      capacity: capacity,
      active: active,
      squadEnabled: active,
      lockedReason: dual ? null : "dual-squad-locked",
      // UI 用的合并选择：先 NPC（pendingNpcIds）+ deployable（已虚拟装备的 MTU）。deployable 用 "deployable:<id>" 前缀。
      // 未解锁协议时 capacity<=0，selection 与 deployables 必须为空（由 ensureCombatSquadState 召回 storage）。
      selection: capacity > 0 ? (function(){
        const npcSel = getLegionSquadSelection(state);
        const depSel = squad && Array.isArray(squad.deployables)
          ? squad.deployables.map(d => MTU_DEPLOYABLE_PREFIX + d.deployableId).filter(Boolean)
          : [];
        return npcSel.concat(depSel);
      })() : [],
      deployables: (capacity > 0 && squad) ? squad.deployables.map(d => ({ deployableId: d.deployableId, name: d.name })) : [],
      deployableStorage: squad ? squad.deployableStorage.slice() : [],
      deployedCount: (capacity > 0 && squad) ? squad.deployables.length : 0,
      maxDeploy: MTU_MAX_DEPLOYED,
      currentTargetId: squad && squad.targetId != null ? squad.targetId : null,
      lastRound: squad && squad.lastRound ? {
        attacked: Number(squad.lastRound.attacked) || 0,
        totalDamage: Number(squad.lastRound.totalDamage) || 0,
        targetId: squad.lastRound.targetId != null ? squad.lastRound.targetId : null,
        now: Number(squad.lastRound.now) || null,
        perNpc: Array.isArray(squad.lastRound.perNpc) ? squad.lastRound.perNpc.map(function (entry) {
          return { npcId: entry && entry.npcId != null ? entry.npcId : null,
            targetId: entry && entry.targetId != null ? entry.targetId : null,
            damage: Number(entry && entry.damage) || 0,
            skipped: entry && entry.skipped ? String(entry.skipped) : null };
        }) : []
      } : null,
      candidates: []
    };
    if (!state || !state.legion || !Array.isArray(state.legion.npcs)) return out;
    const zoneFn = getGlobalFn("getCombatEncounterZone");
    const zone = (zoneFn && state.combat) ? zoneFn(state.combat) : null;
    const countFn = getGlobalFn("getSelectedCount");
    const fuelFn = getGlobalFn("computeVolleyFuel");
    const registry = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry
      : (typeof globalThis !== "undefined" ? globalThis.ResourceRegistry : null);
    const db = getEquipmentDb();
    for (const npc of state.legion.npcs) {
      if (!npc) continue;
      ensureLegionNpcCombatFields(npc);
      const skill = NPC ? NPC.getSkillById(npc.skillId) : null;
      const isCombatSkill = Boolean(skill && skill.category === "combat");
      const verdict = canLegionNpcJoinCombat(state, npc.npcId, { now: now });
      const stats = (isCombatSkill && npc.boundShipInstanceId)
        ? getLegionNpcCombatStats(state, npc.npcId, { zone: zone }) : null;
      const shipCfg = npc.boundShipInstanceId ? getShipConfigFor(state, npc.boundShipInstanceId) : null;
      const weaponNames = [];
      const weaponTypes = [];
      if (stats && stats.ok) {
        for (const w of stats.weapons) {
          weaponTypes.push(w.weaponType);
          const def = db ? db[w.ref] : null;
          weaponNames.push(def ? def.name : (w.weaponType || "武器"));
        }
      }
      const ammo = {};
      for (const type of weaponTypes) ammo[type] = countFn ? countFn(state, type) : 0;
      let fuelRounds = 0;
      if (stats && stats.ok && fuelFn && registry) {
        const volley = fuelFn(state, zone, { shipInstanceId: npc.boundShipInstanceId, excludeImplants: true });
        const have = registry.get(state, "consumable:fuel");
        fuelRounds = volley > 0 ? Math.floor(have / volley) : 0;
      }
      const repair = getLegionNpcRepairState(state, npc.npcId, now);
      const member = squad ? (squad.members || []).filter(m => m && m.npcId === npc.npcId)[0] : null;
      const inSquad = Boolean(member);
      const overdue = npc.salaryState !== "paid";
      let statusText = "可参战";
      if (!isCombatSkill) statusText = "非战斗技能，不能加入战斗小队";
      else if (verdict.ok) statusText = "可参战";
      else if (repair.repairing) statusText = "在岗，但暂时无法参战（修复剩余 " + Math.ceil(repair.remaining / 1000) + "s）";
      else if (inSquad && member && member.destroyedInBattle) statusText = "修复完成：本场已退出，下一场可参战"; // D4：不自动归队当前战斗
      else if (inSquad && overdue) statusText = "欠薪：当前战斗保留，战斗结束后不可再次参战";
      else if (verdict.reason) statusText = (JOIN_REASONS[verdict.reason] || verdict.reason) + (overdue ? "（欠薪）" : "");
      // 非战斗状态下 combatHp 的三层值为 null；UI 应显示绑定舰船的满血，
      // 不能把 null 经过 Number(null) 渲染成 0。战斗中的 0 则必须保留。
      const displayHp = (stats && stats.ok && stats.maxHp) ? {
        shield: npc.combatHp && npc.combatHp.shield != null ? npc.combatHp.shield : stats.maxHp.shield,
        armor: npc.combatHp && npc.combatHp.armor != null ? npc.combatHp.armor : stats.maxHp.armor,
        structure: npc.combatHp && npc.combatHp.structure != null ? npc.combatHp.structure : stats.maxHp.structure
      } : null;
      out.candidates.push({
        npcId: npc.npcId,
        name: npc.name,
        level: npc.level,
        skillId: npc.skillId,
        skillName: skill ? skill.name : npc.skillId,
        isCombatSkill: isCombatSkill,
        damageMultiplier: getLegionNpcDamageMultiplier(npc),
        attackPower: (stats && stats.ok) ? (Number(stats.attackPower) || 0) : 0,
        salaryState: npc.salaryState,
        shipInstanceId: npc.boundShipInstanceId,
        shipName: shipCfg ? (shipCfg.name || npc.shipId) : null,
        weaponNames: weaponNames,
        weaponTypes: weaponTypes,
        ammo: ammo,
        fuelRounds: fuelRounds,
        hp: displayHp,
        maxHp: (stats && stats.ok) ? stats.maxHp : null,
        repair: { repairing: repair.repairing, remaining: repair.remaining, until: repair.until },
        eligible: Boolean(verdict.ok),
        reason: verdict.ok ? null : verdict.reason,
        inSquad: inSquad,
        destroyedInBattle: Boolean(member && member.destroyedInBattle),
        statusText: statusText
      });
    }
    return out;
  }

  // —— 小队弹药需求聚合（只读）：供离线虚拟弹药池播种（玩家武器类型 ∪ NPC 武器类型）——
  // 不播种会导致玩家激光 / NPC 导弹组合时 NPC 恒判 0 弹药而静默停火。
  function getSquadAmmoRequirements(state, opts) {
    opts = opts || {};
    const out = {};
    const squad = ensureCombatSquadState(state);
    if (!squad || !squad.enabled) return out;
    const now = resolveNow(opts);
    for (const member of (squad.members || [])) {
      if (!member || member.npcId == null || member.active !== true || member.destroyedInBattle) continue;
      const npc = findNpc(state, member.npcId);
      if (!npc || npc.destroyed) continue;
      const until = Number(npc.repairUntil);
      if (Number.isFinite(until) && until > now) continue;
      const stats = getLegionNpcCombatStats(state, npc.npcId, { zone: opts.zone });
      if (!stats.ok) continue;
      for (const w of stats.weapons) {
        out[w.weaponType] = (out[w.weaponType] || 0) + (w.ammoCost || 1);
      }
      // 泰坦内置主武器：类型在 config.weapon（不在 fitted 槽），stats.weapons 恒为空，
      // 必须按武器模块定义的 weaponType 单独播种，否则离线虚拟池缺该类型 → 泰坦恒判 0 弹药静默停火。
      // 与 combat.js:1424 玩家侧同口径：玩家泰坦也是 getSelectedCount(state, titanWeapon.weaponType)。
      // 用 npc.boundShipInstanceId（与 fireSingleNpcMember 同源），保证「播种类型」=「开火类型」。
      const lo = resolveNpcTitanLoadout(state, { shipInstanceId: npc.boundShipInstanceId, excludeImplants: true });
      if (lo && lo.weapon && (lo.weapon.ammoCost || 0) > 0) {
        const t = lo.weapon.weaponType;
        out[t] = (out[t] || 0) + (lo.weapon.ammoCost || 0);
      }
    }
    return out;
  }

  // —— C3 泰坦 NPC 输出（2026-09-10 用户拍板：与玩家口径完全一致）——
  // 背景：泰坦的主武器/核心是 buildTitanConfig 按 titanCombo 出厂焊死的组件（config.weapon / config.core），
  // 不占装配槽，故 getInstalledCombatWeapons 恒返回空 → NPC 绑定泰坦 0 输出。
  // 做法：合成一个「虚拟武器模块」并入清单，让下面 1200+ 行的通用管线（燃料/弹药/克制/等级/
  // 光环/易伤/玩家经验）原样覆盖它；L2 附加打击与 L3 末日核心额外接在通用循环之后。
  //
  // ⚠️ 触发条件固定为 isTitanCombatShip(config)，**绝不可写成 modules.length === 0**：
  // 研究科技树「末日武器小型化」抬高 highUsable 后泰坦即可装普通武器，届时虚拟模块必须与
  // 实装武器并存（push 而非替换），否则泰坦主武器会在装了普通武器后凭空消失。
  const TITAN_NPC_DAMAGE_SCALE = 1.0; // NPC 侧泰坦输出折扣（1.0 = 与玩家口径完全一致；调平衡改这里）
  const TITAN_NPC_WEAPON_XP = 10;     // 泰坦武器战斗技能经验（用户拍板：普通武器为 2，泰坦为 10）

  function resolveNpcTitanLoadout(state, shipOpts) {
    const isTitanFn = getGlobalFn("isTitanCombatShip");
    const shipStateFn = getGlobalFn("getActiveCombatShipState");
    if (!isTitanFn || !shipStateFn) return null;
    const active = shipStateFn(state, shipOpts) || null;
    const config = active ? active.config : null;
    if (!isTitanFn(config) || !config.weapon) return null;
    const traitFn = getGlobalFn("getTitanCombatTrait");
    return { config: config, weapon: config.weapon, core: config.core || null, trait: traitFn ? traitFn(config) : null };
  }

  function makeTitanVirtualWeaponModule(weapon) {
    return {
      id: "__titan_virtual__",
      itemId: weapon.id,
      slot: "high",
      multiplier: 1,
      equipment: {
        id: weapon.id,
        name: weapon.name,
        combat: {
          kind: "weapon",
          weaponType: weapon.weaponType,
          baseDamage: weapon.baseDamage,
          baseHit: weapon.baseHit,
          ammoCost: weapon.ammoCost,
          fuelCost: weapon.fuelCost
        }
      }
    };
  }

  // 泰坦主武器齐射燃料（与 combat.js:1356-1362 玩家侧同口径）：fuelCost × 燃料系数。
  // 通用 computeVolleyFuel 只累加装配槽模块的 fuelCost，泰坦槽为空 → 恒 0，必须在此补齐。
  function computeTitanVolleyFuel(state, zone, shipOpts, weapon, core) {
    const fuelMultFn = getGlobalFn("calcFuelMult");
    const fm = fuelMultFn ? fuelMultFn(zone, state) : 1;
    let total = 0;
    const base = weapon ? (Number(weapon.fuelCost) || 0) : 0;
    if (base > 0) total += Math.max(1, Math.round(base * fm));
    if (core && core.consumption && core.consumption.mode === "sustain") {
      const sustainBase = Math.round(base * (Number(core.consumption.fuelPctOfVolley) || 0));
      if (sustainBase > 0) total += Math.max(1, Math.round(sustainBase * fm));
    }
    return total;
  }

  // —— 单个 NPC 成员对指定目标开火（M6 复用单元）——
  // 抽取自原 processLegionNpcAttack 的单体开火体：燃料/弹药校验、伤害结算、累加到 perNpc。
  // 不复制公式；欠薪/修复/爆船跳过规则全部原样保留。调用方负责提供存活目标（enemy）并维护
  // 「共享目标指针」；本函数假定 enemy 存活，防御性 no-target 仅作兜底。
  function fireSingleNpcMember(state, context, member, enemy, perNpcArr, rng) {
    context = context || {};
    const ctx = context;
    const c = state && state.combat;
    const squad = ensureCombatSquadState(state);
    if (!c || !squad || !squad.enabled || !member || member.npcId == null) {
      if (perNpcArr) perNpcArr.push({ npcId: member && member.npcId != null ? member.npcId : null, skipped: "squad-disabled" });
      return null;
    }
    const now = resolveNow(context);
    if (member.active !== true || member.destroyedInBattle) { if (perNpcArr) perNpcArr.push({ npcId: member.npcId, skipped: "inactive" }); return null; }
    const npc = findNpc(state, member.npcId);
    if (!npc) { if (perNpcArr) perNpcArr.push({ npcId: member.npcId, skipped: "npc-missing" }); return null; }
    ensureLegionNpcCombatFields(npc);
    if (npc.destroyed) { if (perNpcArr) perNpcArr.push({ npcId: member.npcId, skipped: "destroyed" }); return null; }
    const until = Number(npc.repairUntil);
    if (Number.isFinite(until) && until > now) { if (perNpcArr) perNpcArr.push({ npcId: member.npcId, skipped: "repairing" }); return null; }
    // 防御性：调用方必须传入存活目标；若已阵亡则跳过（在线循环不会触发，离线路径亦无此情形）
    if (!enemy || enemy.defeated || (enemy.hp && enemy.hp.structure <= 0)) {
      if (perNpcArr) perNpcArr.push({ npcId: member.npcId, skipped: "no-target" });
      return null;
    }
    const calcDamage = getGlobalFn("calcCombatDamage");
    const applyLayers = getGlobalFn("applyLayeredCombatDamage");
    const weaponsFn = getGlobalFn("getInstalledCombatWeapons");
    const fuelFn = getGlobalFn("computeVolleyFuel");
    const counterFn = getGlobalFn("calcWeaponCounterMultiplier");
    const ammoConsume = getGlobalFn("consumeAmmoForType");
    const ammoCount = getGlobalFn("getSelectedCount");
    const ammoProps = getGlobalFn("getAmmoTierProps");
    const registry = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry
      : (typeof globalThis !== "undefined" ? globalThis.ResourceRegistry : null);
    const resourceReady = (ctx && ctx.virtual) ? true : Boolean(registry);
    if (!calcDamage || !applyLayers || !weaponsFn || !fuelFn || !counterFn || !ammoConsume || !ammoCount || !ammoProps || !resourceReady) {
      if (perNpcArr) perNpcArr.push({ npcId: member.npcId, skipped: "combat-api-unavailable" });
      return null;
    }
    const zone = context.zone || (getGlobalFn("getCombatEncounterZone") ? getGlobalFn("getCombatEncounterZone")(c) : null);
    const moduleCache = offlineModuleCache(ctx);
    const stats = getLegionNpcCombatStats(state, npc.npcId, { zone: zone, _offlineModuleCache: moduleCache });
    if (!stats.ok) { if (perNpcArr) perNpcArr.push({ npcId: member.npcId, skipped: "stats-unavailable" }); return null; }
    // 统御矩阵光环：伤害 ×(1+squadDamageBonus)、命中 +squadHitBonus（仅光环核心非 null）
    const titanAura = getTitanSquadAura(state);
    const auraDmgMult = (titanAura && titanAura.squadDamageBonus) ? (1 + Number(titanAura.squadDamageBonus)) : 1;
    const auraHitBonus = (titanAura && titanAura.squadHitBonus) ? Number(titanAura.squadHitBonus) : 0;
    const shipOpts = { shipInstanceId: npc.boundShipInstanceId, excludeImplants: true };
    if (moduleCache) shipOpts._offlineModuleCache = moduleCache;
    const modules = (weaponsFn(state, shipOpts) || []).filter(m => m && m.equipment && m.equipment.combat);
    // C3：泰坦主武器以虚拟模块并入清单（push 而非替换——末日武器小型化后须与实装武器并存）
    const npcTitan = resolveNpcTitanLoadout(state, shipOpts);
    const titanVirtualModule = npcTitan ? makeTitanVirtualWeaponModule(npcTitan.weapon) : null;
    if (titanVirtualModule) modules.push(titanVirtualModule);
    if (modules.length === 0) { if (perNpcArr) perNpcArr.push({ npcId: member.npcId, skipped: "no-weapon" }); return null; }

    const ammoRequired = {};
    for (const m of modules) {
      const combat = m.equipment.combat;
      ammoRequired[combat.weaponType] = (ammoRequired[combat.weaponType] || 0) + (combat.ammoCost || 1);
    }
    let volleyFuel = fuelFn(state, zone, shipOpts);
    if (npcTitan) volleyFuel += computeTitanVolleyFuel(state, zone, shipOpts, npcTitan.weapon, npcTitan.core);
    if (!fuelAvailable(ctx, state, volleyFuel)) { if (perNpcArr) perNpcArr.push({ npcId: member.npcId, skipped: "no-fuel" }); return null; }
    const ammoOk = Object.keys(ammoRequired).every(type => ammoAvailable(ctx, state, type, ammoRequired[type]));
    if (!ammoOk) { if (perNpcArr) perNpcArr.push({ npcId: member.npcId, skipped: "no-ammo" }); return null; }

    spendFuel(ctx, state, volleyFuel); // 每个真实燃料周期只扣一次（虚拟/真实同一入口）
    const ammoByType = {};
    for (const type of Object.keys(ammoRequired)) {
      const tier = ammoTierFor(ctx, state, type); // D2：已装载栈最高档
      spendAmmo(ctx, state, type, ammoRequired[type]); // 每次真实开火只扣一次
      ammoByType[type] = ammoProps(tier);
    }

    const useRng = (typeof rng === "function") ? rng : resolveBattleRng(context, state);
    // 裂界侵蚀易伤（2026-09-10 用户拍板 3b）：设计文案「受击敌受到小队伤害 +12%」——
    // NPC 绑定舰伤害与泰坦主武器同享易伤乘区；无易伤标记时恒为 1，零回归。
    // 回合号由调用方经 context.round 传入（在线=c.roundSeq，离线=波内轮号，与各自易伤标记口径一致）。
    const vulnFn = getGlobalFn("getTitanDamageTakenMultiplier");
    const vulnMult = vulnFn ? vulnFn(enemy, Number(ctx.round) || 1) : 1;
    // C3 泰坦专属乘区（与 combat.js:1423-1433 玩家侧同口径）；非泰坦时整块不执行，零回归。
    const titanRound = Number(ctx.round) || 1;
    let titanExtraMult = 1;
    let titanMainDamage = null;
    let titanBoosterMult = 1; // L2 附加打击同享（与玩家侧同口径）
    let titanAdbm = 1;
    let titanTargetHpRatio = 1; // L2 getTitanExtraAttacks 同输入（与 L1 主命中同口径）
    let titanCritFn = null;     // L2 扫掠暴击复用同一 rollTitanCritMultiplier
    // 全补（2026-09-10 用户拍板）：泰坦三层同吃 getCombatDamageMultiplierFromState。
    // L1 主命中已由下方普通武器管线的 dmgMult 自动吃到，故此处**只供 L2/L3 使用**，
    // 绝不可并入 titanExtraMult（否则 L1 会被乘两次）。
    let titanDmgMult = 1;
    if (titanVirtualModule) {
      const rdFn = getGlobalFn("getTitanWeaponRoundDamage");
      const targetTotal = (enemy.hp.shield || 0) + (enemy.hp.armor || 0) + (enemy.hp.structure || 0);
      const targetMaxHp = enemy.maxHp ? ((enemy.maxHp.shield || 0) + (enemy.maxHp.armor || 0) + (enemy.maxHp.structure || 0)) : targetTotal;
      titanTargetHpRatio = targetMaxHp > 0 ? targetTotal / targetMaxHp : 1;
      const rd = rdFn ? rdFn(npcTitan.weapon, { round: titanRound, targetHpRatio: titanTargetHpRatio }) : null;
      if (rd) titanMainDamage = rd.mainDamage;
      // 结构过载（B 案）：按 NPC 当前 HP 比例；combatHp/maxHp 缺失时退化为 1（不施加）
      const odFn = getGlobalFn("getTitanStructureOverdriveMultiplier");
      if (odFn && npcTitan.trait && npc.combatHp && stats.maxHp) {
        titanExtraMult *= odFn(npcTitan.trait, npc.combatHp, stats.maxHp);
      }
      // 武器强化剂：按主武器 weaponType 查表（玩家出资，与玩家管线同口径）
      const boosterFn = getGlobalFn("getBoosterEffectState");
      const boosterState = boosterFn ? boosterFn(state).weaponDamageMultiplier : null;
      if (boosterState && boosterState[npcTitan.weapon.weaponType]) titanBoosterMult = boosterState[npcTitan.weapon.weaponType];
      titanExtraMult *= titanBoosterMult;
      // 脑突触加速剂（独立乘区）
      const adbmFn = getGlobalFn("getAdBuffMultiplier");
      titanAdbm = adbmFn ? adbmFn(state) : 1;
      if (titanAdbm && titanAdbm !== 1) titanExtraMult *= titanAdbm;
      // 泰坦暴击（主命中）
      titanCritFn = getGlobalFn("rollTitanCritMultiplier");
      if (titanCritFn) titanExtraMult *= titanCritFn(npcTitan.weapon.crit, useRng);
      // 全补（2026-09-10 用户拍板）：取与 L1 同一个 dmgMult 值供 L2/L3 使用（不并入 titanExtraMult）
      const dmgSelTitan = getCombatSelector("getCombatDamageMultiplierFromState");
      titanDmgMult = dmgSelTitan ? dmgSelTitan(state, npcTitan.weapon.weaponType, undefined, shipOpts) : 1;
      if (TITAN_NPC_DAMAGE_SCALE !== 1) titanExtraMult *= TITAN_NPC_DAMAGE_SCALE;
    }
    // 武器强化剂（攻击药）乘区：与玩家侧 combat.js 同口径（weaponDamageMultiplier[weaponType]）。
    // 2026-09-12 修复：常规武器管线此前漏接此乘区（维修药有、攻击药无，玩家报「NPC 不吃攻击药」）。
    // 泰坦虚拟模块已在 titanExtraMult 内含 titanBoosterMult，循环内必须排除它，避免重复乘算。
    const npcWeaponBoosterMap = (function () {
      const fn = getGlobalFn("getBoosterEffectState");
      const st = fn ? fn(state) : null;
      return (st && st.weaponDamageMultiplier) ? st.weaponDamageMultiplier : null;
    })();
    // 溅射（AOE）：2026-09-12 修复 —— NPC 常规武器此前完全不结算溅射（只有泰坦 L2 有），
    // 导致带 aoe 的 NPC 武器（旗舰激光 30% / 导弹阵列 12% / 加农 15%）比同款玩家武器弱一大截。
    // 口径与玩家侧 combat.js fireConventionalVolley 完全一致：主目标原始伤害 × aoe.multiplier。
    // 泰坦虚拟模块走自身 L2（扫掠/贯穿），必须排除，否则重复结算。
    const aoeFn = getGlobalFn("getCapitalAreaDamageTargets");
    const aoeEnemyList = (ctx && Array.isArray(ctx.enemies) && ctx.enemies.length) ? ctx.enemies : null;
    let damage = 0;
    let titanMainDealt = null; // 供 L2 贯穿（layerPierce）定位起始层
    for (const m of modules) {
      const combat = m.equipment.combat;
      const ammo = ammoByType[combat.weaponType] || ammoProps("T1");
      const hitSel = getCombatSelector("getCombatWeaponHitFromState");
      const dmgSel = getCombatSelector("getCombatDamageMultiplierFromState");
      const hit = ((hitSel ? hitSel(state, combat.weaponType, combat, undefined, shipOpts) : 100) + auraHitBonus) * ammo.hitMult;
      const dmgMult = dmgSel ? dmgSel(state, combat.weaponType, undefined, shipOpts) : 1;
      const counterMult = counterFn(combat.weaponType, enemy.hp);
      const isTitanVirtual = (m === titanVirtualModule);
      const baseDmg = (isTitanVirtual && titanMainDamage != null ? titanMainDamage : combat.baseDamage) * (m.multiplier || 1);
      const titanMult = isTitanVirtual ? titanExtraMult : 1;
      const boosterMult = (isTitanVirtual || !npcWeaponBoosterMap) ? 1 : (npcWeaponBoosterMap[combat.weaponType] || 1);
      const rawDamage = calcDamage(
        hit, enemy.dodge,
        baseDmg,
        counterMult * dmgMult * boosterMult * stats.levelDamageMultiplier * ammo.dmgMult * auraDmgMult * vulnMult * titanMult,
        useRng
      );
      const dealt = applyLayers(enemy.hp, rawDamage);
      if (isTitanVirtual) titanMainDealt = dealt;
      damage += (dealt.shield || 0) + (dealt.armor || 0) + (dealt.structure || 0);
      // 溅射：主目标之外的邻近/全体目标按同一发原始伤害 × 倍率吃伤（与玩家侧同式，含击毁判定）。
      if (!isTitanVirtual && combat.aoe && aoeFn && aoeEnemyList) {
        for (const areaTarget of aoeFn(aoeEnemyList, enemy, combat.aoe)) {
          if (!areaTarget || !areaTarget.enemy || !areaTarget.enemy.hp) continue;
          const areaDamage = Math.max(1, Math.round(rawDamage * areaTarget.multiplier));
          const areaDealt = applyLayers(areaTarget.enemy.hp, areaDamage);
          damage += (areaDealt.shield || 0) + (areaDealt.armor || 0) + (areaDealt.structure || 0);
        }
      }
    }
    // —— C3 L2：泰坦附加打击（扫掠 / 贯穿 / 暴击 / 破片回响）——
    // 与 combat.js:1443-1457 玩家侧逐项同口径：strike.damage × 易伤 × 武器强化剂 × 扫掠暴击 × 脑突触。
    // 注意：玩家侧 L2 **不吃**克制/结构过载/光环/弹药档/等级系数（只吃上面这四项），此处同样不吃，保持一致。
    // 敌人数组由调用方经 context.enemies 传入（在线 c.enemies / 离线波内 enemies）；缺失时退化为单目标
    // （living 为空 ⇒ 仅 layerPierce 与打主目标的 extra 生效），不会崩，也不会产生双路径差异。
    if (titanVirtualModule) {
      // 敌人数组：L2 附加打击与 L3 末日核心共用（在线 c.enemies / 离线波内 enemies）
      const enemyList = (ctx && Array.isArray(ctx.enemies) && ctx.enemies.length) ? ctx.enemies : [enemy];
      const extraFn = getGlobalFn("getTitanExtraAttacks");
      const strikeFn = getGlobalFn("resolveTitanWeaponStrikes");
      const pierceFn = getGlobalFn("applyTitanLayerPierceDamage");
      const extraRaw = extraFn ? extraFn(npcTitan.weapon, { round: titanRound, targetHpRatio: titanTargetHpRatio }) : null;
      const strikes = strikeFn ? strikeFn(extraRaw, npcTitan.weapon, enemyList, enemy, useRng) : [];
      for (const strike of strikes) {
        const sweepCrit = (strike.kind === "sweep" && npcTitan.weapon.crit && npcTitan.weapon.crit.appliesToSweep && titanCritFn)
          ? titanCritFn(npcTitan.weapon.crit, useRng) : 1;
        let strikeDmg = (Number(strike.damage) || 0) * vulnMult * titanBoosterMult * sweepCrit * titanDmgMult;
        if (titanAdbm && titanAdbm !== 1) strikeDmg *= titanAdbm;
        if (TITAN_NPC_DAMAGE_SCALE !== 1) strikeDmg *= TITAN_NPC_DAMAGE_SCALE;
        strikeDmg = Math.max(1, Math.round(strikeDmg));
        let dealt = null;
        if (strike.kind === "layerPierce") {
          // 透层：主命中最深触及哪一层，从下一层起吸收；命中结构层则不触发（与玩家侧 applyTitanLayerPierceDamage 同原语）
          if (pierceFn && titanMainDealt) dealt = pierceFn(enemy.hp, titanMainDealt, strikeDmg);
        } else if (strike.enemy && strike.enemy.hp) {
          dealt = applyLayers(strike.enemy.hp, strikeDmg);
        }
        if (dealt) damage += (dealt.shield || 0) + (dealt.armor || 0) + (dealt.structure || 0);
      }

      // —— C3 L3：泰坦末日核心打击（每 everyRounds 轮一次；断供跳过本次触发，不阻塞主武器）——
      // 与 combat.js:1604-1638 玩家侧同口径：伤害 = strike.damage × 易伤 × 脑突触（**不吃**强化剂/暴击/光环/克制/
      // 弹药档/等级系数）；眩晕与易伤标记直接写敌对象（与玩家侧同一字段，随战斗快照进离线追算）。
      // 统御矩阵（kind === "aura"）无打击只给光环，其 sustain 燃料已在 computeTitanVolleyFuel 内随齐射扣除。
      // 经验：末日武器不计武器技能经验（用户拍板）；电容经验由齐射燃料照常结算（见下方经验段）。
      const coreStrikesFn = getGlobalFn("getTitanCoreStrikes");
      const coreResolveFn = getGlobalFn("resolveTitanCoreStrikes");
      const coreRaw = (npcTitan.core && npcTitan.core.kind !== "aura" && coreStrikesFn)
        ? coreStrikesFn(npcTitan.core, npcTitan.weapon, { round: titanRound }) : [];
      if (Array.isArray(coreRaw) && coreRaw.length > 0 && coreResolveFn) {
        const ccost = npcTitan.core.consumption || {};
        const coreFuelMultFn = getGlobalFn("calcFuelMult");
        const coreFm = coreFuelMultFn ? coreFuelMultFn(zone, state) : 1;
        const coreFuel = (Number(ccost.fuelPctOfVolley) > 0)
          ? Math.max(1, Math.round((Number(npcTitan.weapon.fuelCost) || 0) * Number(ccost.fuelPctOfVolley) * coreFm)) : 0;
        const coreAmmo = Number(ccost.ammoPerTrigger) || 0;
        const coreOk = fuelAvailable(ctx, state, coreFuel)
          && (coreAmmo <= 0 || ammoAvailable(ctx, state, npcTitan.weapon.weaponType, coreAmmo));
        if (coreOk) {
          if (coreFuel > 0) spendFuel(ctx, state, coreFuel);
          if (coreAmmo > 0) spendAmmo(ctx, state, npcTitan.weapon.weaponType, coreAmmo);
          // 眩晕递减计数按 NPC 成员持有（多泰坦同队时各自独立）；存于 member 而非 ctx，
          // 因在线侧每次调用都是 Object.assign({}, context, ...) 的新对象，无法跨轮持久。
          if (!member.titanStunCounts || typeof member.titanStunCounts !== "object") member.titanStunCounts = {};
          const resolved = coreResolveFn(coreRaw, npcTitan.core, enemyList, enemy, member.titanStunCounts, titanRound, useRng);
          for (const strike of (resolved.strikes || [])) {
            const sv = vulnFn ? vulnFn(strike.enemy, titanRound) : 1; // 侵蚀本轮命中即生效（与玩家侧同）
            let dmg = (Number(strike.damage) || 0) * sv * titanAdbm * titanDmgMult;
            if (TITAN_NPC_DAMAGE_SCALE !== 1) dmg *= TITAN_NPC_DAMAGE_SCALE;
            dmg = Math.max(1, Math.round(dmg));
            const dealt = (strike.enemy && strike.enemy.hp) ? applyLayers(strike.enemy.hp, dmg) : null;
            if (dealt) damage += (dealt.shield || 0) + (dealt.armor || 0) + (dealt.structure || 0);
            if (strike.stunned && (Number(npcTitan.core.stunRounds) || 0) > 0 && strike.enemy) {
              strike.enemy.titanStunRounds = (Number(strike.enemy.titanStunRounds) || 0) + Number(npcTitan.core.stunRounds);
            }
          }
        }
      }
    }
    const entry = { npcId: member.npcId, damage: damage, fuelSpent: volleyFuel, ammoSpent: ammoRequired, levelDamageMultiplier: stats.levelDamageMultiplier, targetId: enemy.id != null ? enemy.id : null };
    // 玩家出资 NPC 燃料/弹药 → 玩家获得与自身开火同口径的战斗经验（套用玩家经验倍率链）
    const addXp = getGlobalFn("addStationModifiedCombatXp") || (typeof addStationModifiedCombatXp !== "undefined" ? addStationModifiedCombatXp : null);
    if (addXp && state.skills) {
      const WC = (typeof WEAPON_CONFIG !== "undefined") ? WEAPON_CONFIG : null;
      for (const m of modules) {
        const cb = m.equipment.combat;
        const wcfg = WC ? WC[cb.weaponType] : null;
        const sk = wcfg ? wcfg.skillKey : null;
        // 泰坦主武器战斗技能经验 = 10（用户拍板；普通武器为 2）。
        // 末日核心打击（L3）不进本循环 ⇒ 不计武器经验，与用户口径一致。
        const xpPerWeapon = (m === titanVirtualModule) ? TITAN_NPC_WEAPON_XP : 2;
        if (sk && state.skills[sk]) addXp(state, sk, xpPerWeapon, "combat");
        if (state.skills.targeting) addXp(state, "targeting", 1, "combat");
      }
      // 电容经验照算（用户拍板）：与玩家侧同口径 = 齐射燃料 × 0.3（燃料已含泰坦主武器 + 统御矩阵 sustain）
      if (state.skills.capacitorManagement) addXp(state, "capacitorManagement", volleyFuel * 0.3, "combat");
    }
    if (perNpcArr) perNpcArr.push(entry);
    return entry;
  }

  // —— 可参战的开火者次序（M6 在线顺序循环使用）——
  // 仅过滤「本场绝对无法开火」的早期守卫（失活/爆船/修复中/缺 NPC），与 processLegionNpcAttack
  // 顶部一致；弹药/燃料/武器缺失等「中途跳过」交由 fireSingleNpcMember 处理并记入 perNpc。
  function getEligibleSquadFireMembers(state, now) {
    const squad = ensureCombatSquadState(state);
    if (!squad || !squad.enabled || !Array.isArray(squad.members)) return [];
    const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const out = [];
    for (const member of squad.members) {
      if (!member || member.npcId == null) continue;
      if (member.active !== true || member.destroyedInBattle) continue;
      const npc = findNpc(state, member.npcId);
      if (!npc) continue;
      ensureLegionNpcCombatFields(npc);
      if (npc.destroyed) continue;
      const until = Number(npc.repairUntil);
      if (Number.isFinite(until) && until > t) continue;
      out.push(member);
    }
    return out;
  }

  // —— NPC 攻击（步骤 3）：目标恒为玩家当前 combat.currentEnemy（M6 前行为，保持单元语义）——
  // M6 在线分步换目标由 combat.js 的 advanceCombatRound 统一顺序循环负责；本函数仍用于
  // 离线路径（offline-combat.js simulateWave）与单元测试，语义保持不变：全体成员打同一 currentEnemy。
  function processLegionNpcAttack(state, context) {
    context = context || {};
    const ctx = context; // 虚拟资源注入上下文（M4）
    const c = state && state.combat;
    const squad = ensureCombatSquadState(state);
    if (!c || !squad || !squad.enabled) {
      return { ok: true, attacked: 0, totalDamage: 0, perNpc: [], reason: "squad-disabled" };
    }
    const now = resolveNow(context);
    const rng = (context && typeof context.randomFn === "function") ? context.randomFn : resolveBattleRng(context, state);
    const enemy = c.currentEnemy;
    // 目标恒等于玩家当前目标：无目标 / 已击毁 → 本轮不开火（切换目标后下一轮自动同步）
    squad.targetId = enemy && enemy.id != null ? enemy.id : null;
    if (!enemy || enemy.defeated || (enemy.hp && enemy.hp.structure <= 0)) {
      return { ok: true, attacked: 0, totalDamage: 0, perNpc: [], reason: "no-target" };
    }
    const calcDamage = getGlobalFn("calcCombatDamage");
    const applyLayers = getGlobalFn("applyLayeredCombatDamage");
    const weaponsFn = getGlobalFn("getInstalledCombatWeapons");
    const fuelFn = getGlobalFn("computeVolleyFuel");
    const counterFn = getGlobalFn("calcWeaponCounterMultiplier");
    const ammoConsume = getGlobalFn("consumeAmmoForType");
    const ammoCount = getGlobalFn("getSelectedCount");
    const ammoProps = getGlobalFn("getAmmoTierProps");
    // M4：虚拟模式由 ctx.virtual 提供弹药/燃料，不需 ResourceRegistry；仅真实模式才要求它存在
    const registry = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry
      : (typeof globalThis !== "undefined" ? globalThis.ResourceRegistry : null);
    const resourceReady = (ctx && ctx.virtual) ? true : Boolean(registry);
    if (!calcDamage || !applyLayers || !weaponsFn || !fuelFn || !counterFn || !ammoConsume || !ammoCount || !ammoProps || !resourceReady) {
      return { ok: false, attacked: 0, totalDamage: 0, perNpc: [], reason: "combat-api-unavailable" };
    }

    const zone = context.zone || (getGlobalFn("getCombatEncounterZone") ? getGlobalFn("getCombatEncounterZone")(c) : null);
    const perNpc = [];
    let totalDamage = 0;
    let attacked = 0;
    const members = (squad.members || []).slice();
    for (const member of members) {
      // 早期守卫（与 M6 前一致：静默跳过，不入 perNpc）
      if (!member || member.npcId == null) continue;
      if (member.active !== true || member.destroyedInBattle) continue;
      const npc = findNpc(state, member.npcId);
      if (!npc) continue;
      ensureLegionNpcCombatFields(npc);
      if (npc.destroyed) continue;
      const until = Number(npc.repairUntil);
      if (Number.isFinite(until) && until > now) continue;
      // 复用单体开火单元（目标恒为 currentEnemy；M6 在线分步由 combat.js 统一循环负责）
      // enemies（C3 泰坦 NPC 输出）：经 context 传入，未传时退化为单目标语义。
      const entry = fireSingleNpcMember(state, Object.assign({}, context, { enemies: c.enemies }), member, enemy, perNpc, rng);
      if (entry && !entry.skipped) { attacked += 1; totalDamage += entry.damage; }
    }

    c.runSquadDamageDealt = (typeof c.runSquadDamageDealt === "number" ? c.runSquadDamageDealt : 0) + totalDamage;
    squad.lastRound = {
      attacked: attacked,
      totalDamage: totalDamage,
      perNpc: perNpc,
      targetId: enemy && enemy.id != null ? enemy.id : null,
      now: now
    };
    markDirty(state);
    return { ok: true, attacked: attacked, totalDamage: totalDamage, perNpc: perNpc };
  }

  // —— NPC 绑定舰维修件在战斗中生效（与玩家维修对称；M5 修复：此前 NPC 维修装备是死装备）——
  // 每轮为每个存活且未修复中的 NPC 读取其绑定舰上的维修件，回对应护盾/装甲/结构层。
  // 燃料走与 NPC 攻击同一的 M4 虚拟/真实入口（context.virtual 存在 → 扣虚拟池，否则扣真实库存）。
  function repairLegionSquadNpcs(state, context) {
    context = context || {};
    const ctx = context; // M4 虚拟资源上下文（离线传入 virtual 会话池）
    const c = state && state.combat;
    const squad = ensureCombatSquadState(state);
    if (!c || !squad || !squad.enabled) return { repaired: 0, totalHeal: 0, reason: "squad-disabled" };
    const now = resolveNow(context);
    const zone = context.zone || (getGlobalFn("getCombatEncounterZone") ? getGlobalFn("getCombatEncounterZone")(c) : null);
    const modulesFn = getGlobalFn("getInstalledCombatModulesFromState");
    const repairMultFn = getGlobalFn("calcRepairMult");
    const fuelMultFn = getGlobalFn("calcFuelMult");
    if (!modulesFn || !repairMultFn || !fuelMultFn) return { repaired: 0, totalHeal: 0, reason: "combat-api-unavailable" };
    const boosterRep = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(state).repairMultiplier : null;

    let repaired = 0, totalHeal = 0;
    for (const member of (squad.members || []).slice()) {
      if (!member || member.npcId == null) continue;
      if (member.active !== true || member.destroyedInBattle) continue;
      const npc = findNpc(state, member.npcId);
      if (!npc) continue;
      ensureLegionNpcCombatFields(npc);
      if (npc.destroyed) continue;
      const until = Number(npc.repairUntil);
      if (Number.isFinite(until) && until > now) continue; // 修复中：不参与本场（与攻击一致）
      const hp = ensureNpcCombatHp(state, npc, now);
      if (!hp) continue;
      const stats = getLegionNpcCombatStats(state, npc.npcId, { zone: zone, _offlineModuleCache: offlineModuleCache(ctx) });
      if (!stats.ok || !stats.maxHp) continue;
      const maxHp = stats.maxHp;
      // 与战斗页面板明细同源（collectNpcRepairUnits）：同一套模块清单与燃料单价，此处额外扣费。
      const npcReps = collectNpcRepairUnits(state, npc, zone, offlineModuleCache(ctx));
      if (!npcReps.length) continue;
      for (const rep of npcReps) {
        if (hp[rep.target] >= maxHp[rep.target]) continue;
        if (!fuelAvailable(ctx, state, rep.fuel)) continue;
        const repMult = (boosterRep && boosterRep[rep.target]) ? boosterRep[rep.target] : 1;
        // 保持原有维修倍率语义：calcRepairMult 读取当前出战舰；这里只注入离线会话缓存。
        const moduleCache = offlineModuleCache(ctx);
        const repairOpts = moduleCache ? { _offlineModuleCache: moduleCache } : {};
        const healAmount = Math.round(rep.amount * rep.multiplier * repairMultFn(rep.target, state, hp.structure / maxHp.structure, repairOpts) * repMult);
        if (healAmount <= 0) continue;
        const before = hp[rep.target];
        hp[rep.target] = Math.min(maxHp[rep.target], hp[rep.target] + healAmount);
        const gained = hp[rep.target] - before;
        if (gained > 0) {
          totalHeal += gained; repaired += 1; spendFuel(ctx, state, rep.fuel);
          // 玩家出资 NPC 维修燃料 → 玩家获得与自身维修同口径的防御经验
          const addXp = getGlobalFn("addStationModifiedCombatXp") || (typeof addStationModifiedCombatXp !== "undefined" ? addStationModifiedCombatXp : null);
          if (addXp && state.skills && state.skills.defense) addXp(state, "defense", 1, "combat");
        }
      }
    }
    if (repaired > 0) markDirty(state);
    return { repaired: repaired, totalHeal: totalHeal };
  }

  // —— 敌人一次攻击的伤害落点（步骤 4/5）——
  // 两种落点模式，其余（受伤/爆船/修复）完全共用同一原语：
  //   A 在线（context.distribute !== true）：随机选一个目标，伤害全部落在它身上（M3 行为）。
  //   B 离线（context.distribute === true，D1 裁决）：逐攻击包对所有有效目标等概率期望分摊——
  //      ① 取当前存活目标数 N；② 每个目标用**自身**闪避/减伤/资本舰护盾缓解算期望伤害；
  //      ③ 该目标获得 1/N 的期望伤害；④ 分别写入各自 HP；⑤ NPC 爆船后从后续攻击包的目标池移除。
  //      绝不用「统一伤害 ÷ N」：玩家与 NPC 的护盾/装甲/结构与减伤属性不同，必须逐个计算。
  // 玩家出资 NPC 承伤 → 玩家获得与自身挨打同口径的防御经验（套用玩家经验倍率链）
  function grantPlayerDefenseXpFromNpcDamage(state, dealt) {
    if (!dealt || !state || !state.skills) return;
    const addXp = getGlobalFn("addStationModifiedCombatXp") || (typeof addStationModifiedCombatXp !== "undefined" ? addStationModifiedCombatXp : null);
    if (!addXp) return;
    const total = (dealt.shield || 0) + (dealt.armor || 0) + (dealt.structure || 0);
    if (dealt.shield > 0 && state.skills.shieldOperation) addXp(state, "shieldOperation", 1, "combat");
    if (dealt.armor > 0 && state.skills.armorReinforcement) addXp(state, "armorReinforcement", 1, "combat");
    if (dealt.structure > 0 && state.skills.hullEngineering) addXp(state, "hullEngineering", 1, "combat");
    if (total > 0 && state.skills.piloting) addXp(state, "piloting", 1, "combat");
  }

  function processLegionEnemyAttack(state, context) {
    context = context || {};
    const c = state && state.combat;
    const squad = ensureCombatSquadState(state);
    const dmg = Math.max(0, Math.round(Number(context.damage) || 0));
    const applyLayers = getGlobalFn("applyLayeredCombatDamage");
    const empty = { shield: 0, armor: 0, structure: 0 };
    if (!c || !applyLayers) return { kind: "player", npcId: null, dealt: empty, applied: false, reason: "combat-api-unavailable", hits: [] };
    if (!squad || !squad.enabled) {
      // 单舰模式：行为不变（伤害落在玩家舰船）
      return { kind: "player", npcId: null, dealt: applyLayers(c.hp, dmg), applied: true, hits: [{ kind: "player", npcId: null, dealt: applyLayers({ shield: 0, armor: 0, structure: 0 }, 0) }] };
    }

    // ---- 模式 B：离线期望分摊（每个有效目标 1/N，各自防御口径） ----
    if (context.distribute === true) {
      const targets = getLegionCombatTargets(state, { now: context.now });
      const n = targets.length || 1;
      const hits = [];
      let totalDealt = { shield: 0, armor: 0, structure: 0 };
      let destroyedAny = false;
      for (const t of targets) {
        const dealt = resolveTargetDamage(state, t, context, dmg, n);
        if (dealt.kind === "npc") {
          if (dealt.destroyed) destroyedAny = true;
          grantPlayerDefenseXpFromNpcDamage(state, dealt.dealt);
        }
        hits.push({ kind: dealt.kind, npcId: dealt.npcId || null, damage: dealt.damage, dealt: dealt.dealt, destroyed: Boolean(dealt.destroyed) });
        totalDealt = {
          shield: totalDealt.shield + dealt.dealt.shield,
          armor: totalDealt.armor + dealt.dealt.armor,
          structure: totalDealt.structure + dealt.dealt.structure
        };
      }
      return {
        kind: "squad", npcId: null, dealt: totalDealt, applied: true,
        distributed: true, targetCount: n, destroyed: destroyedAny, hits: hits
      };
    }

    // ---- 模式 A：在线逐次随机 ----
    const rng = resolveBattleRng(context, state);
    const target = selectLegionCombatTarget(state, rng);
    if (context.offlineExact === true) {
      if (target.kind !== "npc") {
        const dealt = applyLayers(c.hp, dmg);
        return { kind: "player", npcId: null, dealt: dealt, applied: true, targetCount: target.targetCount,
          hits: [{ kind: "player", npcId: null, damage: dmg, dealt: dealt }] };
      }
      const res = applyLegionNpcDamage(state, target.npcId, dmg, { now: context.now, rng: rng, roundSeq: context.roundSeq });
      grantPlayerDefenseXpFromNpcDamage(state, res.dealt);
      return { kind: "npc", npcId: target.npcId, dealt: res.dealt, applied: res.applied,
        destroyed: Boolean(res.destroyed), targetCount: target.targetCount, reason: res.reason,
        hits: [{ kind: "npc", npcId: target.npcId, damage: dmg, dealt: res.dealt, destroyed: Boolean(res.destroyed) }] };
    }
    // 离线 M6：每个敌人每轮只落到一个实际目标，但伤害仍需按 attacker 现场计算；
    // 不能沿用在线调用方传入的 damage（离线传 0，仅用于触发共用原语）。
    if (context.offlineActual === true) {
      if (!context.attacker || !(Number(context.attacker.baseDamage) > 0)) {
        return { kind: target.kind, npcId: target.npcId || null, dealt: empty, applied: false,
          targetCount: target.targetCount, hits: [] };
      }
      const hit = resolveTargetDamage(state, target, context, 0, 1);
      if (hit.kind === "npc") grantPlayerDefenseXpFromNpcDamage(state, hit.dealt);
      return {
        kind: hit.kind, npcId: hit.npcId || null, dealt: hit.dealt || empty, applied: true,
        targetCount: target.targetCount, destroyed: Boolean(hit.destroyed),
        hits: [{ kind: hit.kind, npcId: hit.npcId || null, damage: hit.damage || 0, dealt: hit.dealt || empty, destroyed: Boolean(hit.destroyed) }]
      };
    }
    if (target.kind !== "npc") {
      return { kind: "player", npcId: null, dealt: applyLayers(c.hp, dmg), applied: true, targetCount: target.targetCount, hits: [{ kind: "player", npcId: null, damage: dmg }] };
    }
    const res = applyLegionNpcDamage(state, target.npcId, dmg, { now: context.now, rng: rng, roundSeq: context.roundSeq });
    grantPlayerDefenseXpFromNpcDamage(state, res.dealt);
    return {
      kind: "npc", npcId: target.npcId, dealt: res.dealt, applied: res.applied,
      destroyed: Boolean(res.destroyed), targetCount: target.targetCount, reason: res.reason,
      hits: [{ kind: "npc", npcId: target.npcId, damage: dmg, dealt: res.dealt, destroyed: Boolean(res.destroyed) }]
    };
  }

  // 单个目标在一次敌人攻击包中的期望伤害（D1 步骤 2-4）
  // 每个目标独立走：自身闪避 → 自身资本舰护盾缓解 → 自身 DCU 减伤 → 层级结算。
  function resolveTargetDamage(state, target, context, baseDamage, n) {
    const empty = { shield: 0, armor: 0, structure: 0 };
    const applyLayers = getGlobalFn("applyLayeredCombatDamage");
    const calcDamage = getGlobalFn("calcCombatDamage");
    const mitigationFn = getGlobalFn("applyCapitalShieldMitigation");
    if (!applyLayers || !calcDamage) return { kind: target.kind, npcId: target.npcId, damage: 0, dealt: empty };
    const c = state.combat;
    const attacker = context.attacker || {};
    const zone = context.zone;
    const share = 1 / (n || 1);
    let raw;
    if (target.kind === "npc") {
      const npc = findNpc(state, target.npcId);
      if (!npc) return { kind: "npc", npcId: target.npcId, damage: 0, dealt: empty };
      const stats = getLegionNpcCombatStats(state, npc.npcId, { zone: zone, _offlineModuleCache: offlineModuleCache(context) });
      if (!stats.ok) return { kind: "npc", npcId: target.npcId, damage: 0, dealt: empty };
      const hp0 = ensureNpcCombatHp(state, npc, context.now) || npc.combatHp;
      const shipCfg = getShipConfigFor(state, npc.boundShipInstanceId);
      const isTitan = Boolean(shipCfg && shipCfg.type === "titan");
      const titanShieldMitFn = getGlobalFn("applyTitanShieldMitigation");
      const titanTraitFn = getGlobalFn("getTitanCombatTrait");
      // NPC 自身闪避（排除脑插的显式实例口径）
      raw = calcDamage(attacker.hit || 0, stats.dodge, attacker.baseDamage || 1, 1.0, context.randomFn || function () { return 0.5; });
      // NPC 自身护盾缓解：泰坦走泰坦偏导（带触发计数供稳态回充），超旗走原路径（D3）
      if (shipCfg) {
        if (isTitan && titanShieldMitFn && titanTraitFn) {
          const tt = titanTraitFn(shipCfg);
          if (tt) {
            const curShield = (hp0 && hp0.shield) || 0;
            if (hp0 && context.roundSeq !== undefined && hp0._titanRoundSeq !== context.roundSeq) {
              hp0._titanRoundSeq = context.roundSeq;
              hp0._titanShieldHitsUsed = 0;
              hp0._titanDeflectTriggers = 0;
              hp0._titanArmorDmg = 0;
              hp0._titanStructDmg = 0;
            }
            const used = (hp0 && Number(hp0._titanShieldHitsUsed)) || 0;
            const mit = titanShieldMitFn(tt, raw, used, curShield);
            raw = Math.max(0, Number(mit.damage) || 0);
            if (hp0) {
              if (curShield > 0) hp0._titanShieldHitsUsed = used + 1;
              if (mit.triggered) hp0._titanDeflectTriggers = (Number(hp0._titanDeflectTriggers) || 0) + 1;
            }
          }
        } else if (mitigationFn) {
          const mit = mitigationFn(shipCfg, raw, 0, (hp0 && hp0.shield) || 0);
          raw = Math.max(0, Number(mit.damage) || 0);
        }
      }
      // NPC 自身损伤控制单元减伤（D3：读 NPC 绑定舰的 DCU 模块，燃料同样走虚拟/真注入）
      const dcRed = computeNpcDcReduction(state, npc, zone, context);
      if (dcRed > 0) raw = Math.max(0, Math.round(raw * (1 - dcRed)));
      const finalDamage = Math.max(0, Math.round(raw * share));
      const res = applyLegionNpcDamage(state, npc.npcId, finalDamage, { now: context.now, rng: context.rng, npcDefenseApplied: true });
      if (res && res.dealt && hp0) {
        hp0._titanArmorDmg = (Number(hp0._titanArmorDmg) || 0) + (res.dealt.armor || 0);
        hp0._titanStructDmg = (Number(hp0._titanStructDmg) || 0) + (res.dealt.structure || 0);
      }
      return { kind: "npc", npcId: npc.npcId, damage: finalDamage, dealt: res.dealt || empty, destroyed: Boolean(res.destroyed) };
    }
    // 玩家：闪避/资本舰缓解/DCU 由调用方（在线 combat.js / 离线 offline-combat.js）按既有口径算好后传入
    const dodge = (typeof context.playerDodge === "number") ? context.playerDodge
      : (getGlobalFn("calcPlayerDodge") ? getGlobalFn("calcPlayerDodge")(undefined, state) : 0);
    raw = calcDamage(attacker.hit || 0, dodge, attacker.baseDamage || 1, 1.0, context.randomFn || function () { return 0.5; });
    if (mitigationFn && context.playerShipConfig) {
      const mit = mitigationFn(context.playerShipConfig, raw, context.shieldHitsUsed || 0, c.hp.shield);
      raw = Math.max(0, Number(mit.damage) || 0);
    }
    if (context.dcReduction > 0) raw = Math.max(0, Math.round(raw * (1 - context.dcReduction)));
    const finalDamage = Math.max(0, Math.round(raw * share));
    const dealt = applyLayers(c.hp, finalDamage);
    return { kind: "player", npcId: null, damage: finalDamage, dealt: dealt };
  }

  // NPC 绑定舰的损伤控制单元减伤（D3）：读 NPC 自身 DCU 模块，求和封顶 50%，燃料走同一注入层
  function computeNpcDcReduction(state, npc, zone, ctx) {
    // 采集与扣费分离：清单（含每件减伤与燃料单价）由 collectNpcDamageControlUnits 统一给出，
    // 此处只负责「燃料够不够 → 计入并扣费」的战斗语义，面板口径复用同一清单而不扣费。
    const units = collectNpcDamageControlUnits(state, npc, zone, offlineModuleCache(ctx));
    if (units.length === 0) return 0;
    let dc = 0;
    for (const u of units) {
      if (ctx && ctx.virtual) {
        if (!spendFuelVirtual(ctx, u.fuel)) continue;
      } else {
        if (!fuelAvailable(ctx, state, u.fuel)) continue;
        spendFuel(ctx, state, u.fuel);
      }
      dc += u.reduction;
    }
    return Math.min(0.5, dc);
  }

  // 舰船配置读取（浏览器走全局 getShipConfigById / getShipConfig）
  function getShipConfigFor(state, instanceId) {
    const ship = findShipInstance(state, instanceId);
    if (!ship) return null;
    const byId = getGlobalFn("getShipConfigById");
    if (byId) return byId(ship.shipId) || null;
    const cfg = getGlobalFn("getShipConfig");
    return cfg ? cfg(ship.shipId) : null;
  }

  // ================================================================
  // NPC 绑定舰的「维修件 / 损伤控制单元」只读清单（2026-09-09）
  // ----------------------------------------------------------------
  // 战斗结算（repairLegionSquadNpcs / computeNpcDcReduction）与战斗页面板明细
  // 共用这两个采集函数，保证「面板口径」与「实战口径」永远同一套公式，不会各写一份。
  // 二者均为纯只读：不扣燃料、不改 state；是否扣燃料由调用方决定。
  // 口径：显式绑定实例 + 排除脑插（与 getLegionNpcCombatStats 完全一致）。
  // ================================================================
  function collectNpcRepairUnits(state, npc, zone, moduleCache) {
    const modulesFn = getGlobalFn("getInstalledCombatModulesFromState");
    const fuelMultFn = getGlobalFn("calcFuelMult");
    if (!modulesFn || !npc || !npc.boundShipInstanceId) return [];
    const shipOpts = { shipInstanceId: npc.boundShipInstanceId, excludeImplants: true };
    if (moduleCache) shipOpts._offlineModuleCache = moduleCache;
    const mult = fuelMultFn ? fuelMultFn(zone, state) : 1;
    return (modulesFn(state, shipOpts) || [])
      .filter(m => m && m.combat && m.combat.kind === "repair" && m.combat.target)
      .map(m => ({
        name: m.name || "维修模块",
        target: m.combat.target,
        amount: Number(m.combat.amount) || 0,
        multiplier: Number(m.multiplier) || 1,
        fuel: Math.max(1, Math.round((Number(m.combat.fuelCost) || 1) * mult))
      }));
  }

  function collectNpcDamageControlUnits(state, npc, zone, moduleCache) {
    const dcsFn = getGlobalFn("getInstalledCombatDamageControls");
    const fuelMultFn = getGlobalFn("calcFuelMult");
    if (!dcsFn || !npc || !npc.boundShipInstanceId) return [];
    const shipOpts = { shipInstanceId: npc.boundShipInstanceId, excludeImplants: true };
    if (moduleCache) shipOpts._offlineModuleCache = moduleCache;
    const mult = fuelMultFn ? fuelMultFn(zone, state, shipOpts) : 1;
    const out = [];
    for (const m of (dcsFn(state, shipOpts) || [])) {
      const cb = m && m.equipment && m.equipment.combat;
      if (!cb) continue;
      out.push({
        name: (m.equipment && m.equipment.name) || "损伤控制单元",
        // 2026-09-10 修复：NPC 舰 DCU 减伤同样补乘强化系数（与玩家舰口径一致）
        reduction: ((m.equipment.bonuses && Number(m.equipment.bonuses.globalDamageReduction)) || 0) * (Number(m.multiplier) || 1),
        fuel: Math.max(1, Math.round((cb.fuelCost || 1) * mult))
      });
    }
    return out;
  }

  // —— NPC 受伤（独立 HP；不转移给玩家，不修改玩家三层 HP）——
  function applyLegionNpcDamage(state, npcId, damage, context) {
    context = context || {};
    const now = resolveNow(context);
    const empty = { shield: 0, armor: 0, structure: 0 };
    const applyLayers = getGlobalFn("applyLayeredCombatDamage");
    const npc = findNpc(state, npcId);
    if (!npc) return { applied: false, reason: "npc-not-found", dealt: empty, destroyed: false };
    ensureLegionNpcCombatFields(npc);
    if (!applyLayers) return { applied: false, reason: "combat-api-unavailable", dealt: empty, destroyed: false };
    const hp = ensureNpcCombatHp(state, npc, now);
    if (!hp) return { applied: false, reason: "stats-unavailable", dealt: empty, destroyed: false };
    let dmg = Math.max(0, Math.round(Number(damage) || 0));
    const shipCfg = getShipConfigFor(state, npc.boundShipInstanceId);
    const isTitanNpc = Boolean(shipCfg && shipCfg.type === "titan");
    // 在线逐次路径：NPC 自身护盾缓解在此统一结算（与离线 resolveTargetDamage 同口径）；
    // 离线已结算则 context.npcDefenseApplied=true 跳过，避免双免。仅泰坦走偏导（超旗在线沿用原行为不变）。
    if (!context.npcDefenseApplied && isTitanNpc) {
      const titanShieldMitFn = getGlobalFn("applyTitanShieldMitigation");
      const titanTraitFn = getGlobalFn("getTitanCombatTrait");
      const tt = titanTraitFn ? titanTraitFn(shipCfg) : (shipCfg.capitalTrait || null);
      if (tt && titanShieldMitFn) {
        if (hp._titanRoundSeq !== context.roundSeq) {
          hp._titanRoundSeq = context.roundSeq;
          hp._titanShieldHitsUsed = 0;
          hp._titanDeflectTriggers = 0;
          hp._titanArmorDmg = 0;
          hp._titanStructDmg = 0;
        }
        const used = Number(hp._titanShieldHitsUsed) || 0;
        const mit = titanShieldMitFn(tt, dmg, used, (hp.shield) || 0);
        dmg = Math.max(0, Number(mit.damage) || 0);
        if (hp.shield > 0) hp._titanShieldHitsUsed = used + 1;
        if (mit.triggered) hp._titanDeflectTriggers = (Number(hp._titanDeflectTriggers) || 0) + 1;
      }
    }
    const dealt = applyLayers(hp, dmg);
    // 累计甲/构损供回合末泰坦应激/过载密封维修（离线 resolveTargetDamage 已累计则跳过，避免双计）
    if (!context.npcDefenseApplied && isTitanNpc) {
      hp._titanArmorDmg = (Number(hp._titanArmorDmg) || 0) + (dealt.armor || 0);
      hp._titanStructDmg = (Number(hp._titanStructDmg) || 0) + (dealt.structure || 0);
    }
    let destroyed = false;
    if (hp.structure <= 0) {
      const res = handleLegionNpcDestroyed(state, npcId, now);
      destroyed = Boolean(res && res.changed);
    }
    markDirty(state);
    return { applied: true, dealt: dealt, destroyed: destroyed, npcId: npcId, structure: hp.structure };
  }

  // 泰坦舰体固有维修倍率（NPC 版，使用绑定泰坦 config 而非玩家出战舰）；
  // 镜像 selectors.js getTitanTraitRepairMultiplierFromState，但入参为 NPC 的 shipCfg。
  function getTitanRepairMult(shipCfg, target, structureRatio) {
    if (!shipCfg || shipCfg.type !== "titan") return 1;
    const roleBonus = shipCfg.bonuses && target ? Number(shipCfg.bonuses[target + "Repair"]) || 0 : 0;
    let mult = 1 + roleBonus;
    if (target === "structure" && typeof structureRatio === "number" && structureRatio < 0.7 && shipCfg.bonuses && typeof shipCfg.bonuses.structureEmergencyRepair === "number") {
      mult += Number(shipCfg.bonuses.structureEmergencyRepair) || 0;
    }
    return Math.max(0, mult);
  }

  // 回合末：对处于战斗中的 NPC 绑定泰坦应用舰体固有维修（偏导稳态回充 / 强化应激装甲 / 泰坦结构过载密封），
  // 与玩家出战泰坦（combat.js / offline-combat.js 同位置）完全同口径；只吃泰坦舰体自身维修加成。
  // 累加量由 resolveTargetDamage（离线）与 applyLegionNpcDamage（在线）在每轮承伤时写入 npc.combatHp，
  // 此处按 roundSeq 跨轮累计、调用即清零（下一轮重新累计）。非小队模式直接返回。
  function repairLegionNpcTitanTraits(state, now) {
    const squad = ensureCombatSquadState(state);
    if (!squad || squad.enabled !== true) return { repaired: 0 };
    const targets = getLegionCombatTargets(state, { now: now });
    let applied = 0;
    for (const t of targets) {
      if (t.kind !== "npc") continue;
      const npc = findNpc(state, t.npcId);
      if (!npc || !npc.combatHp) continue;
      ensureLegionNpcCombatFields(npc);
      const shipCfg = getShipConfigFor(state, npc.boundShipInstanceId);
      if (!shipCfg || shipCfg.type !== "titan") continue;
      const traitFn = getGlobalFn("getTitanCombatTrait");
      const steadyFn = getGlobalFn("getTitanSteadyRechargeRepair");
      const reactiveFn = getGlobalFn("getTitanReactiveArmorRepair");
      const overdriveFn = getGlobalFn("getTitanOverdriveSealRepair");
      const tt = traitFn ? traitFn(shipCfg) : (shipCfg.capitalTrait || null);
      if (!tt || !steadyFn || !reactiveFn || !overdriveFn) continue;
      const hp = npc.combatHp;
      const stats = getLegionNpcCombatStats(state, npc.npcId, {});
      if (!stats.ok || !stats.maxHp) continue;
      const maxShield = stats.maxHp.shield, maxArmor = stats.maxHp.armor, maxStructure = stats.maxHp.structure;
      const ratio = maxStructure > 0 ? (hp.structure / maxStructure) : 1;
      // 偏导稳态回充
      const trig = Number(hp._titanDeflectTriggers) || 0;
      if (tt.id === "titan_deflection_shield" && trig > 0 && hp.shield < maxShield) {
        const base = steadyFn(tt, trig, maxShield);
        const restored = Math.min(base * getTitanRepairMult(shipCfg, "shield", ratio), maxShield - hp.shield);
        if (restored > 0) { hp.shield += restored; applied++; }
      }
      // 强化应激装甲
      const armorDmg = Number(hp._titanArmorDmg) || 0;
      if (tt.id === "titan_reactive_armor" && armorDmg > 0 && hp.armor < maxArmor) {
        const base = reactiveFn(tt, armorDmg, maxArmor);
        const restored = Math.min(base * getTitanRepairMult(shipCfg, "armor", ratio), maxArmor - hp.armor);
        if (restored > 0) { hp.armor += restored; applied++; }
      }
      // 泰坦结构过载密封
      const structDmg = Number(hp._titanStructDmg) || 0;
      if (tt.id === "titan_structure_overdrive" && structDmg > 0 && hp.structure < maxStructure) {
        const layers = Math.min(tt.maxLayers, Math.floor(((1 - ratio) + 1e-9) / (tt.thresholdPct || 0.10)));
        const base = overdriveFn(tt, structDmg, layers);
        const restored = Math.min(base * getTitanRepairMult(shipCfg, "structure", ratio), maxStructure - hp.structure);
        if (restored > 0) { hp.structure += restored; applied++; }
      }
      // 清零本轮累计（下一轮重计）
      hp._titanDeflectTriggers = 0; hp._titanArmorDmg = 0; hp._titanStructDmg = 0;
    }
    if (applied > 0) markDirty(state);
    return { repaired: applied };
  }

  // —— 爆船处理（180s 修复 + 退出当前战斗）——
  function handleLegionNpcDestroyed(state, npcId, now) {
    const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const npc = findNpc(state, npcId);
    if (!npc) return { changed: false, reason: "npc-not-found" };
    ensureLegionNpcCombatFields(npc);
    const squad = ensureCombatSquadState(state);
    if (squad && Array.isArray(squad.members)) {
      squad.members.forEach(m => {
        if (m && m.npcId === npcId) { m.destroyedInBattle = true; m.active = false; }
      });
    }
    const rep = startLegionNpcRepair(state, npcId, t);
    return { changed: true, npcId: npcId, repairUntil: npc.repairUntil, repairMs: NPC_REPAIR_DURATION_MS, repair: rep };
  }

  // 进入修复：destroyed=true + repairUntil=now+180000；不删除 NPC、不动绑定舰
  function startLegionNpcRepair(state, npcId, now) {
    const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const npc = findNpc(state, npcId);
    if (!npc) return { changed: false, reason: "npc-not-found" };
    ensureLegionNpcCombatFields(npc);
    npc.destroyed = true;
    npc.repairUntil = t + NPC_REPAIR_DURATION_MS;
    npc.occupiedByCombat = false;   // 爆船退出战斗即释放占用（修复锁定由 destroyed/repairUntil 承担）
    npc.combatHp = { shield: 0, armor: 0, structure: 0 };
    markDirty(state);
    return { changed: true, npcId: npcId, repairUntil: npc.repairUntil, repairMs: NPC_REPAIR_DURATION_MS };
  }

  // 修复完成：只有 now >= repairUntil 才恢复（时间倒退绝不提前修复）
  function completeLegionNpcRepair(state, npcId, now) {
    const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const npc = findNpc(state, npcId);
    if (!npc) return { changed: false, reason: "npc-not-found" };
    ensureLegionNpcCombatFields(npc);
    if (!npc.destroyed && npc.repairUntil == null) return { changed: false, reason: "not-destroyed" };
    const until = Number(npc.repairUntil);
    if (Number.isFinite(until) && t < until) {
      return { changed: false, reason: "still-repairing", remaining: until - t, until: until };
    }
    const stats = getLegionNpcCombatStats(state, npcId, {});
    npc.destroyed = false;
    npc.repairUntil = null;
    npc.combatHp = stats.ok && stats.maxHp
      ? { shield: stats.maxHp.shield, armor: stats.maxHp.armor, structure: stats.maxHp.structure }
      : { shield: 0, armor: 0, structure: 0 };
    markDirty(state);
    return { changed: true, npcId: npcId, combatHp: { ...npc.combatHp } };
  }

  // 批量推进修复（幂等；仅 repairUntil 到期者恢复）
  function tickLegionSquadRepairs(state, now) {
    const L = state && state.legion;
    if (!L || !Array.isArray(L.npcs)) return { repaired: 0 };
    const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    let repaired = 0;
    for (const npc of L.npcs) {
      if (!npc) continue;
      ensureLegionNpcCombatFields(npc);
      if (!npc.destroyed) continue;
      const until = Number(npc.repairUntil);
      if (!Number.isFinite(until) || t < until) continue;
      const res = completeLegionNpcRepair(state, npc.npcId, t);
      if (res.changed) repaired++;
    }
    return { repaired: repaired };
  }

  // 修复状态只读快照（UI / 测试）
  function getLegionNpcRepairState(state, npcId, now) {
    const npc = findNpc(state, npcId);
    const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    if (!npc) return { npcId: npcId, exists: false, destroyed: false, repairing: false, remaining: 0, until: null, ready: false };
    ensureLegionNpcCombatFields(npc);
    const until = Number(npc.repairUntil);
    const repairing = Boolean(npc.destroyed) && Number.isFinite(until) && until > t;
    return {
      npcId: npcId,
      exists: true,
      destroyed: Boolean(npc.destroyed),
      repairing: repairing,
      remaining: repairing ? Math.max(0, until - t) : 0,
      until: Number.isFinite(until) ? until : null,
      ready: !npc.destroyed,
      combatHp: npc.combatHp ? { ...npc.combatHp } : null
    };
  }

  // 本回合小队结果快照（UI / 测试）
  function getLegionCombatRoundResult(state) {
    const squad = ensureCombatSquadState(state);
    if (!squad) return null;
    return {
      squadEnabled: Boolean(squad.enabled),
      battleId: squad.battleId,
      targetId: squad.targetId,
      totalNpcDamage: (state.combat && typeof state.combat.runSquadDamageDealt === "number") ? state.combat.runSquadDamageDealt : 0,
      lastRound: squad.lastRound || null,
      targets: getLegionCombatTargets(state).map(t => ({ kind: t.kind, npcId: t.npcId }))
    };
  }

  return {
    // 常量 / reason
    NPC_REPAIR_DURATION_MS: NPC_REPAIR_DURATION_MS,
    JOIN_REASONS: JOIN_REASONS,
    // 状态结构 / 迁移
    createDefaultSquad: createDefaultSquad,
    ensureCombatSquadState: ensureCombatSquadState,
    ensureLegionNpcCombatFields: ensureLegionNpcCombatFields,
    ensureLegionNpcsCombatFields: ensureLegionNpcsCombatFields,
    // 研究门禁
    isLegionDualSquadUnlocked: isLegionDualSquadUnlocked,
    isLegionTripleSquadUnlocked: isLegionTripleSquadUnlocked,
    getLegionSquadCapacity: getLegionSquadCapacity,
    // 参战资格
    canLegionNpcJoinCombat: canLegionNpcJoinCombat,
    getEligibleLegionCombatNpcs: getEligibleLegionCombatNpcs,
    // 占用保护
    getShipCombatLockReason: getShipCombatLockReason,
    findLegionNpcByBoundShip: findLegionNpcByBoundShip,
    // 小队成员操作
    beginLegionSquadBattle: beginLegionSquadBattle,
    addLegionNpcToCombatSquad: addLegionNpcToCombatSquad,
    removeLegionNpcFromCombatSquad: removeLegionNpcFromCombatSquad,
    endLegionSquadBattle: endLegionSquadBattle,
    // 部署物（激光定向打捞单元等）操作
    addDeployableToSquad: addDeployableToSquad,
    deployDeployable: deployDeployable,
    undeployDeployable: undeployDeployable,
    dismantleDeployable: dismantleDeployable,
    MTU_MAX_DEPLOYED: MTU_MAX_DEPLOYED,
    MTU_DEPLOYABLE_PREFIX: MTU_DEPLOYABLE_PREFIX,
    // 只读快照
    getLegionCombatSquadState: getLegionCombatSquadState,
    getLegionSquadCapacity: getLegionSquadCapacity,
    // M2：伤害倍率 / 舰船属性（显式实例 + 排除脑插）
    getLegionNpcDamageMultiplier: getLegionNpcDamageMultiplier,
    getLegionNpcCombatStats: getLegionNpcCombatStats,
    // M3：在线战斗小队接入
    selectLegionCombatTarget: selectLegionCombatTarget,
    getLegionCombatTargets: getLegionCombatTargets,
    processLegionNpcAttack: processLegionNpcAttack,
    fireSingleNpcMember: fireSingleNpcMember,
    // ②-a：小队泰坦光环聚合（玩家 + NPC，stacking=max），供玩家侧 combat.js 取用
    getTitanSquadAura: getTitanSquadAura,
    getEligibleSquadFireMembers: getEligibleSquadFireMembers,
    repairLegionSquadNpcs: repairLegionSquadNpcs,
    processLegionEnemyAttack: processLegionEnemyAttack,
    applyLegionNpcDamage: applyLegionNpcDamage,
    repairLegionNpcTitanTraits: repairLegionNpcTitanTraits,
    handleLegionNpcDestroyed: handleLegionNpcDestroyed,
    startLegionNpcRepair: startLegionNpcRepair,
    completeLegionNpcRepair: completeLegionNpcRepair,
    getLegionNpcRepairState: getLegionNpcRepairState,
    getLegionCombatRoundResult: getLegionCombatRoundResult,
    syncLegionSquadMembers: syncLegionSquadMembers,
    tickLegionSquadRepairs: tickLegionSquadRepairs,
    // M4：离线共用原语
    getSquadAmmoRequirements: getSquadAmmoRequirements,
    computeNpcDcReduction: computeNpcDcReduction,
    // M5：战前选择与 UI 快照
    getLegionSquadSelection: getLegionSquadSelection,
    setLegionSquadSelection: setLegionSquadSelection,
    clearLegionSquadSelection: clearLegionSquadSelection,
    startLegionSquadBattleWithMembers: startLegionSquadBattleWithMembers,
    getLegionCombatSquadUiState: getLegionCombatSquadUiState,
    // M3 兼容别名（沿用首轮规格中的命名）
    processLegionCombatAttack: processLegionNpcAttack,
    applyLegionNpcCombatDamage: applyLegionNpcDamage,
    repairLegionNpcShip: completeLegionNpcRepair
  };
});
