// ---- 新手引导：唯一状态 schema 与迁移（Batch O）----
// 唯一权威来源：state.tutorial。state.js 与 systems/tutorial.js 不得复制第二套默认对象。
// 迁移严格类型清洗、未知字段删除、二次幂等、不 dirty / 不 emit / 不发奖励。
(function () {
  "use strict";

  const SCHEMA_VERSION = 2;
  const TASK_STATUSES = ["locked", "active", "claimable", "completed", "legacyCompleted"];
  const BRANCH_STATUSES = ["locked", "active", "completed"];
  const VALID_TRACKS = ["laser", "missile", "cannon"];
  const EVENT_LEDGER_CAP = 1024;
  const ALLOWED_TASK_STATE_KEYS = [
    "status", "progress", "activatedAt", "completedAt",
    "rewardClaimed", "supportClaimed",
    "baseline", "instanceId", "combatRunToken", "c5Token", "c6Token",
    "wave1", "wave4", "attemptDone", "artifactFound", "artifactDisposed", "kill", "shipBuilt"
  ];
  const ALLOWED_REWARD_LEDGER_KEYS = [
    "P1","P2","P3","P4","P5","P6","P7",
    "I1","I2","I3","I4","I5","I6","I7",
    "A1","A2","A3","A4","A5","A6",
    "C1","C2","C3","C4","C5","C6",
    "recovery:emergencyCorvette"
  ];

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }
  function bool(value) {
    return value === true;
  }
  function cleanProgress(value) {
    if (!value || typeof value !== "object") return {};
    const out = {};
    for (const key of Object.keys(value)) {
      const v = value[key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
      else if (typeof v === "boolean") out[key] = v;
      else if (Array.isArray(v)) out[key] = v.filter(x => typeof x === "string");
    }
    return out;
  }
  function cleanTaskState(value, fallbackStatus) {
    const src = value && typeof value === "object" ? value : {};
    const status = TASK_STATUSES.includes(src.status) ? src.status : fallbackStatus;
    const out = {
      status,
      progress: cleanProgress(src.progress),
      activatedAt: num(src.activatedAt, 0),
      completedAt: num(src.completedAt, 0),
      rewardClaimed: bool(src.rewardClaimed),
      supportClaimed: bool(src.supportClaimed),
      baseline: Array.isArray(src.baseline) ? src.baseline.filter(x => typeof x === "string") : null,
      instanceId: typeof src.instanceId === "string" ? src.instanceId : null,
      combatRunToken: typeof src.combatRunToken === "string" ? src.combatRunToken : null,
      c5Token: typeof src.c5Token === "string" ? src.c5Token : null,
      c6Token: typeof src.c6Token === "string" ? src.c6Token : null,
      wave1: bool(src.wave1),
      wave4: bool(src.wave4),
      attemptDone: bool(src.attemptDone),
      artifactFound: bool(src.artifactFound),
      artifactDisposed: bool(src.artifactDisposed),
      kill: bool(src.kill),
      shipBuilt: bool(src.shipBuilt)
    };
    return out;
  }

  function createDefaultTutorialState() {
    const taskStateById = {};
    const tasks = (typeof TutorialData !== "undefined" && TutorialData && TutorialData.tasks) || [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const isFirst = task.id === "P1";
      taskStateById[task.id] = {
        status: isFirst ? "active" : "locked",
        progress: {},
        activatedAt: 0,
        completedAt: 0,
        rewardClaimed: false,
        supportClaimed: false,
        baseline: null,
        instanceId: null,
        combatRunToken: null,
        c5Token: null,
        c6Token: null,
        wave1: false,
        wave4: false,
        attemptDone: false,
        artifactFound: false,
        artifactDisposed: false,
        kill: false,
        shipBuilt: false
      };
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      legacy: false,
      prologueStatus: "active",
      branchStatus: { industrial: "locked", archaeology: "locked", combat: "locked" },
      taskStateById,
      selectedCombatTrack: null,
      rewardLedger: {},
      eventLedger: { processedEventIds: [] },
      emergencyShipGranted: false,
      combatRunSequence: 0,
      activeCombatRunToken: null,
      c6RunWaves: 0,
      lastReconciledAt: 0
    };
  }

  function buildLegacyState() {
    const t = createDefaultTutorialState();
    t.legacy = true;
    t.prologueStatus = "legacyCompleted";
    for (const id of ["P1","P2","P3","P4","P5","P6","P7"]) {
      if (t.taskStateById[id]) {
        t.taskStateById[id].status = "legacyCompleted";
        t.taskStateById[id].completedAt = 0;
      }
    }
    t.branchStatus = { industrial: "active", archaeology: "active", combat: "active" };
    for (const id of ["I1","A1","C1"]) {
      if (t.taskStateById[id]) {
        t.taskStateById[id].status = "active";
        t.taskStateById[id].activatedAt = 0;
      }
    }
    return t;
  }

  function cleanTutorialState(state) {
    const t = state.tutorial;
    const legacy = bool(t.legacy);
    // 权威默认态作为缺失字段基线：非 legacy 用默认态，legacy 用旧档基线态
    const base = legacy ? buildLegacyState() : createDefaultTutorialState();
    const cleaned = {
      schemaVersion: SCHEMA_VERSION,
      legacy,
      prologueStatus: ["active","completed","legacyCompleted"].includes(t.prologueStatus) ? t.prologueStatus : base.prologueStatus,
      branchStatus: {
        industrial: BRANCH_STATUSES.includes(t.branchStatus && t.branchStatus.industrial) ? t.branchStatus.industrial : base.branchStatus.industrial,
        archaeology: BRANCH_STATUSES.includes(t.branchStatus && t.branchStatus.archaeology) ? t.branchStatus.archaeology : base.branchStatus.archaeology,
        combat: BRANCH_STATUSES.includes(t.branchStatus && t.branchStatus.combat) ? t.branchStatus.combat : base.branchStatus.combat
      },
      taskStateById: {},
      selectedCombatTrack: VALID_TRACKS.includes(t.selectedCombatTrack) ? t.selectedCombatTrack : base.selectedCombatTrack,
      rewardLedger: {},
      eventLedger: { processedEventIds: [] },
      emergencyShipGranted: bool(t.emergencyShipGranted),
      combatRunSequence: num(t.combatRunSequence, base.combatRunSequence),
      activeCombatRunToken: typeof t.activeCombatRunToken === "string" ? t.activeCombatRunToken : base.activeCombatRunToken,
      c6RunWaves: num(t.c6RunWaves, base.c6RunWaves),
      lastReconciledAt: num(t.lastReconciledAt, base.lastReconciledAt)
    };
    const knownIds = (typeof TutorialData !== "undefined" && TutorialData && TutorialData.tasks)
      ? TutorialData.tasks.map(task => task.id) : [];
    const knownSet = new Set(knownIds);
    // 任务状态：既有合法 status 保留；缺失字段用 base 基线（P1 active / legacy P1-P7 legacyCompleted + I1/A1/C1 active）
    for (const id of knownIds) {
      const existing = t.taskStateById && t.taskStateById[id];
      if (existing && typeof existing === "object" && TASK_STATUSES.includes(existing.status)) {
        cleaned.taskStateById[id] = cleanTaskState(existing, base.taskStateById[id] ? base.taskStateById[id].status : "locked");
      } else {
        cleaned.taskStateById[id] = JSON.parse(JSON.stringify(base.taskStateById[id]));
      }
    }
    // 删除未知 taskId（不写入 cleaned.taskStateById）
    // rewardLedger：只保留真实 task/保险 key
    if (t.rewardLedger && typeof t.rewardLedger === "object") {
      for (const key of Object.keys(t.rewardLedger)) {
        if (ALLOWED_REWARD_LEDGER_KEYS.includes(key)) cleaned.rewardLedger[key] = t.rewardLedger[key];
      }
    }
    // eventLedger：兼容三种来源（旧数组 eventLedger / 根级 processedEventIds 错误结构 / 新 eventLedger.processedEventIds）
    // 合并、字符串过滤、去重、固定上限；删除错误的根级 processedEventIds。
    const seen = new Set();
    const merged = [];
    const pushId = (id) => {
      if (typeof id !== "string") return;
      if (seen.has(id)) return;
      seen.add(id);
      merged.push(id);
    };
    if (Array.isArray(t.eventLedger)) {
      for (const e of t.eventLedger) pushId(e);
    } else if (t.eventLedger && typeof t.eventLedger === "object" && Array.isArray(t.eventLedger.processedEventIds)) {
      for (const e of t.eventLedger.processedEventIds) pushId(e);
    }
    if (Array.isArray(t.processedEventIds)) {
      for (const e of t.processedEventIds) pushId(e);
    }
    while (merged.length > EVENT_LEDGER_CAP) merged.shift();
    cleaned.eventLedger = { processedEventIds: merged };
    state.tutorial = cleaned;
  }

  function migrateTutorialState(state, options) {
    const opts = options && typeof options === "object" ? options : {};
    const isLegacy = bool(opts.isLegacy);
    if (!state || typeof state !== "object") return state;
    if (isLegacy) {
      state.tutorial = buildLegacyState();
      return state.tutorial;
    }
    if (!state.tutorial || typeof state.tutorial !== "object") {
      state.tutorial = createDefaultTutorialState();
      return state.tutorial;
    }
    cleanTutorialState(state);
    return state.tutorial;
  }

  const TutorialState = {
    SCHEMA_VERSION,
    VALID_TRACKS,
    ALLOWED_REWARD_LEDGER_KEYS,
    createDefaultTutorialState,
    migrateTutorialState
  };

  if (typeof window !== "undefined") window.TutorialState = TutorialState;
  if (typeof globalThis !== "undefined") globalThis.TutorialState = TutorialState;
})();
