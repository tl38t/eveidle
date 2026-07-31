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

    if (!Array.isArray(r.pendingQueue)) r.pendingQueue = [];

    if (typeof r.researchHourBank !== "number" || !isFinite(r.researchHourBank)) r.researchHourBank = 0;

    if (!r.protocolSettings || typeof r.protocolSettings !== "object" || Array.isArray(r.protocolSettings)) {
      r.protocolSettings = {};
    }
    for (const k of PROTOCOL_KEYS) {
      const cur = r.protocolSettings[k];
      if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
        r.protocolSettings[k] = (k === "autoenh") ? { enabled: false, maxAttempts: 0 } : { enabled: false };
      } else {
        if (typeof cur.enabled !== "boolean") cur.enabled = false;
        if (k === "autoenh" && typeof cur.maxAttempts !== "number") cur.maxAttempts = 0;
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
    getResearchBonusValue,
    getResearchCombinedBonus,
    getResearchMultiplier,
  };

  if (typeof window !== "undefined") window.ResearchState = ResearchState;
  if (typeof globalThis !== "undefined") globalThis.ResearchState = ResearchState;
})();
