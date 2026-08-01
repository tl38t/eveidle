// ============================================================================
//  js/core/research-state.js
//  研究系统状态层 —— 批次 A
//
//  职责（仅本批次）：
//    - 默认研究状态构造 createDefaultResearchState()
//    - 幂等迁移 migrateResearchState(state)
//    - 加成帮助函数（§5.1）：
//        getResearchBonusValue(state, group)
//        getResearchCombinedBonus(state, groups)
//        getResearchMultiplier(state, groups)
//
//  设计约束：
//    - 同类科研加成先加法汇总，再生成唯一乘子（科研内部绝不复利）。
//    - 本批次【不接入】任何正式消费点（selectors / combat-modifiers 等），
//      仅为后续批次（E/F）提供纯函数与状态构造。
//    - 不修改 state.js / persistence.js / 任何既有文件。
//
//  依赖：NODES 来自 js/data/research.js（挂到 window.ResearchData / globalThis.ResearchData）。
// ============================================================================

'use strict';

(function () {
  const RD =
    (typeof globalThis !== "undefined" && globalThis.ResearchData) ||
    (typeof window !== "undefined" && window.ResearchData) ||
    null;

  const PROTOCOL_KEYS = ["intship", "autoenh", "planauto", "autosell", "autoconv", "autorepair"];

  // -------------------------------------------------------------------------
  // 默认研究状态（schema 见 RESEARCH_SYSTEM_IMPLEMENTATION_PLAN.md §3）
  // -------------------------------------------------------------------------
  function createDefaultResearchState() {
    return {
      schemaVersion: 1,
      completedLevels: {},
      activeResearch: null,
      pendingQueue: [],
      researchHourBank: 0,
      protocolSettings: {
        intship: { enabled: false },
        autoenh: { enabled: false, maxAttempts: 0 },
        planauto: { enabled: false },
        autosell: { enabled: false },
        autoconv: { enabled: false },
        autorepair: { enabled: false },
      },
      protocolJobs: {
        intship: null,
      },
      lastProcessedAt: Date.now(),
      history: [],
      notifications: [],
    };
  }

  // -------------------------------------------------------------------------
  // Batch K · intship 一体化造船作业持久化 schema
  //   - 唯一存放位置：state.research.protocolJobs.intship（null = 无作业）
  //   - 清洗幂等：对同一对象重复调用结果完全一致；绝不新增 / 提升 schemaVersion
  //   - 非对象一律置 null；完全无可用身份信息（连旧版 blueprintId 都没有）的畸形对象归一为 null；
  //     有部分可识别身份但无法安全恢复的对象，归一为字段完整且受控的 recovery-required 作业
  //     （绝不静默按 active 继续产舰）；删除未知字段；数组 / 数值 / 布尔字段严格清洗。
  //   - quantity 上限 1000；processedEventIds 只保留最近 512 条字符串且去重。
  // -------------------------------------------------------------------------
  const INTSHIP_JOB_PHASES = ["component", "assembly", "completed", "stopped", "preempted", "cancelled", "recovery-required"];
  const INTSHIP_MAX_QUANTITY = 1000;
  const INTSHIP_MAX_EVENT_IDS = 512;
  const INTSHIP_MAX_COMPONENT_COUNT = INTSHIP_MAX_QUANTITY * 64;

  function sanitizeIntshipCountMap(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const key of Object.keys(raw)) {
      if (typeof key !== "string" || !key) continue;
      let value = Number(raw[key]);
      if (typeof raw[key] !== "number" || !isFinite(value) || !Number.isInteger(value) || value < 0) value = 0;
      if (value > INTSHIP_MAX_COMPONENT_COUNT) value = INTSHIP_MAX_COMPONENT_COUNT;
      out[key] = value;
    }
    return out;
  }

  function sanitizeIntshipJob(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const jobId = (typeof raw.jobId === "string" && raw.jobId) ? raw.jobId : "";
    const shipId = (typeof raw.shipId === "string" && raw.shipId) ? raw.shipId : "";
    const recipeId = (typeof raw.recipeId === "string" && raw.recipeId) ? raw.recipeId : "";
    const blueprintId = (typeof raw.blueprintId === "string" && raw.blueprintId) ? raw.blueprintId : "";
    // 完全无可用身份信息（连旧版 blueprintId 都没有）→ 归一为 null
    if (!jobId && !shipId && !recipeId && !blueprintId) return null;

    // 身份完整性：jobId / shipId / recipeId 三键齐备才算可安全恢复；否则归一为受控的 recovery-required
    const completeIdentity = Boolean(jobId && shipId && recipeId);
    const safeShipId = shipId || blueprintId || recipeId;
    const safeRecipeId = recipeId || blueprintId || shipId;
    const safeJobId = jobId || ("intship-legacy-" + (safeShipId || safeRecipeId || "unknown"));

    let quantity = Number(raw.quantity);
    if (typeof raw.quantity !== "number" || !isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1) quantity = 1;
    else if (quantity > INTSHIP_MAX_QUANTITY) quantity = INTSHIP_MAX_QUANTITY;

    let phase = INTSHIP_JOB_PHASES.indexOf(raw.phase) >= 0 ? raw.phase : "recovery-required";
    if (!completeIdentity) phase = "recovery-required";

    const componentPlan = sanitizeIntshipCountMap(raw.componentPlan);
    const completedComponents = sanitizeIntshipCountMap(raw.completedComponents);
    // 已完成数绝不超过计划数（防脏档凭空跳过组件阶段直接总装）
    for (const key of Object.keys(completedComponents)) {
      const need = Number(componentPlan[key]) || 0;
      if (completedComponents[key] > need) completedComponents[key] = need;
    }

    let assemblyRemaining = Number(raw.assemblyRemaining);
    if (typeof raw.assemblyRemaining !== "number" || !isFinite(assemblyRemaining) ||
        !Number.isInteger(assemblyRemaining) || assemblyRemaining < 0) assemblyRemaining = 0;
    if (assemblyRemaining > quantity) assemblyRemaining = quantity;

    let producedShips = Number(raw.producedShips);
    if (typeof raw.producedShips !== "number" || !isFinite(producedShips) ||
        !Number.isInteger(producedShips) || producedShips < 0) producedShips = 0;
    if (producedShips > quantity) producedShips = quantity;

    const currentComponentId = (typeof raw.currentComponentId === "string" && raw.currentComponentId) ? raw.currentComponentId : null;
    let stopReason = (typeof raw.stopReason === "string" && raw.stopReason) ? raw.stopReason : null;
    if (!completeIdentity) stopReason = "RECOVERY_REQUIRED";

    const ids = [];
    const seen = Object.create(null);
    if (Array.isArray(raw.processedEventIds)) {
      for (const entry of raw.processedEventIds) {
        if (typeof entry !== "string" || !entry) continue;
        if (seen[entry]) continue;
        seen[entry] = true;
        ids.push(entry);
      }
    }
    const processedEventIds = ids.length > INTSHIP_MAX_EVENT_IDS ? ids.slice(ids.length - INTSHIP_MAX_EVENT_IDS) : ids;

    let createdAt = Number(raw.createdAt);
    if (typeof raw.createdAt !== "number" || !isFinite(createdAt) || createdAt < 0) createdAt = 0;
    let updatedAt = Number(raw.updatedAt);
    if (typeof raw.updatedAt !== "number" || !isFinite(updatedAt) || updatedAt < 0) updatedAt = createdAt;

    const out = {
      jobId: safeJobId,
      shipId: safeShipId,
      recipeId: safeRecipeId,
      quantity, phase,
      componentPlan, completedComponents, currentComponentId,
      assemblyRemaining, producedShips,
      stopReason, processedEventIds, createdAt, updatedAt
    };
    // 兼容官方旧版蓝图字段（迁移保留该已知字段；其余未知字段一律删除）
    if (blueprintId) out.blueprintId = blueprintId;
    return out;
  }

  // -------------------------------------------------------------------------
  // planetary deployment 自动续费迁移（planauto 协议，§6.3）
  //   - 与 research 迁移同时触发；调用方须保证 planetary.deployments 已存在。
  //   - 每个 deployment 独立新对象（不得共享 autoRenew 引用）。
  //   - 缺失补默认；合法已有 enabled / minIskReserve 保留；非法值规范化。
  //   - 顶层 protocolSettings.planauto 只保存 enabled，不得存全局 minIskReserve
  //     （minIskReserve 始终按每基地权威，见 §6.3）。
  //   - 幂等；不依赖 research 是否存在。
  // -------------------------------------------------------------------------
  function migratePlanAutoRenew(state) {
    if (!state || typeof state !== "object") return;
    if (!state.planetary || typeof state.planetary !== "object" || !Array.isArray(state.planetary.deployments)) return;
    for (const dep of state.planetary.deployments) {
      if (!dep || typeof dep !== "object") continue;
      const prev = (dep.autoRenew && typeof dep.autoRenew === "object" && !Array.isArray(dep.autoRenew)) ? dep.autoRenew : null;
      const enabled = prev && typeof prev.enabled === "boolean" ? prev.enabled : false;
      const minIsk = (prev && typeof prev.minIskReserve === "number" && isFinite(prev.minIskReserve) && prev.minIskReserve >= 0)
        ? prev.minIskReserve : 0;
      // 每基地独立新对象（引用隔离）
      dep.autoRenew = { enabled, minIskReserve: minIsk };
    }
  }

  // -------------------------------------------------------------------------
  // 幂等迁移：补全缺字段、纠正类型、删除遗留多锚点字段（风险 12）
  //   - 无 research / 非对象            → 用默认整体替换
  //   - 各子字段缺失或类型非法         → 用默认值补全
  //   - 旧档残留 lastResearchUpdate      → 删除（研究系统只认 lastProcessedAt）
  //   - 已合法字段                       → 保留（幂等）
  // -------------------------------------------------------------------------
  function migrateResearchState(state) {
    if (!state || typeof state !== "object") return state;

    // planetary deployment 自动续费迁移（不依赖 research 是否存在）
    migratePlanAutoRenew(state);

    if (!state.research || typeof state.research !== "object") {
      state.research = createDefaultResearchState();
      return state;
    }

    const r = state.research;

    if (typeof r.schemaVersion !== "number") r.schemaVersion = 1;

    if (!r.completedLevels || typeof r.completedLevels !== "object" || Array.isArray(r.completedLevels)) {
      r.completedLevels = {};
    }

    if (r.activeResearch !== null && (typeof r.activeResearch !== "object" || Array.isArray(r.activeResearch))) {
      r.activeResearch = null;
    }
    // 现在 activeResearch 只可能是 null 或合法对象：
    //   - 删除嵌套遗留多锚点字段（研究系统只认 lastProcessedAt）
    //   - §3.1 第 8 条：techId 不在 ResearchData.NODES 中 → 清空为 null
    if (r.activeResearch && typeof r.activeResearch === "object" && !Array.isArray(r.activeResearch)) {
      if (Object.prototype.hasOwnProperty.call(r.activeResearch, "lastResearchUpdate")) {
        delete r.activeResearch.lastResearchUpdate;
      }
      const techId = r.activeResearch.techId;
      const validTech = RD && Array.isArray(RD.NODES) && RD.NODES.some((n) => n.id === techId);
      if (!validTech) {
        r.activeResearch = null;
      }
    }

    // Batch E：已投入的成就科研工时必须严格合法且不超过本步基础时长的 50%。
    //   - 非 number / NaN / Infinity / 负数 / 字符串 / 对象 / 布尔 → 0
    //   - 合法小数原样保留（不整数化）
    //   - 夹紧到 [0, 0.5 * baseDuration]；baseDuration 非法时上限视为 0
    if (r.activeResearch && typeof r.activeResearch === "object" && !Array.isArray(r.activeResearch)) {
      const ar = r.activeResearch;
      const base = ar.baseDuration;
      const cap = (typeof base === "number" && isFinite(base) && base > 0) ? base * 0.5 : 0;
      let applied = ar.appliedAchievementSeconds;
      if (typeof applied !== "number" || !isFinite(applied) || applied < 0) applied = 0;
      if (applied > cap) applied = cap;
      ar.appliedAchievementSeconds = applied;
    }

    if (!Array.isArray(r.pendingQueue)) r.pendingQueue = [];

    // Batch E：科研工时银行（秒）必须是有限非负数。
    //   字符串 / NaN / Infinity / 负数 / 对象 / 布尔 → 0；合法小数原样保留（不整数化）。
    if (typeof r.researchHourBank !== "number" || !isFinite(r.researchHourBank) || r.researchHourBank < 0) {
      r.researchHourBank = 0;
    }

    if (!r.protocolSettings || typeof r.protocolSettings !== "object" || Array.isArray(r.protocolSettings)) {
      r.protocolSettings = {};
    }
    for (const k of PROTOCOL_KEYS) {
      const cur = r.protocolSettings[k];
      if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
        r.protocolSettings[k] = (k === "autoenh") ? { enabled: false, maxAttempts: 0 } : { enabled: false };
      } else {
        if (typeof cur.enabled !== "boolean") cur.enabled = false;
        // Batch J：autoenh.maxAttempts 清洗（幂等、不新增/不改 schemaVersion）
        //   非有限/负数/小数/字符串/对象/数组/布尔 → 0；合法整数保留；超过安全上限 10000 夹紧到上限
        if (k === "autoenh") {
          let m = cur.maxAttempts;
          if (typeof m !== "number" || !isFinite(m) || !Number.isInteger(m) || m < 0) m = 0;
          else if (m > 10000) m = 10000;
          cur.maxAttempts = m;
        }
        // 顶层 protocolSettings.planauto 只保存 enabled；不得存全局 minIskReserve
        // （每基地权威配置见 §6.3，minIskReserve 按 deployment 保存）
        if (k === "planauto" && Object.prototype.hasOwnProperty.call(cur, "minIskReserve")) {
          delete cur.minIskReserve;
        }
      }
    }

    if (!r.protocolJobs || typeof r.protocolJobs !== "object" || Array.isArray(r.protocolJobs)) {
      r.protocolJobs = {};
    }
    if (!("intship" in r.protocolJobs)) r.protocolJobs.intship = null;
    // Batch K：intship 作业清洗（幂等、fail closed、不改 schemaVersion）
    r.protocolJobs.intship = sanitizeIntshipJob(r.protocolJobs.intship);

    if (typeof r.lastProcessedAt !== "number" || !isFinite(r.lastProcessedAt)) {
      r.lastProcessedAt = Date.now();
    }

    if (!Array.isArray(r.history)) r.history = [];
    if (!Array.isArray(r.notifications)) r.notifications = [];

    // 删除遗留多锚点字段（研究系统只认 lastProcessedAt，防多锚点重复推进）
    if (Object.prototype.hasOwnProperty.call(r, "lastResearchUpdate")) {
      delete r.lastResearchUpdate;
    }

    return state;
  }

  // -------------------------------------------------------------------------
  // §5.1 统一帮助函数
  //
  //  所有数值以「分数」返回（百分比 / 100），无论原 unit 是 "%" 还是 "pp"：
  //    - "%"  组：返回 fraction，供 getResearchMultiplier 生成乘子（1 + Σ）
  //    - "pp" 组：返回 fraction（= 百分点/100），供消费方作为概率增量（钳制 ≤1）
  //    - 负号组（negative）：返回正幅度 fraction，符号由消费方处理（×(1 - value)）
  // -------------------------------------------------------------------------
  function getResearchBonusValue(state, group) {
    const completed =
      state && state.research && state.research.completedLevels && typeof state.research.completedLevels === "object"
        ? state.research.completedLevels
        : {};
    const nodes = RD ? RD.NODES : [];
    let total = 0;
    for (const n of nodes) {
      if (!n.bonus || n.bonus.group !== group) continue;
      const lvl = completed[n.id] || 0;
      if (n.bonus.flat != null) {
        if (lvl >= 1) total += n.bonus.flat;
      } else {
        total += lvl * n.bonus.perLevel;
      }
    }
    return total / 100; // 统一分数化
  }

  // 同类科研加成先加法汇总（纯加法）
  function getResearchCombinedBonus(state, groups) {
    let sum = 0;
    for (const g of groups) sum += getResearchBonusValue(state, g);
    return sum;
  }

  // 唯一成乘子的位置：1 + 加法汇总值（科研内部绝不复利）
  function getResearchMultiplier(state, groups) {
    return 1 + getResearchCombinedBonus(state, groups);
  }

  // -------------------------------------------------------------------------
  // 暴露
  // -------------------------------------------------------------------------
  const ResearchState = {
    createDefaultResearchState,
    migrateResearchState,
    sanitizeIntshipJob,
    INTSHIP_JOB_PHASES,
    INTSHIP_MAX_QUANTITY,
    INTSHIP_MAX_EVENT_IDS,
    getResearchBonusValue,
    getResearchCombinedBonus,
    getResearchMultiplier,
  };

  if (typeof window !== "undefined") window.ResearchState = ResearchState;
  if (typeof globalThis !== "undefined") globalThis.ResearchState = ResearchState;
})();
