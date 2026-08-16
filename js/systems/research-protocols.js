/* ================================================================
   研究系统 · 自动化协议统一模块（Batch I）

   本批实现三个协议：
     - planauto  行星维护自动续期（权威配置在每个 deployment.autoRenew）
     - autosell  ISK 类文物自动出售（common_isk / unique）
     - autoconv  LP 类文物自动兑换（lp）

   Batch J 追加：autoenh（自动强化）/ autorepair（考古野外自动维修）。
   Batch K 追加：intship（一体化造船）—— 至此六个协议全部实装，不再有"尚未接入"的协议。

   三层门槛（缺一不可）：
     1) 节点已研究：state.research.completedLevels[protocolId] >= 1（唯一事实来源）
     2) 协议总开关：state.research.protocolSettings[protocolId].enabled === true
     3) 业务自身条件：planauto 还需 deployment.autoRenew.enabled 与储备金；
        autosell/autoconv 还需对应类别真实有库存。

   脏档保护：仅凭存档里的 enabled=true 绝不越过"未研究"状态。

   本模块只做编排，不复制任何业务公式：
     - 续期费一律取 getPlanetRenewCostISK（显示价 = 判断价 = 实扣价 = 事件价）
     - 续期一律走 PlanetaryStateActions.renew（不自行扣 ISK、不自行造 planetary:renewed）
     - 出售/兑换一律走 sellArchaeologyArtifacts / redeemArchaeologyArtifacts
   ================================================================ */

// 已实装业务的协议（顺序即 UI 展示序）；Batch K 起六个协议全部实装，不再有"尚未接入"的协议
const IMPLEMENTED_RESEARCH_PROTOCOLS = Object.freeze(["planauto", "autosell", "autoconv", "autoenh", "autorepair", "intship"]);
// 六个协议全集（与 research-state.js PROTOCOL_KEYS 一致，用于识别"已知但未接入"）
const ALL_RESEARCH_PROTOCOLS = Object.freeze(["intship", "autoenh", "planauto", "autosell", "autoconv", "autorepair"]);

// 稳定 reason 常量（外部只依赖字符串值，不依赖此表）
const RESEARCH_PROTOCOL_REASONS = Object.freeze({
  INVALID_STATE: "INVALID_STATE",
  UNKNOWN_PROTOCOL: "UNKNOWN_PROTOCOL",
  PROTOCOL_LOCKED: "PROTOCOL_LOCKED",
  INVALID_ENABLED: "INVALID_ENABLED",
  UNKNOWN_DEPLOYMENT: "UNKNOWN_DEPLOYMENT",
  INVALID_RESERVE: "INVALID_RESERVE",
  ALREADY_SET: "ALREADY_SET",
  PROTOCOL_DISABLED: "PROTOCOL_DISABLED",
  RESERVE_NOT_MET: "RESERVE_NOT_MET",
  INSUFFICIENT_ISK: "INSUFFICIENT_ISK",
  NOTHING_TO_PROCESS: "NOTHING_TO_PROCESS"
});

// Batch J · autoenh / autorepair 专用 reason。
// 刻意不并入上方 RESEARCH_PROTOCOL_REASONS（保持 Batch I「恰为 11 个」断言不被破坏）；
// 这些 reason 字符串同样稳定，供协议层与 UI 复用。协议层 reason 全集 = 11 + 下列。
const AUTO_ENHANCE_REASONS = Object.freeze({
  UNKNOWN_SHIP: "UNKNOWN_SHIP",
  SHIP_ACTIVE: "SHIP_ACTIVE",
  ENHANCEMENT_UNAVAILABLE: "ENHANCEMENT_UNAVAILABLE",
  INSUFFICIENT_COMPONENTS: "INSUFFICIENT_COMPONENTS",
  INVALID_MAX_ATTEMPTS: "INVALID_MAX_ATTEMPTS",
  MAX_ATTEMPTS_REACHED: "MAX_ATTEMPTS_REACHED",
  GUARD_REACHED: "GUARD_REACHED",
  NO_ARCHAEOLOGY_SHIP: "NO_ARCHAEOLOGY_SHIP",
  NO_REPAIRERS: "NO_REPAIRERS",
  FULL_HP: "FULL_HP",
  INSUFFICIENT_FUEL: "INSUFFICIENT_FUEL"
});
// 协议层统一 reason（11 Batch I + Batch J 专用），内部使用
const ALL_PROTOCOL_REASONS = Object.freeze(Object.assign({}, RESEARCH_PROTOCOL_REASONS, AUTO_ENHANCE_REASONS));
const AUTO_ENHANCE_MAX_ATTEMPTS_CAP = 10000;

function isValidProtocolStateShape(state) {
  return Boolean(state && typeof state === "object" && !Array.isArray(state));
}

// 解锁唯一事实来源：completedLevels[protocolId] >= 1（协议节点 maxLevel = 1）
function isResearchProtocolUnlocked(state, protocolId) {
  if (!isValidProtocolStateShape(state)) return false;
  if (ALL_RESEARCH_PROTOCOLS.indexOf(protocolId) < 0) return false;
  const research = state.research;
  if (!research || typeof research !== "object") return false;
  const completed = research.completedLevels;
  if (!completed || typeof completed !== "object" || Array.isArray(completed)) return false;
  return (Number(completed[protocolId]) || 0) >= 1;
}

// 总开关（只读；不代表可执行 —— 执行还须 unlocked）
function isResearchProtocolEnabled(state, protocolId) {
  if (!isValidProtocolStateShape(state)) return false;
  const research = state.research;
  const settings = research && research.protocolSettings;
  if (!settings || typeof settings !== "object") return false;
  const entry = settings[protocolId];
  return Boolean(entry && typeof entry === "object" && entry.enabled === true);
}

// 可执行 = 已研究 且 总开关开启（脏档 enabled=true 但未研究 → false）
function isResearchProtocolActive(state, protocolId) {
  return isResearchProtocolUnlocked(state, protocolId) && isResearchProtocolEnabled(state, protocolId);
}

// ---------------------------------------------------------------
// 设置：协议总开关
//   成功：只改该协议 enabled、置 _dirty、不执行业务、不保存
//   失败：不改状态、不置 _dirty
// ---------------------------------------------------------------
function setResearchProtocolEnabled(state, protocolId, enabled, actionTime) {
  if (!isValidProtocolStateShape(state)) return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_STATE };
  if (IMPLEMENTED_RESEARCH_PROTOCOLS.indexOf(protocolId) < 0) {
    return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.UNKNOWN_PROTOCOL };
  }
  if (typeof enabled !== "boolean") return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_ENABLED };
  if (!isResearchProtocolUnlocked(state, protocolId)) {
    return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.PROTOCOL_LOCKED };
  }
  const settings = state.research.protocolSettings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_STATE };
  }
  const entry = settings[protocolId];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_STATE };
  }
  if (entry.enabled === enabled) return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.ALREADY_SET };
  entry.enabled = enabled;
  state._dirty = true;
  return { changed:true, protocolId, enabled, actionTime:Number(actionTime) || null };
}

// ---------------------------------------------------------------
// 设置：单基地自动续期（planauto 权威配置，每 deployment 独立）
//   顶层 protocolSettings.planauto 不存 minIskReserve
// ---------------------------------------------------------------
function setPlanetAutoRenew(state, deploymentId, enabled, minIskReserve, actionTime) {
  if (!isValidProtocolStateShape(state)) return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_STATE };
  if (!isResearchProtocolUnlocked(state, "planauto")) {
    return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.PROTOCOL_LOCKED };
  }
  if (typeof enabled !== "boolean") return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_ENABLED };
  // 储备金：必须是有限、非负 number；数字字符串 / NaN / Infinity / 负数 / 对象 / 布尔一律拒绝
  if (typeof minIskReserve !== "number" || !isFinite(minIskReserve) || minIskReserve < 0) {
    return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_RESERVE };
  }
  const deployments = state.planetary && Array.isArray(state.planetary.deployments) ? state.planetary.deployments : null;
  const deployment = deployments ? deployments.find(item => item && item.id === deploymentId) : null;
  if (!deployment) return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.UNKNOWN_DEPLOYMENT };
  const prev = (deployment.autoRenew && typeof deployment.autoRenew === "object" && !Array.isArray(deployment.autoRenew))
    ? deployment.autoRenew : null;
  const prevEnabled = prev && typeof prev.enabled === "boolean" ? prev.enabled : false;
  const prevReserve = (prev && typeof prev.minIskReserve === "number" && isFinite(prev.minIskReserve) && prev.minIskReserve >= 0)
    ? prev.minIskReserve : 0;
  if (prev && prevEnabled === enabled && prevReserve === minIskReserve) {
    return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.ALREADY_SET };
  }
  // 每基地独立对象（绝不与其他 deployment 共享引用）；合法小数原样保留
  deployment.autoRenew = { enabled, minIskReserve };
  state._dirty = true;
  return { changed:true, deploymentId:deployment.id, enabled, minIskReserve, actionTime:Number(actionTime) || null };
}

// ---------------------------------------------------------------
// 设置：autoenh 自动强化最大尝试次数（权威字段 protocolSettings.autoenh.maxAttempts）
//   严格输入：只接受有限、非负整数 number
//   拒绝负数 / 小数 / NaN / Infinity / 数字字符串 / 对象 / 数组 / 布尔
//   超过安全上限 10000 → INVALID_MAX_ATTEMPTS（不静默夹紧，由设置方显式决定）
//   相同值 → ALREADY_SET；成功只写 maxAttempts、置 _dirty、不执行业务
//   仅 autoenh 协议；不要求已研究/已启用（配置可先行于解锁）
// ---------------------------------------------------------------
function setAutoEnhancementMaxAttempts(state, maxAttempts) {
  if (!isValidProtocolStateShape(state)) return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_STATE };
  if (typeof maxAttempts !== "number" || !isFinite(maxAttempts) || !Number.isInteger(maxAttempts) || maxAttempts < 0) {
    return { changed:false, reason:AUTO_ENHANCE_REASONS.INVALID_MAX_ATTEMPTS };
  }
  if (maxAttempts > AUTO_ENHANCE_MAX_ATTEMPTS_CAP) {
    return { changed:false, reason:AUTO_ENHANCE_REASONS.INVALID_MAX_ATTEMPTS };
  }
  const settings = state.research && state.research.protocolSettings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_STATE };
  }
  const entry = settings.autoenh;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_STATE };
  }
  if (entry.maxAttempts === maxAttempts) return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.ALREADY_SET };
  entry.maxAttempts = maxAttempts;
  state._dirty = true;
  return { changed:true, maxAttempts };
}

// 底层 enhanceShip 既有的拒绝性 reason → 协议层稳定 reason（失败不得伪装成材料不足）
function mapEnhanceUnderlyingReason(underlying) {
  const R = AUTO_ENHANCE_REASONS;
  switch (underlying) {
    case "unknown-ship": return R.UNKNOWN_SHIP;
    case "ship-active": return R.SHIP_ACTIVE;
    case "enhancement-unavailable": return R.ENHANCEMENT_UNAVAILABLE;
    case "insufficient-components": return R.INSUFFICIENT_COMPONENTS;
    default: return RESEARCH_PROTOCOL_REASONS.PROTOCOL_DISABLED;
  }
}

// ---------------------------------------------------------------
// 执行：autoenh 自动强化
//   逐次严格调用既有 ShellStateActions.enhanceShip（不复制成本/成功率/经验/等级/事件公式，
//   不自行扣强化部件、不自行 emit ship:enhancementAttempted）。
//   循环停止条件：达到 maxAttempts / 强化部件不足 / 舰船处于活动 / 舰船或强化类型不可用 / 防御 guard 10000。
//   maxAttempts=0 → 持续尝试直到真实材料不足（不形成无限循环）。
//   返回摘要含 changed / stopReason / instanceId / attempts / successes / failures /
//   fromLevel / toLevel / componentsSpent / maxAttempts。
//   context.randomValue 仅供测试注入确定性 roll；正式 UI 不得让玩家指定随机值。
// ---------------------------------------------------------------
function runAutoEnhancement(state, instanceId, context) {
  if (!isValidProtocolStateShape(state)) return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_STATE };
  if (!isResearchProtocolActive(state, "autoenh")) {
    return {
      changed:false,
      reason: isResearchProtocolUnlocked(state, "autoenh")
        ? RESEARCH_PROTOCOL_REASONS.PROTOCOL_DISABLED
        : RESEARCH_PROTOCOL_REASONS.PROTOCOL_LOCKED,
      instanceId, attempts:0, successes:0, failures:0,
      fromLevel:0, toLevel:0, componentsSpent:0, maxAttempts:0
    };
  }
  const instance = getShipInstanceFromState(state, instanceId);
  if (!instance) {
    return { changed:false, reason:AUTO_ENHANCE_REASONS.UNKNOWN_SHIP, instanceId, attempts:0, successes:0, failures:0,
      fromLevel:0, toLevel:0, componentsSpent:0, maxAttempts:0 };
  }
  const settings = (state.research && state.research.protocolSettings && state.research.protocolSettings.autoenh) || { maxAttempts:0 };
  const maxAttempts = Number(settings.maxAttempts) || 0;
  const randomValue = (context && typeof context.randomValue !== "undefined") ? context.randomValue : undefined;

  let attempts = 0, successes = 0, failures = 0, componentsSpent = 0;
  const fromLevel = normalizeShipEnhancementLevel(instance.enhancementLevel);
  let stopReason = null;
  const GUARD = 10000;

  for (let guard = 0; guard < GUARD; guard++) {
    if (maxAttempts > 0 && attempts >= maxAttempts) { stopReason = AUTO_ENHANCE_REASONS.MAX_ATTEMPTS_REACHED; break; }
    const res = (typeof ShellStateActions !== "undefined" && typeof ShellStateActions.enhanceShip === "function")
      ? ShellStateActions.enhanceShip(state, instanceId, randomValue)
      : { changed:false, reason:"unknown-ship" };
    // 拒绝性返回（未消耗材料）：仅算停止信号，不计 attempt
    if (!res || !res.changed) {
      stopReason = mapEnhanceUnderlyingReason(res && res.reason);
      break;
    }
    // 真实尝试（已扣材料）：失败仍算一次 attempt、等级保持、0 XP
    attempts++;
    if (res.success) successes++; else failures++;
    if (res.cost && typeof res.cost === "object") {
      for (const q of Object.values(res.cost)) componentsSpent += (Number(q) || 0);
    }
  }
  if (!stopReason) stopReason = AUTO_ENHANCE_REASONS.GUARD_REACHED;

  const toLevel = normalizeShipEnhancementLevel(instance.enhancementLevel);
  const changed = attempts > 0;
  return {
    changed,
    reason: stopReason,
    stopReason,
    protocolId: "autoenh",
    instanceId,
    attempts,
    successes,
    failures,
    fromLevel,
    toLevel,
    componentsSpent,
    maxAttempts
  };
}

// ---------------------------------------------------------------
// 纯只读显示态（UI 唯一数据源；绝不修改任何状态）
// ---------------------------------------------------------------
function getResearchProtocolDisplayState(state, protocolId) {
  const known = ALL_RESEARCH_PROTOCOLS.indexOf(protocolId) >= 0;
  const implemented = IMPLEMENTED_RESEARCH_PROTOCOLS.indexOf(protocolId) >= 0;
  const unlocked = isResearchProtocolUnlocked(state, protocolId);
  const enabled = isResearchProtocolEnabled(state, protocolId);
  const base = {
    protocolId,
    known,
    implemented,
    unlocked,
    enabled,
    active: unlocked && enabled,
    statusText: !unlocked ? "未研究" : (enabled ? "已启用" : "已关闭"),
    scopeText: "",
    deployments: []
  };
  if (!known) return base;
  if (protocolId === "autosell") {
    base.scopeText = "自动处理范围：星币文物与唯一文物 ｜ 校准物不会自动处理";
  } else if (protocolId === "autoconv") {
    base.scopeText = "自动处理范围：功勋文物 ｜ 校准物不会自动处理";
  } else if (protocolId === "planauto") {
    base.scopeText = "每个基地独立开启并配置最低星币储备；到期时刻自动续期，余额不足只停该基地";
    const deployments = (isValidProtocolStateShape(state) && state.planetary && Array.isArray(state.planetary.deployments))
      ? state.planetary.deployments : [];
    const nowRef = Date.now();
    base.deployments = deployments.map(dep => {
      const config = (typeof PLANET_TYPES !== "undefined")
        ? PLANET_TYPES.find(planet => planet.id === dep.planetType) : null;
      const deployedAt = Number(dep.deployedAt) || 0;
      const durationSec = Number(dep.duration) > 0 ? Number(dep.duration) : 86400;
      const expiresAt = deployedAt + durationSec * 1000;
      const auto = (dep.autoRenew && typeof dep.autoRenew === "object" && !Array.isArray(dep.autoRenew)) ? dep.autoRenew : null;
      const running = Boolean(dep.active) && nowRef < expiresAt;
      return {
        deploymentId: dep.id,
        planetType: dep.planetType,
        planetName: config ? config.name : dep.planetType,
        planetIcon: config ? (config.icon || "") : "",
        running,
        statusText: running ? "运行中" : "已到期",
        expiresAt,
        autoRenewEnabled: Boolean(auto && auto.enabled === true),
        minIskReserve: (auto && typeof auto.minIskReserve === "number" && isFinite(auto.minIskReserve) && auto.minIskReserve >= 0)
          ? auto.minIskReserve : 0,
        renewCostISK: (config && typeof getPlanetRenewCostISK === "function") ? getPlanetRenewCostISK(state, config) : 0
      };
    });
  } else if (protocolId === "autoenh") {
    base.scopeText = "自动对单艘舰船反复强化；0 = 持续到强化部件不足为止";
    const settings = (state.research && state.research.protocolSettings && state.research.protocolSettings.autoenh) || {};
    base.maxAttempts = Number(settings.maxAttempts) || 0;
    const ships = (state.inventory && Array.isArray(state.inventory.ships)) ? state.inventory.ships : [];
    const RRI = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry : null;
    base.ships = ships.map(inst => {
      const cfg = inst ? getShipConfigById(inst.shipId) : null;
      const tier = cfg ? getShipEnhancementTier(cfg) : null;
      const cost = (tier && typeof getShipEnhancementCost === "function") ? getShipEnhancementCost(cfg) : {};
      let sufficient = (Object.keys(cost).length === 0);
      if (RRI && Object.keys(cost).length) {
        sufficient = Object.entries(cost).every(([id, q]) => RRI.get(state, "component:" + id) >= q);
      }
      return {
        instanceId: inst ? inst.instanceId : null,
        shipId: inst ? inst.shipId : null,
        currentLevel: inst ? normalizeShipEnhancementLevel(inst.enhancementLevel) : 0,
        hasTier: Boolean(tier),
        componentsSufficient: sufficient
      };
    });
  } else if (protocolId === "autorepair") {
    base.scopeText = "仅在非致命考古反噬后，每件维修装备最多激活一次；不复活、不处理致命反噬";
    const archInstanceId = state.shipAssignments && state.shipAssignments.archaeology;
    const archInst = archInstanceId ? getShipInstanceFromState(state, archInstanceId) : null;
    base.archaeologyShip = archInst ? { instanceId: archInstanceId, shipId: archInst.shipId } : null;
    let repairers = [];
    if (archInst && typeof getInstalledRepairersForShip === "function") {
      repairers = getInstalledRepairersForShip(state, archInstanceId) || [];
    }
    base.repairers = repairers.map(r => ({ itemId: r.itemId, target: r.target, amount: r.amount, fuelCost: r.fuelCost }));
    if (!base.archaeologyShip) base.statusNote = "未指派考古舰船，无法读取维修装备";
    else if (!repairers.length) base.statusNote = "该考古舰船未安装维修装备";
  } else if (protocolId === "intship") {
    base.scopeText = "选定舰船与数量后自动补齐缺口组件并完成总装；全程复用舰船工程制造链路，在线 / 离线一致";
    const job = getIntshipJob(state);
    base.job = summarizeIntshipJob(job);
    base.maxQuantity = INTSHIP_MAX_QUANTITY;
    base.actionBusy = Boolean(state && state.currentAction && state.currentAction.active === true);
    // 只读运行态：作业标着 active 但已不再驱动 currentAction → 面板提示"已中断"
    base.jobRunning = intshipOwnsCurrentAction(state, job);
    base.jobInterrupted = Boolean(job) && isIntshipJobActive(job) && !base.jobRunning;
    base.recipes = buildIntshipRecipeOptions(state);
    if (!job) base.statusNote = "当前没有造船作业";
    else if (job.phase === "recovery-required") base.statusNote = "作业与存档不一致，已冻结；请取消后重新发起";
  }
  return base;
}

// ---------------------------------------------------------------
// planauto 执行：在精确到期时刻尝试续期一次（单周期，逐次扣费由调用方循环驱动）
//   - 不复制维护费公式（取 getPlanetRenewCostISK）
//   - 不自行扣 ISK / 不自行 emit planetary:renewed（走 PlanetaryStateActions.renew）
//   - 失败只影响该 deployment
// ---------------------------------------------------------------
function tryPlanetAutoRenew(state, deployment, atMs, context) {
  if (!isValidProtocolStateShape(state) || !deployment || typeof deployment !== "object") {
    return { renewed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_STATE };
  }
  if (!isResearchProtocolUnlocked(state, "planauto")) {
    return { renewed:false, reason:RESEARCH_PROTOCOL_REASONS.PROTOCOL_LOCKED };
  }
  if (!isResearchProtocolEnabled(state, "planauto")) {
    return { renewed:false, reason:RESEARCH_PROTOCOL_REASONS.PROTOCOL_DISABLED };
  }
  const auto = (deployment.autoRenew && typeof deployment.autoRenew === "object" && !Array.isArray(deployment.autoRenew))
    ? deployment.autoRenew : null;
  if (!auto || auto.enabled !== true) {
    return { renewed:false, reason:RESEARCH_PROTOCOL_REASONS.PROTOCOL_DISABLED };
  }
  const config = (typeof PLANET_TYPES !== "undefined")
    ? PLANET_TYPES.find(planet => planet.id === deployment.planetType) : null;
  if (!config) return { renewed:false, reason:RESEARCH_PROTOCOL_REASONS.UNKNOWN_DEPLOYMENT };
  // 唯一费用公式（与部署卡显示价、手动续期实扣价、renewed 事件价严格同源）
  const maintenanceISK = (typeof getPlanetRenewCostISK === "function")
    ? getPlanetRenewCostISK(state, config) : (Number(config.maintenanceCostISK) || 0);
  const currentISK = ResourceRegistry.get(state, "currency:isk");
  if (currentISK < maintenanceISK) {
    return { renewed:false, reason:RESEARCH_PROTOCOL_REASONS.INSUFFICIENT_ISK, maintenanceISK };
  }
  const reserve = (typeof auto.minIskReserve === "number" && isFinite(auto.minIskReserve) && auto.minIskReserve >= 0)
    ? auto.minIskReserve : 0;
  // 边界：恰好等于 minIskReserve 允许续期；少 1 ISK 拒绝
  if (currentISK - maintenanceISK < reserve) {
    return { renewed:false, reason:RESEARCH_PROTOCOL_REASONS.RESERVE_NOT_MET, maintenanceISK, reserve };
  }
  const renewAt = Number(atMs);
  // 透传 meta：离线自动续期事件须带 timestamp=真实续期边界、offline:true、source:"offline-settlement"，
  // 与 planetary:completed / planetary:expired 离线结算元数据保持一致；在线自动续期仅 offline:false。
  // timestamp 强制为真实续期边界 renewAt（绝不使用 Date.now()），供事件消费方按虚拟时间排序/对账。
  const renewOffline = Boolean(context && context.offline);
  const renewMeta = { timestamp: Number.isFinite(renewAt) ? renewAt : Date.now(), offline: renewOffline };
  if (renewOffline) renewMeta.source = "offline-settlement";
  const result = PlanetaryStateActions.renew(state, deployment.id, Number.isFinite(renewAt) ? renewAt : Date.now(), renewMeta);
  if (!result || !result.changed) {
    return { renewed:false, reason:RESEARCH_PROTOCOL_REASONS.INSUFFICIENT_ISK, maintenanceISK, renewReason:result && result.reason };
  }
  return {
    renewed:true,
    deploymentId:deployment.id,
    maintenanceISK,
    reserve,
    renewedAt:Number.isFinite(renewAt) ? renewAt : null,
    offline:Boolean(context && context.offline)
  };
}

// ---------------------------------------------------------------
// autosell / autoconv 执行：考古周期成功、文物真实入库之后调用一次
//   - 分类严格：autosell 只 common_isk/unique；autoconv 只 lp；calibration 永不处理
//   - 两协议同开时各处理自己的类别，互不重复消费、互不阻塞
//   - 只发既有批量事件（不逐件 toast）
// ---------------------------------------------------------------
function applyArchaeologyArtifactProtocols(state, context) {
  if (!isValidProtocolStateShape(state)) {
    return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.INVALID_STATE, sold:null, redeemed:null };
  }
  const offline = Boolean(context && context.offline);
  const source = (context && typeof context.source === "string" && context.source) ? context.source : "research-protocol";
  const callContext = { offline, source };
  let sold = null;
  let redeemed = null;

  if (isResearchProtocolActive(state, "autosell") && typeof sellArchaeologyArtifacts === "function") {
    const result = sellArchaeologyArtifacts(state, null, 0, true, callContext);
    if (result && result.changed) sold = result;
  }
  if (isResearchProtocolActive(state, "autoconv") && typeof redeemArchaeologyArtifacts === "function") {
    const result = redeemArchaeologyArtifacts(state, null, 0, true, callContext);
    if (result && result.changed) redeemed = result;
  }
  if (!sold && !redeemed) {
    return { changed:false, reason:RESEARCH_PROTOCOL_REASONS.NOTHING_TO_PROCESS, sold:null, redeemed:null, offline };
  }
  return {
    changed:true,
    offline,
    source,
    sold,
    redeemed,
    soldQuantity: sold ? (Number(sold.sold) || 0) : 0,
    totalIsk: sold ? (Number(sold.totalIsk) || 0) : 0,
    redeemedQuantity: redeemed ? (Number(redeemed.redeemed) || 0) : 0,
    totalLp: redeemed ? (Number(redeemed.totalLp) || 0) : 0
  };
}

/* ================================================================
   Batch K · intship 一体化造船协议
   ----------------------------------------------------------------
   一次配置（舰船 + 数量）→ 协议自动完成「缺口组件生产 → 舰船总装」全链路。
   在线（tick.js）与离线（offline.js）共用同一套推进函数与同一制造链路。

   绝对红线（本模块只做编排）：
     - 绝不自行扣任何材料 / 组件：一律走 ManufacturingStateActions.select/start*
       + 既有 tick.js / offline.js 制造分支的 deductMats / deductShipAssemblyComponents
     - 绝不自行创建舰船实例：舰船只能由既有制造分支 createShipInstance 产出
     - 绝不自行 emit manufacturing:completed：只做该事件的幂等消费者
     - 绝不复制周期时长 / 船坞节省 / 组件成本公式：
       取 getShipAssemblyComponentCost / getShipyardProductionQuote 唯一计算层
   ================================================================ */

const INTSHIP_MAX_QUANTITY = 1000;
const INTSHIP_LEDGER_MAX_ENTRIES = 512;
const INTSHIP_ACTIVE_PHASES = Object.freeze(["component", "assembly"]);

// intship 公开 API 的稳定 reason 全集（恰 20 个）：5 个复用 Batch I + 14 个本批新增 + EVENTS_UNAVAILABLE。
// 外部只依赖字符串值，不依赖此表本身。
const INTSHIP_REASONS = Object.freeze({
  INVALID_STATE: "INVALID_STATE",
  PROTOCOL_LOCKED: "PROTOCOL_LOCKED",
  PROTOCOL_DISABLED: "PROTOCOL_DISABLED",
  NOTHING_TO_PROCESS: "NOTHING_TO_PROCESS",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  UNKNOWN_RECIPE: "UNKNOWN_RECIPE",
  BLUEPRINT_LOCKED: "BLUEPRINT_LOCKED",
  LEVEL_LOCKED: "LEVEL_LOCKED",
  SHIPYARD_LOCKED: "SHIPYARD_LOCKED",
  ACTION_BUSY: "ACTION_BUSY",
  JOB_ALREADY_ACTIVE: "JOB_ALREADY_ACTIVE",
  NO_ACTIVE_JOB: "NO_ACTIVE_JOB",
  JOB_NOT_RESUMABLE: "JOB_NOT_RESUMABLE",
  JOB_COMPLETED: "JOB_COMPLETED",
  JOB_CANCELLED: "JOB_CANCELLED",
  INSUFFICIENT_MATERIALS: "INSUFFICIENT_MATERIALS",
  PREEMPTED: "PREEMPTED",
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
  START_FAILED: "START_FAILED",
  EVENTS_UNAVAILABLE: "EVENTS_UNAVAILABLE"
});

// ---- 模块运行期私有引用（绝不写入 gameState、绝不进存档） ----
let _intshipRuntimeState = null;   // 幂等消费者读取账本的活动 state
let _intshipUnsubscribe = null;    // 当前已安装消费者的取消函数
let _intshipConsumerJobId = null;  // 当前已安装消费者绑定的 jobId
let _intshipJobSeq = 0;            // 会话内单调递增序号（保证 jobId 唯一）

function intshipNow(value) {
  const n = Number(value);
  return (Number.isFinite(n) && n >= 0) ? n : Date.now();
}

function getIntshipJob(state) {
  if (!isValidProtocolStateShape(state)) return null;
  const research = state.research;
  const jobs = (research && typeof research === "object") ? research.protocolJobs : null;
  if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) return null;
  const job = jobs.intship;
  return (job && typeof job === "object" && !Array.isArray(job)) ? job : null;
}

function isIntshipJobActive(job) {
  return Boolean(job) && INTSHIP_ACTIVE_PHASES.indexOf(job.phase) >= 0;
}

function getShipAssemblyRecipeById(recipeId) {
  if (typeof SHIP_ASSEMBLY_RECIPES === "undefined" || !Array.isArray(SHIP_ASSEMBLY_RECIPES)) return null;
  return SHIP_ASSEMBLY_RECIPES.find(recipe => recipe && recipe.id === recipeId) || null;
}

function getShipComponentRecipeById(componentId) {
  if (typeof SHIP_COMPONENT_RECIPES === "undefined" || !Array.isArray(SHIP_COMPONENT_RECIPES)) return null;
  return SHIP_COMPONENT_RECIPES.find(recipe => recipe && recipe.id === componentId) || null;
}

function intshipComponentRemaining(job, componentId) {
  const plan = (job && job.componentPlan) || {};
  const done = (job && job.completedComponents) || {};
  return Math.max(0, (Number(plan[componentId]) || 0) - (Number(done[componentId]) || 0));
}

// 组件推进顺序 = componentPlan 键插入序（即配方 componentCost 顺序），确定性、可断言
function nextIntshipComponentId(job) {
  const plan = (job && job.componentPlan) || {};
  for (const componentId of Object.keys(plan)) {
    if (intshipComponentRemaining(job, componentId) > 0) return componentId;
  }
  return null;
}

function nextIntshipJobId(state, now) {
  const base = Math.floor(intshipNow(now));
  const prev = getIntshipJob(state);
  let candidate = "";
  do {
    _intshipJobSeq++;
    candidate = "intship-" + base + "-" + _intshipJobSeq;
  } while (prev && prev.jobId === candidate);
  return candidate;
}

// currentAction 是浅层对象：快照 / 回滚用于「启动失败绝不改状态」的原子性
function snapshotIntshipAction(state) {
  const action = state && state.currentAction;
  return (action && typeof action === "object") ? Object.assign({}, action) : null;
}
function restoreIntshipAction(state, snapshot) {
  if (!snapshot || !state || !state.currentAction) return;
  for (const key of Object.keys(state.currentAction)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) delete state.currentAction[key];
  }
  Object.assign(state.currentAction, snapshot);
}

// 当前 currentAction 是否正由本作业驱动（纯只读；用于抢占 / 中断识别）
function intshipOwnsCurrentAction(state, job) {
  if (!job || !isIntshipJobActive(job)) return false;
  const action = state && state.currentAction;
  if (!action || action.active !== true) return false;
  if (action.skill !== "shipEngineering") return false;
  if (job.phase === "component") {
    return action.shipSubAction === "component" &&
      Boolean(job.currentComponentId) &&
      action.startedShipCompTarget === job.currentComponentId;
  }
  return action.shipSubAction === "assembly" && action.startedShipAsmTarget === job.recipeId;
}

function mapIntshipManufacturingReason(reason) {
  switch (reason) {
    case "unknown-component":
    case "unknown-assembly": return INTSHIP_REASONS.UNKNOWN_RECIPE;
    case "blueprint-locked": return INTSHIP_REASONS.BLUEPRINT_LOCKED;
    case "level-locked": return INTSHIP_REASONS.LEVEL_LOCKED;
    case "shipyard-level-locked": return INTSHIP_REASONS.SHIPYARD_LOCKED;
    case "insufficient-components": return INTSHIP_REASONS.INSUFFICIENT_MATERIALS;
    default: return INTSHIP_REASONS.START_FAILED;
  }
}

// 中断诊断：只读判断当前阶段是否真的因缺料而停（否则视为玩家抢占）
function diagnoseIntshipInterruption(state, job) {
  const RR = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry : null;
  if (job.phase === "component") {
    const recipe = getShipComponentRecipeById(job.currentComponentId);
    if (recipe && RR && typeof RR.canAffordCost === "function" && !RR.canAffordCost(state, recipe.cost)) {
      return INTSHIP_REASONS.INSUFFICIENT_MATERIALS;
    }
  } else if (job.phase === "assembly") {
    const recipe = getShipAssemblyRecipeById(job.recipeId);
    if (recipe && typeof getShipAssemblyMaxCyclesFromState === "function" &&
        getShipAssemblyMaxCyclesFromState(state, recipe) < 1) {
      return INTSHIP_REASONS.INSUFFICIENT_MATERIALS;
    }
  }
  return INTSHIP_REASONS.PREEMPTED;
}

// ---------------------------------------------------------------
// 事件总线可用性（私有统一判断）：严格确认 GameEvents 存在且 onIdempotent 为函数。
// 所有运行期入口（reconcile / advance / restore）每次执行都必须先检查，
// 不能只在 _intshipConsumerJobId !== job.jobId 时才检查。
// ---------------------------------------------------------------
function isIntshipEventBusAvailable() {
  return typeof GameEvents !== "undefined" && GameEvents !== null &&
    typeof GameEvents.onIdempotent === "function";
}

// ---------------------------------------------------------------
// 统一 fail-closed：事件总线不可用时停止 intship 驱动的制造动作并落 recovery-required。
//   - 只在 intship 作业确实驱动 currentAction 时才停止该动作（绝不误伤玩家无关动作）；
//   - 不扣材料、不制造组件、不产舰、不推进账本；
//   - 更新 updatedAt 为归一化后的真实 at，卸载消费者并置脏。
// ---------------------------------------------------------------
function failIntshipEventBusClosed(state, job, at, offline) {
  const owned = intshipOwnsCurrentAction(state, job);
  if (owned && state && state.currentAction) {
    state.currentAction.active = false;
    state.currentAction.batchRemaining = 0;
    state.currentAction.progress = 0;
  }
  job.phase = "recovery-required";
  job.stopReason = INTSHIP_REASONS.EVENTS_UNAVAILABLE;
  job.currentComponentId = null;
  job.updatedAt = intshipNow(at);
  uninstallIntshipProtocolConsumer();
  if (state) state._dirty = true;
  return {
    changed:true, reason:INTSHIP_REASONS.EVENTS_UNAVAILABLE,
    phase:"recovery-required", jobId:job.jobId,
    offline:Boolean(offline), stoppedAction:owned
  };
}

// ---------------------------------------------------------------
// 运行期对账：活动作业若已不再驱动 currentAction，则落为 stopped / preempted。
// 每 tick 调用一次 + continue / cancel / start 入口各调一次；幂等、便宜。
// 事件总线必须在每次执行入口检查：不可用 → fail closed 为 recovery-required。
// ---------------------------------------------------------------
function reconcileIntshipRuntime(state, now) {
  const job = getIntshipJob(state);
  if (!job || !isIntshipJobActive(job)) return job;
  // 事件总线不可用：绝不允许"制造继续但账本不推进" → 统一 fail-closed
  if (!isIntshipEventBusAvailable()) {
    return failIntshipEventBusClosed(state, job, now, false);
  }
  if (intshipOwnsCurrentAction(state, job)) {
    // 保持消费者与活动 state 同步（导入存档 / 多 state 场景下必需）
    if (_intshipConsumerJobId !== job.jobId) {
      const installed = installIntshipProtocolConsumer(state, job);
      if (!installed) {
        return failIntshipEventBusClosed(state, job, now, false);
      }
    } else {
      _intshipRuntimeState = state;
    }
    return job;
  }
  const action = state.currentAction;
  const otherActionRunning = Boolean(action && action.active === true);
  const reason = otherActionRunning ? INTSHIP_REASONS.PREEMPTED : diagnoseIntshipInterruption(state, job);
  job.phase = (reason === INTSHIP_REASONS.PREEMPTED) ? "preempted" : "stopped";
  job.stopReason = reason;
  job.updatedAt = intshipNow(now);
  uninstallIntshipProtocolConsumer();
  state._dirty = true;
  return job;
}

// ---------------------------------------------------------------
// 幂等事件消费者：只更账本（完成计数），绝不改 currentAction、绝不启动下一阶段。
// 阶段推进统一由 advanceIntshipAfterManufacturingAction 在队列清理之后完成。
// ---------------------------------------------------------------
function uninstallIntshipProtocolConsumer() {
  if (typeof _intshipUnsubscribe === "function") {
    try { _intshipUnsubscribe(); } catch (error) { /* 事件总线缺失不影响作业状态 */ }
  }
  _intshipUnsubscribe = null;
  _intshipConsumerJobId = null;
}

// onIdempotent 抛异常或未返回有效取消函数：统一视为安装失败，绝不留下半安装全局状态。
function installIntshipProtocolConsumer(state, job) {
  uninstallIntshipProtocolConsumer();
  if (!job || typeof job.jobId !== "string" || !job.jobId) return false;
  _intshipRuntimeState = state;
  if (!isIntshipEventBusAvailable()) return false;
  const jobId = job.jobId;
  let unsubscribe = null;
  try {
    unsubscribe = GameEvents.onIdempotent("manufacturing:completed", {
      consumerId: "intship:" + jobId,
      maxEntries: INTSHIP_LEDGER_MAX_ENTRIES,
      getLedger: () => {
        const current = getIntshipJob(_intshipRuntimeState);
        return (current && current.jobId === jobId) ? current : null;
      }
    }, event => consumeIntshipManufacturingEvent(jobId, event));
  } catch (error) {
    // 事件总线抛异常：视为安装失败，清理全部半安装状态
    _intshipRuntimeState = null;
    _intshipConsumerJobId = null;
    _intshipUnsubscribe = null;
    return false;
  }
  if (typeof unsubscribe !== "function") {
    // 未返回有效取消函数：视为安装失败，清理全部半安装状态
    _intshipRuntimeState = null;
    _intshipConsumerJobId = null;
    _intshipUnsubscribe = null;
    return false;
  }
  _intshipConsumerJobId = jobId;
  _intshipUnsubscribe = unsubscribe;
  return true;
}

function consumeIntshipManufacturingEvent(jobId, event) {
  const state = _intshipRuntimeState;
  const job = getIntshipJob(state);
  if (!job || job.jobId !== jobId) return false;
  if (!isIntshipJobActive(job)) return false;
  const payload = (event && event.payload && typeof event.payload === "object") ? event.payload : {};
  let quantity = Math.floor(Number(payload.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
  const stamp = intshipNow(event && event.timestamp);

  if (payload.branch === "component") {
    if (job.phase !== "component") return false;
    const componentId = job.currentComponentId;
    if (!componentId || payload.recipeId !== componentId) return false;
    const remaining = intshipComponentRemaining(job, componentId);
    if (remaining <= 0) return false;
    if (!job.completedComponents || typeof job.completedComponents !== "object") job.completedComponents = {};
    job.completedComponents[componentId] = (Number(job.completedComponents[componentId]) || 0) + Math.min(quantity, remaining);
    job.updatedAt = stamp;
    if (state) state._dirty = true;
    return true;
  }
  if (payload.branch === "ship") {
    if (job.phase !== "assembly") return false;
    if (payload.recipeId !== job.recipeId) return false;
    if (payload.shipId !== job.shipId) return false;
    if ((Number(job.assemblyRemaining) || 0) <= 0) return false;
    const applied = Math.min(quantity, Number(job.assemblyRemaining) || 0);
    job.assemblyRemaining = (Number(job.assemblyRemaining) || 0) - applied;
    job.producedShips = (Number(job.producedShips) || 0) + applied;
    job.updatedAt = stamp;
    if (state) state._dirty = true;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------
// 组件计划（私有）：给定总装配方对象与数量，按唯一成本层计算缺口。
//   required = 总装完整组件成本（不再含船坞节省，船坞节省仅作用于部件制造），扣掉现有库存即缺口。
//   缺口为 0 的组件不入计划（避免空转一个 0 批次动作）。
//   绝不复制制造成本公式：取 getShipAssemblyComponentCost。
// ---------------------------------------------------------------
function buildIntshipComponentPlanFromRecipe(state, recipe, quantity) {
  const plan = {};
  const perUnit = (typeof getShipAssemblyComponentCost === "function")
    ? (getShipAssemblyComponentCost(recipe) || {})
    : ((recipe && recipe.componentCost) || {});
  // 船坞材料节省仅作用于部件制造，总装不再享受；故 intship 组件计划按总装完整组件成本计算，不套用船坞节省。
  const RR = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry : null;
  for (const componentId of Object.keys(perUnit)) {
    const key = "component:" + componentId;
    const required = (Number(perUnit[componentId]) || 0) * quantity;
    const stock = RR ? (Number(RR.get(state, key)) || 0) : 0;
    const missing = Math.max(0, Math.ceil(required - stock));
    if (missing > 0) plan[componentId] = missing;
  }
  return plan;
}

// ---------------------------------------------------------------
// 公开 API：buildIntshipComponentPlan(state, targetShipId, quantity)
//   targetShipId：真实舰船 ID 或规范允许的总装 recipe ID 字符串（不接受 recipe 对象）。
//   quantity：必须 typeof number、有限正整数、且 1 <= quantity <= INTSHIP_MAX_QUANTITY。
//   "2"、2.5、NaN、Infinity、0、负数、对象、null 一律拒绝（返回 null，零副作用）。
// ---------------------------------------------------------------
function buildIntshipComponentPlan(state, targetShipId, quantity) {
  if (typeof targetShipId !== "string" || !targetShipId) return null;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || !Number.isInteger(quantity) ||
      quantity < 1 || quantity > INTSHIP_MAX_QUANTITY) return null;
  const recipe = resolveIntshipRecipe({ recipeId: targetShipId }) || resolveIntshipRecipe({ shipId: targetShipId });
  if (!recipe) return null;
  return buildIntshipComponentPlanFromRecipe(state, recipe, quantity);
}

// 按当前阶段启动一次真实制造动作（select + start 全部走既有 action，不自扣不自造）
function startIntshipPhaseAction(state, job, now) {
  const MSA = (typeof ManufacturingStateActions !== "undefined") ? ManufacturingStateActions : null;
  if (!MSA || typeof MSA.startShipComponent !== "function" || typeof MSA.startShipAssembly !== "function") {
    return { started:false, reason:INTSHIP_REASONS.INVALID_STATE };
  }
  const at = intshipNow(now);
  if (job.phase === "component") {
    const componentId = nextIntshipComponentId(job);
    if (!componentId) return { started:false, reason:INTSHIP_REASONS.NOTHING_TO_PROCESS };
    const compRecipe = getShipComponentRecipeById(componentId);
    if (!compRecipe) return { started:false, reason:INTSHIP_REASONS.UNKNOWN_RECIPE };
    const RR = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry : null;
    // 起步即缺料：直接拒绝，绝不留下一个必然空转的动作
    if (RR && typeof RR.canAffordCost === "function" && !RR.canAffordCost(state, compRecipe.cost)) {
      return { started:false, reason:INTSHIP_REASONS.INSUFFICIENT_MATERIALS };
    }
    const selected = MSA.selectShipComponent(state, componentId);
    if (!selected || !selected.changed) return { started:false, reason:mapIntshipManufacturingReason(selected && selected.reason) };
    const started = MSA.startShipComponent(state, at);
    if (!started || !started.changed) return { started:false, reason:mapIntshipManufacturingReason(started && started.reason) };
    job.currentComponentId = componentId;
    // start* 只置 active/进度，不设 batchRemaining —— 批量由协议按缺口精确设定
    state.currentAction.batchRemaining = intshipComponentRemaining(job, componentId);
    return { started:true, phase:"component", componentId, batchRemaining:state.currentAction.batchRemaining };
  }
  if (job.phase === "assembly") {
    const remaining = Number(job.assemblyRemaining) || 0;
    if (remaining <= 0) return { started:false, reason:INTSHIP_REASONS.NOTHING_TO_PROCESS };
    const selected = MSA.selectShipAssembly(state, job.recipeId);
    if (!selected || !selected.changed) return { started:false, reason:mapIntshipManufacturingReason(selected && selected.reason) };
    const started = MSA.startShipAssembly(state, at);
    if (!started || !started.changed) return { started:false, reason:mapIntshipManufacturingReason(started && started.reason) };
    job.currentComponentId = null;
    state.currentAction.batchRemaining = remaining;
    return { started:true, phase:"assembly", batchRemaining:remaining };
  }
  return { started:false, reason:INTSHIP_REASONS.JOB_NOT_RESUMABLE };
}

function summarizeIntshipJob(job) {
  if (!job) return null;
  const plan = job.componentPlan || {};
  const done = job.completedComponents || {};
  let planned = 0, produced = 0;
  const components = Object.keys(plan).map(componentId => {
    const need = Number(plan[componentId]) || 0;
    const made = Math.min(need, Number(done[componentId]) || 0);
    planned += need; produced += made;
    return { componentId, need, done:made, remaining:Math.max(0, need - made) };
  });
  return {
    jobId: job.jobId,
    shipId: job.shipId,
    recipeId: job.recipeId,
    quantity: Number(job.quantity) || 0,
    phase: job.phase,
    stopReason: job.stopReason || null,
    currentComponentId: job.currentComponentId || null,
    assemblyRemaining: Number(job.assemblyRemaining) || 0,
    producedShips: Number(job.producedShips) || 0,
    components,
    componentsPlanned: planned,
    componentsProduced: produced,
    active: isIntshipJobActive(job),
    createdAt: Number(job.createdAt) || 0,
    updatedAt: Number(job.updatedAt) || 0
  };
}

function resolveIntshipRecipe(options) {
  if (!options || typeof options !== "object") return null;
  if (typeof options.recipeId === "string" && options.recipeId) {
    return getShipAssemblyRecipeById(options.recipeId);
  }
  if (typeof options.shipId === "string" && options.shipId &&
      typeof SHIP_ASSEMBLY_RECIPES !== "undefined" && Array.isArray(SHIP_ASSEMBLY_RECIPES)) {
    return SHIP_ASSEMBLY_RECIPES.find(recipe => recipe && recipe.shipId === options.shipId) || null;
  }
  return null;
}

// 门槛检查（与 ManufacturingStateActions 同源判断，不复制公式）：返回 null 表示可造
function checkIntshipRecipeGate(state, recipe) {
  if (!recipe) return INTSHIP_REASONS.UNKNOWN_RECIPE;
  const hasBlueprint = recipe.requiresBlueprint === false ||
    (Array.isArray(state.ownedBlueprints) && state.ownedBlueprints.indexOf(recipe.shipId) >= 0);
  if (!hasBlueprint) return INTSHIP_REASONS.BLUEPRINT_LOCKED;
  const skills = state.skills && state.skills.shipEngineering;
  const level = (skills && Number(skills.lvl)) || 1;
  if (level < (Number(recipe.level) || 1)) return INTSHIP_REASONS.LEVEL_LOCKED;
  if (typeof canAssembleAtShipyard === "function" && !canAssembleAtShipyard(state, recipe.id)) {
    return INTSHIP_REASONS.SHIPYARD_LOCKED;
  }
  return null;
}

// ---------------------------------------------------------------
// 公开 API 1/4：启动一体化造船作业
//   失败一律不改任何状态（含 currentAction 快照回滚），成功才写作业并装消费者。
// ---------------------------------------------------------------
function startIntship(state, options, now) {
  if (!isValidProtocolStateShape(state)) return { changed:false, reason:INTSHIP_REASONS.INVALID_STATE };
  if (!isResearchProtocolUnlocked(state, "intship")) return { changed:false, reason:INTSHIP_REASONS.PROTOCOL_LOCKED };
  if (!isResearchProtocolEnabled(state, "intship")) return { changed:false, reason:INTSHIP_REASONS.PROTOCOL_DISABLED };
  const opts = (options && typeof options === "object") ? options : {};
  const recipe = resolveIntshipRecipe(opts);
  if (!recipe) return { changed:false, reason:INTSHIP_REASONS.UNKNOWN_RECIPE };
  // 严格契约：quantity 必须 typeof number、有限正整数且满足限额；数字字符串 / 小数 / NaN /
  // Infinity / 0 / 负数 / 对象 / null 一律拒绝（缺省按 1 处理）。
  const rawQuantity = (opts.quantity === undefined || opts.quantity === null) ? 1 : opts.quantity;
  if (typeof rawQuantity !== "number" || !Number.isFinite(rawQuantity) || !Number.isInteger(rawQuantity) ||
      rawQuantity < 1 || rawQuantity > INTSHIP_MAX_QUANTITY) {
    return { changed:false, reason:INTSHIP_REASONS.INVALID_QUANTITY };
  }
  const gate = checkIntshipRecipeGate(state, recipe);
  if (gate) return { changed:false, reason:gate };

  const at = intshipNow(now);
  const existing = reconcileIntshipRuntime(state, at);
  if (existing && existing.phase === "recovery-required") return { changed:false, reason:INTSHIP_REASONS.RECOVERY_REQUIRED };
  if (isIntshipJobActive(existing)) return { changed:false, reason:INTSHIP_REASONS.JOB_ALREADY_ACTIVE };
  if (state.currentAction && state.currentAction.active === true) return { changed:false, reason:INTSHIP_REASONS.ACTION_BUSY };

  const plan = buildIntshipComponentPlanFromRecipe(state, recipe, rawQuantity);
  const job = {
    jobId: nextIntshipJobId(state, at),
    shipId: recipe.shipId,
    recipeId: recipe.id,
    quantity: rawQuantity,
    phase: Object.keys(plan).length > 0 ? "component" : "assembly",
    componentPlan: plan,
    completedComponents: {},
    currentComponentId: null,
    assemblyRemaining: rawQuantity,
    producedShips: 0,
    stopReason: null,
    processedEventIds: [],
    createdAt: at,
    updatedAt: at
  };
  const previousJob = state.research.protocolJobs.intship;
  const snapshot = snapshotIntshipAction(state);
  state.research.protocolJobs.intship = job;
  const installed = installIntshipProtocolConsumer(state, job);
  if (!installed) {
    // 事件总线不可用：绝不留一个"制造继续但账本不推进"的作业 → 全量回滚零变化
    state.research.protocolJobs.intship = previousJob;
    restoreIntshipAction(state, snapshot);
    uninstallIntshipProtocolConsumer();
    return { changed:false, reason:INTSHIP_REASONS.EVENTS_UNAVAILABLE };
  }
  const started = startIntshipPhaseAction(state, job, at);
  if (!started.started) {
    // 原子失败：作业与 currentAction 全部回滚，绝不留半启动残留
    state.research.protocolJobs.intship = previousJob;
    restoreIntshipAction(state, snapshot);
    uninstallIntshipProtocolConsumer();
    return { changed:false, reason:started.reason };
  }
  state._dirty = true;
  return {
    changed:true, reason:null, protocolId:"intship",
    jobId:job.jobId, phase:job.phase, componentId:job.currentComponentId,
    batchRemaining:state.currentAction.batchRemaining, job:summarizeIntshipJob(job)
  };
}

// ---------------------------------------------------------------
// 公开 API 2/4：手动续作（缺料补齐后 / 被玩家抢占后）
//   续作以真实库存 + 尚未总装舰船数（assemblyRemaining）为事实重算组件缺口：
//     - 仍在库存的已造组件抵扣缺口；被玩家消耗 / 出售 / 移走的组件重新进入缺口；
//     - 已总装的舰船（producedShips）绝不重新计算；
//     - 原子替换 componentPlan，重置与之不匹配的 completedComponents / currentComponentId；
//     - processedEventIds 幂等账本保留不清空；
//     - 任何失败（含事件总线不可用）一律回滚，绝不留下半写 currentAction 或虚假 running 状态。
// ---------------------------------------------------------------
function continueIntship(state, now) {
  if (!isValidProtocolStateShape(state)) return { changed:false, reason:INTSHIP_REASONS.INVALID_STATE };
  if (!isResearchProtocolUnlocked(state, "intship")) return { changed:false, reason:INTSHIP_REASONS.PROTOCOL_LOCKED };
  if (!isResearchProtocolEnabled(state, "intship")) return { changed:false, reason:INTSHIP_REASONS.PROTOCOL_DISABLED };
  const at = intshipNow(now);
  const job = reconcileIntshipRuntime(state, at);
  if (!job) return { changed:false, reason:INTSHIP_REASONS.NO_ACTIVE_JOB };
  if (job.phase === "completed") return { changed:false, reason:INTSHIP_REASONS.JOB_COMPLETED };
  if (job.phase === "cancelled") return { changed:false, reason:INTSHIP_REASONS.JOB_CANCELLED };
  if (job.phase === "recovery-required") return { changed:false, reason:INTSHIP_REASONS.RECOVERY_REQUIRED };
  if (isIntshipJobActive(job)) return { changed:false, reason:INTSHIP_REASONS.JOB_ALREADY_ACTIVE };
  if (job.phase !== "stopped" && job.phase !== "preempted") return { changed:false, reason:INTSHIP_REASONS.JOB_NOT_RESUMABLE };
  if (state.currentAction && state.currentAction.active === true) return { changed:false, reason:INTSHIP_REASONS.ACTION_BUSY };

  const recipe = getShipAssemblyRecipeById(job.recipeId);
  if (!recipe || recipe.shipId !== job.shipId) {
    job.phase = "recovery-required";
    job.stopReason = INTSHIP_REASONS.RECOVERY_REQUIRED;
    job.updatedAt = at;
    state._dirty = true;
    return { changed:false, reason:INTSHIP_REASONS.RECOVERY_REQUIRED };
  }
  const gate = checkIntshipRecipeGate(state, recipe);
  if (gate) return { changed:false, reason:gate };

  // 尚未总装的舰船数 = 缺口计算基准（已总装的不重新计算）
  const pendingShips = Math.max(0, Number(job.assemblyRemaining) || 0);
  if (pendingShips <= 0) {
    // 没有待总装舰船：直接收尾为已完成（不产舰、不装消费者）
    job.phase = "completed";
    job.componentPlan = {};
    job.completedComponents = {};
    job.currentComponentId = null;
    job.stopReason = null;
    job.updatedAt = at;
    uninstallIntshipProtocolConsumer();
    state._dirty = true;
    return { changed:true, reason:null, phase:"completed", jobId:job.jobId, producedShips:Number(job.producedShips) || 0 };
  }
  // 以当前真实库存重算缺口（库存可抵扣；被消耗的组件重新进入缺口）
  const newPlan = buildIntshipComponentPlanFromRecipe(state, recipe, pendingShips);

  const prevPhase = job.phase;
  const prevStopReason = job.stopReason;
  const prevComponentId = job.currentComponentId;
  const prevPlan = job.componentPlan;
  const prevCompleted = job.completedComponents;
  const snapshot = snapshotIntshipAction(state);

  // 先安装消费者：失败则零变化返回（绝不留"制造继续但账本不推进"）
  const installed = installIntshipProtocolConsumer(state, job);
  if (!installed) {
    restoreIntshipAction(state, snapshot);
    return { changed:false, reason:INTSHIP_REASONS.EVENTS_UNAVAILABLE, previousStopReason:prevStopReason };
  }

  const resumePhase = Object.keys(newPlan).length > 0 ? "component" : "assembly";
  job.phase = resumePhase;
  // 原子替换计划：缺口即事实；与新计划不匹配的完成账本 / 当前组件全部重置。
  job.componentPlan = newPlan;
  job.completedComponents = {};
  job.currentComponentId = null;
  const started = startIntshipPhaseAction(state, job, at);
  if (!started.started) {
    // 失败原子回滚：作业字段与 currentAction 全部恢复，绝不半写
    job.phase = prevPhase;
    job.stopReason = started.reason;
    job.currentComponentId = prevComponentId;
    job.componentPlan = prevPlan;
    job.completedComponents = prevCompleted;
    restoreIntshipAction(state, snapshot);
    uninstallIntshipProtocolConsumer();
    return { changed:false, reason:started.reason, previousStopReason:prevStopReason };
  }
  job.stopReason = null;
  job.updatedAt = at;
  state._dirty = true;
  return {
    changed:true, reason:null, protocolId:"intship",
    jobId:job.jobId, phase:job.phase, componentId:job.currentComponentId,
    batchRemaining:state.currentAction.batchRemaining, job:summarizeIntshipJob(job)
  };
}

// ---------------------------------------------------------------
// 公开 API 3/4：取消作业（已产出的组件 / 舰船保留，不回退任何已发生的制造）
//   取消不看协议开关：玩家任何时刻都必须能停下自动流程。
// ---------------------------------------------------------------
function cancelIntship(state, now) {
  if (!isValidProtocolStateShape(state)) return { changed:false, reason:INTSHIP_REASONS.INVALID_STATE };
  const at = intshipNow(now);
  const job = getIntshipJob(state);
  if (!job) return { changed:false, reason:INTSHIP_REASONS.NO_ACTIVE_JOB };
  if (job.phase === "cancelled") return { changed:false, reason:INTSHIP_REASONS.JOB_CANCELLED };
  if (job.phase === "completed") return { changed:false, reason:INTSHIP_REASONS.JOB_COMPLETED };
  const owned = intshipOwnsCurrentAction(state, job);
  if (owned) {
    state.currentAction.active = false;
    state.currentAction.batchRemaining = 0;
    state.currentAction.progress = 0;
  }
  job.phase = "cancelled";
  job.currentComponentId = null;
  job.stopReason = null;
  job.updatedAt = at;
  uninstallIntshipProtocolConsumer();
  state._dirty = true;
  return {
    changed:true, reason:null, protocolId:"intship", jobId:job.jobId,
    stoppedAction:owned, producedShips:Number(job.producedShips) || 0, job:summarizeIntshipJob(job)
  };
}

// ---------------------------------------------------------------
// 公开 API 4/4：唯一阶段推进入口
//   由 tick.js（completeQueuedActionCycle 归零后）与 offline.js（completeOfflineQueueCycles
//   归零后）各调用一次；账本此时已被幂等消费者更新完毕。
// ---------------------------------------------------------------
function advanceIntshipAfterManufacturingAction(state, context) {
  if (!isValidProtocolStateShape(state)) return { changed:false, reason:INTSHIP_REASONS.INVALID_STATE };
  const job = getIntshipJob(state);
  if (!job) return { changed:false, reason:INTSHIP_REASONS.NO_ACTIVE_JOB };
  if (!isIntshipJobActive(job)) return { changed:false, reason:INTSHIP_REASONS.JOB_NOT_RESUMABLE, phase:job.phase };
  // 先归一化时间与离线标记（必须在任何失败分支之前声明，杜绝 TDZ / ReferenceError）
  const at = intshipNow(context && context.now);
  const offline = Boolean(context && context.offline);
  // 事件总线必须在每次执行入口检查：不可用 → 统一 fail-closed（绝不抛异常）
  if (!isIntshipEventBusAvailable()) {
    return failIntshipEventBusClosed(state, job, at, offline);
  }
  if (_intshipConsumerJobId !== job.jobId) {
    const installed = installIntshipProtocolConsumer(state, job);
    if (!installed) {
      return failIntshipEventBusClosed(state, job, at, offline);
    }
  } else {
    _intshipRuntimeState = state;
  }

  // 组件阶段缺口全部补齐 → 切总装
  if (job.phase === "component" && !nextIntshipComponentId(job)) {
    job.phase = "assembly";
    job.currentComponentId = null;
  }
  // 总装数量已满 → 作业完成（绝不重复产舰）
  if (job.phase === "assembly" && (Number(job.assemblyRemaining) || 0) <= 0) {
    job.phase = "completed";
    job.currentComponentId = null;
    job.stopReason = null;
    job.updatedAt = at;
    uninstallIntshipProtocolConsumer();
    state._dirty = true;
    return { changed:true, reason:null, phase:"completed", jobId:job.jobId, offline, producedShips:Number(job.producedShips) || 0 };
  }
  const started = startIntshipPhaseAction(state, job, at);
  if (!started.started) {
    job.phase = "stopped";
    job.stopReason = started.reason;
    job.currentComponentId = (started.reason === INTSHIP_REASONS.INSUFFICIENT_MATERIALS) ? job.currentComponentId : null;
    job.updatedAt = at;
    uninstallIntshipProtocolConsumer();
    state._dirty = true;
    return { changed:true, reason:started.reason, phase:"stopped", jobId:job.jobId, offline };
  }
  job.updatedAt = at;
  state._dirty = true;
  return {
    changed:true, reason:null, phase:job.phase, jobId:job.jobId, offline,
    componentId:job.currentComponentId, batchRemaining:state.currentAction.batchRemaining
  };
}

// ---------------------------------------------------------------
// 存档恢复：importData / autoLoad 在 migrateResearchState 之后、calculateOfflineGains
// 之前各调用恰一次。活动作业重装幂等消费者；任何不匹配一律 fail closed 为
// recovery-required（宁可要求玩家手动处理，也绝不重复产舰 / 静默吞材料）。
// ---------------------------------------------------------------
function restoreIntshipProtocolRuntime(state) {
  uninstallIntshipProtocolConsumer();
  _intshipRuntimeState = isValidProtocolStateShape(state) ? state : null;
  const job = getIntshipJob(state);
  if (!job) return { changed:false, reason:INTSHIP_REASONS.NO_ACTIVE_JOB, restored:false };
  if (!isIntshipJobActive(job)) {
    // completed / cancelled / stopped / preempted / recovery-required：不装消费者、不产舰
    return { changed:false, reason:INTSHIP_REASONS.JOB_NOT_RESUMABLE, phase:job.phase, restored:false };
  }
  const recipe = getShipAssemblyRecipeById(job.recipeId);
  const shapeOk = Boolean(recipe) && recipe.shipId === job.shipId &&
    job.componentPlan && typeof job.componentPlan === "object" && !Array.isArray(job.componentPlan) &&
    job.completedComponents && typeof job.completedComponents === "object" && !Array.isArray(job.completedComponents) &&
    Array.isArray(job.processedEventIds);
  if (!shapeOk || !intshipOwnsCurrentAction(state, job)) {
    job.phase = "recovery-required";
    job.stopReason = INTSHIP_REASONS.RECOVERY_REQUIRED;
    job.currentComponentId = null;
    state._dirty = true;
    return { changed:true, reason:INTSHIP_REASONS.RECOVERY_REQUIRED, phase:"recovery-required", restored:false };
  }
  // 事件总线不可用：不得恢复生产动作（绝不"制造继续但账本不推进"）→ 统一 fail-closed，
  // 并立即停止由该作业驱动的 currentAction，绝不允许 active=true 制造动作残留。
  if (!isIntshipEventBusAvailable()) {
    return failIntshipEventBusClosed(state, job, intshipNow(null), false);
  }
  const installed = installIntshipProtocolConsumer(state, job);
  if (!installed) {
    return failIntshipEventBusClosed(state, job, intshipNow(null), false);
  }
  return { changed:false, reason:null, phase:job.phase, jobId:job.jobId, restored:true };
}

// 可造舰船清单（只读；UI 下拉唯一数据源）
function buildIntshipRecipeOptions(state) {
  if (typeof SHIP_ASSEMBLY_RECIPES === "undefined" || !Array.isArray(SHIP_ASSEMBLY_RECIPES)) return [];
  return SHIP_ASSEMBLY_RECIPES.map(recipe => {
    const gate = checkIntshipRecipeGate(state, recipe);
    return {
      recipeId: recipe.id,
      shipId: recipe.shipId,
      name: recipe.name || recipe.id,
      level: Number(recipe.level) || 1,
      buildable: gate === null,
      lockReason: gate
    };
  });
}

window.IMPLEMENTED_RESEARCH_PROTOCOLS = IMPLEMENTED_RESEARCH_PROTOCOLS;
window.ALL_RESEARCH_PROTOCOLS = ALL_RESEARCH_PROTOCOLS;
window.RESEARCH_PROTOCOL_REASONS = RESEARCH_PROTOCOL_REASONS;
window.isResearchProtocolUnlocked = isResearchProtocolUnlocked;
window.isResearchProtocolEnabled = isResearchProtocolEnabled;
window.isResearchProtocolActive = isResearchProtocolActive;
window.setResearchProtocolEnabled = setResearchProtocolEnabled;
window.setPlanetAutoRenew = setPlanetAutoRenew;
window.getResearchProtocolDisplayState = getResearchProtocolDisplayState;
window.tryPlanetAutoRenew = tryPlanetAutoRenew;
window.applyArchaeologyArtifactProtocols = applyArchaeologyArtifactProtocols;
window.setAutoEnhancementMaxAttempts = setAutoEnhancementMaxAttempts;
window.runAutoEnhancement = runAutoEnhancement;
// Batch K · intship 公开 API
window.INTSHIP_REASONS = INTSHIP_REASONS;
window.INTSHIP_MAX_QUANTITY = INTSHIP_MAX_QUANTITY;
window.getIntshipJob = getIntshipJob;
window.summarizeIntshipJob = summarizeIntshipJob;
window.buildIntshipComponentPlan = buildIntshipComponentPlan;
window.buildIntshipRecipeOptions = buildIntshipRecipeOptions;
window.intshipOwnsCurrentAction = intshipOwnsCurrentAction;
window.reconcileIntshipRuntime = reconcileIntshipRuntime;
window.startIntship = startIntship;
window.continueIntship = continueIntship;
window.cancelIntship = cancelIntship;
window.advanceIntshipAfterManufacturingAction = advanceIntshipAfterManufacturingAction;
window.restoreIntshipProtocolRuntime = restoreIntshipProtocolRuntime;
