/* ================================================================
   军团与空间站系统 Phase 3C-2：三级空间站本体 + 独立建设队列
   --------------------------------------------------------------
   本阶段仅实装：
     · 三级本体升级（bodyLevel 0→1→2→3，只能顺序推进）
     · 独立建设队列 station.construction（同一时间仅一个）
   本阶段严禁：
     · 附属建筑 / 维护燃料 / 自动线 / 建筑效果 / 完整 UI / NPC 军团
   成本与时间严格取自策划案：
     · 成本 = 第六节 6.2「三阶段建设成本」本体行（不复制其他数值）
     · 时间 = 第二节 2.3（Lv.1 1h / Lv.2 2h / Lv.3 4h）
   资源寻址统一走 ResourceRegistry（currency:isk 为标量，材料走命名空间）。
   ================================================================ */

// 本体档位计划（严格对应策划 6.2 本体行 + 2.3 时间）。
// 月矿 / 气体在本体三档均为 0，故不列入 materials；仅 Lv.3 需行星材料 300（冰行星产出 = 同位素）。
const STATION_BODY_PLANS = Object.freeze({
  1: Object.freeze({
    level: 1,
    name: "空间站",
    durationMs: 3600000,          // 1h
    isk: 500000,
    materials: Object.freeze({
      "mineral:三钛合金": 1800,   // 标准钛材：16000 → 1800（降低入门门槛，目标「12h 内自动冶炼」）
      "mineral:类银超金属": 60    // 银镍合金：750 → 60
    })
  }),
  2: Object.freeze({
    level: 2,
    name: "星堡",
    durationMs: 7200000,          // 2h
    isk: 2000000,
    materials: Object.freeze({
      "mineral:三钛合金": 32000,
      "mineral:类晶体胶矿": 3200,
      "mineral:同位聚合体": 800
    })
  }),
  3: Object.freeze({
    level: 3,
    name: "星城",
    durationMs: 14400000,         // 4h
    isk: 8000000,
    materials: Object.freeze({
      "mineral:三钛合金": 55000,
      "mineral:类晶体胶矿": 4000,
      "mineral:同位聚合体": 2500,
      "mineral:超新星诺克石": 2000,
      "planetary:同位素": 300      // 策划 6.2 本体 Lv.3 行星材料 300（冰行星产出=同位素）
    })
  }),
  4: Object.freeze({
    level: 4,
    name: "深空要塞",
    durationMs: 28800000,         // 8h
    isk: 30000000,                // 星币 30M
    materials: Object.freeze({
      "mineral:三钛合金": 120000,
      "mineral:类晶体胶矿": 12000,
      "mineral:同位聚合体": 7000,
      "mineral:超新星诺克石": 4000,
      "mineral:基腹断岩": 500,
      "mineral:超噬矿": 180,
      "moon:铪": 1000,
      "moon:铷": 50,
      "gas:高纯富勒烯": 600,
      "planetary:磁场聚合物": 100
    }),
    desc: "升至深空要塞后将解锁建造「军团议事大厅」的资格（需对应内容授权）。"
  }),
  5: Object.freeze({
    level: 5,
    name: "星域枢纽",
    durationMs: 57600000,         // 16h
    isk: 100000000,               // 星币 100M
    materials: Object.freeze({
      "mineral:三钛合金": 250000,
      "mineral:类晶体胶矿": 25000,
      "mineral:同位聚合体": 15000,
      "mineral:超新星诺克石": 9000,
      "mineral:基腹断岩": 1200,
      "mineral:超噬矿": 500,
      "moon:铷": 150,
      "mineral:莫尔石": 25,
      "gas:超纯聚合气体": 30,
      "planetary:磁场聚合物": 300
    }),
    desc: "升至星域枢纽后军团议事大厅可升至满级（需对应内容授权）。"
  })
});

// 本体绝对等级上限（迁移/完成校验用的硬上限）。实际可建上限由 DLC 决定：
// 无 DLC → 3（见 getStationMaxBodyLevel）；有 DLC → 5。
const STATION_MAX_BODY_LEVEL = 5;

// 本体等级 → 中文名（0 = 尚未建造）。
function getStationBodyName(level) {
  const lvl = Math.floor(Number(level));
  if (!Number.isFinite(lvl) || lvl <= 0) return "未建造";
  const plan = STATION_BODY_PLANS[lvl];
  return plan ? plan.name : "未知";
}

// 生成成本快照（仅用于审计 / 显示，完成时绝不据此再次扣费）。
function buildStationCostSnapshot(plan) {
  const materials = {};
  for (const [reference, quantity] of Object.entries(plan.materials || {})) materials[reference] = quantity;
  const snap = { isk: plan.isk, materials };
  const lp = Number(plan.lp) || 0;
  if (lp > 0) snap.lp = lp;
  return snap;
}

// 事件派发：统一带 source=station 与 offline 语义（在线/离线一致）。
function emitStationEvent(type, payload, meta) {
  if (typeof GameEvents !== "undefined" && GameEvents && typeof GameEvents.emit === "function") {
    GameEvents.emit(type, payload, Object.assign({ source: "station" }, meta || {}));
  }
}

/* ----------------------------------------------------------------
   统一入口：开工本体建设（station/startBodyConstruction 语义）
   契约：
     · 目标等级 = 当前 +1；顺序推进（0→1→2→3），Lv.3 后返回 max-level
     · 同一时间仅一个 construction；已有施工 → construction-in-progress
     · 从档位计划读成本 / durationMs（不在此复制成本）
     · 完整校验（ISK + 每种材料）后一次性原子扣费；任一不足 → 不扣任何资源、
       construction 不变、bodyLevel 不变，返回明确 reason
     · 开工即支付；完成不重复扣费；不提供取消 / 退款
   返回：{ changed:boolean, reason?:string, targetLevel?, startedAt?, completesAt?, durationMs?, costSnapshot? }
   nowOverride：可选，供测试注入确定性 startedAt（生产环境不传，用 Date.now()）
   ---------------------------------------------------------------- */
/* ----------------------------------------------------------------
   研究批次 G · build 组：建设工程科研提速
   真实建设时长 = plan.durationMs ÷ getResearchMultiplier(state, ["build"])
   主体开工 / 建筑开工 / 页面预览三处共用此唯一入口，禁止在别处再算一遍。
   注意：不叠加进 getStationBuildingSpeedMultiplier（那是自动线的建筑倍率，与建设无关）。
   ---------------------------------------------------------------- */
function getStationConstructionDurationMs(state, plan) {
  const base = plan ? Number(plan.durationMs) : NaN;
  if (!Number.isFinite(base) || base <= 0) return 0;
  let mult = (typeof ResearchState !== "undefined") ? Number(ResearchState.getResearchMultiplier(state, ["build"])) : 1;
  if (!Number.isFinite(mult) || mult <= 0) mult = 1;
  return Math.max(1, Math.round(base / mult));
}

function startStationBodyConstruction(state, nowOverride) {
  if (!state || typeof state !== "object") return { changed: false, reason: "invalid-state" };
  const s = state.station;
  if (!s || typeof s !== "object") return { changed: false, reason: "no-station" };

  // 同一时间仅一个 construction
  if (s.construction) return { changed: false, reason: "construction-in-progress" };

  const currentLevel = Math.floor(Number(s.bodyLevel)) || 0;
  if (currentLevel >= getStationMaxBodyLevel(state)) return { changed: false, reason: "max-level" };

  const targetLevel = currentLevel + 1;
  const plan = STATION_BODY_PLANS[targetLevel];
  if (!plan) return { changed: false, reason: "no-plan" }; // 理论不可达（0<current<3 保证有 plan）

  // 预校验：ISK 与每种材料充足（此步骤不产生任何副作用）
  if (ResourceRegistry.get(state, "currency:isk") < plan.isk) return { changed: false, reason: "insufficient-isk" };
  if (!ResourceRegistry.canAffordCost(state, plan.materials)) return { changed: false, reason: "insufficient-materials" };

  // 原子扣费：两项均已预校验通过，保证均成功（ISK 标量 + 材料命名空间）。
  ResourceRegistry.spend(state, "currency:isk", plan.isk);
  ResourceRegistry.spendCost(state, plan.materials);

  const startedAt = Number.isFinite(Number(nowOverride)) ? Number(nowOverride) : Date.now();
  const durationMs = getStationConstructionDurationMs(state, plan);
  const completesAt = startedAt + durationMs;
  const costSnapshot = buildStationCostSnapshot(plan);

  s.construction = {
    kind: "body",
    targetLevel: targetLevel,
    startedAt: startedAt,
    completesAt: completesAt,
    durationMs: durationMs,
    paid: true,
    costSnapshot: costSnapshot
  };
  state._dirty = true;

  emitStationEvent("station:constructionStarted", {
    kind: "body",
    fromLevel: currentLevel,
    targetLevel: targetLevel,
    startedAt: startedAt,
    completesAt: completesAt,
    durationMs: durationMs,
    costSnapshot: costSnapshot
  }, { offline: false });

  return { changed: true, targetLevel, startedAt, completesAt, durationMs, costSnapshot };
}

/* ----------------------------------------------------------------
   唯一完成函数：在线 tick 与离线结算共用（同一逻辑，避免二次实现分叉）。
   契约：
     · 仅当 Date.now() >= completesAt 时恰好完成一次
     · bodyLevel 更新为 targetLevel；construction 清空
     · 派发 station:constructionCompleted + station:bodyUpgraded（在线/离线语义一致）
     · 连续调用不重复完成（construction 已清空即返回 no-construction）
     · fail closed：paid!==true / kind 非 body / targetLevel 越界 / 时间戳损坏
       （completesAt<=startedAt 或 NaN）→ 一律不升级（不免费升级）
     · 目标 != 当前+1（跳级/降级/已升过，仅可能来自被篡改存档）→ 清空该非法施工、不升级
   meta.offline：true=离线结算 / false=在线 tick，仅影响事件 meta 与返回标记。
   ---------------------------------------------------------------- */
function completeStationConstruction(state, meta) {
  if (!state || typeof state !== "object") return { changed: false, reason: "invalid-state" };
  const s = state.station;
  if (!s || typeof s !== "object") return { changed: false, reason: "no-station" };
  const c = s.construction;
  if (!c || typeof c !== "object") return { changed: false, reason: "no-construction" };

  const offline = !!(meta && meta.offline);

  // fail closed：仅处理已支付、结构完整（kind 为 body 或 building）的施工
  if (c.paid !== true || (c.kind !== "body" && c.kind !== "building")) return { changed: false, reason: "invalid-construction" };

  const targetLevel = Math.floor(Number(c.targetLevel));
  const startedAt = Number(c.startedAt);
  const completesAt = Number(c.completesAt);
  if (!Number.isFinite(targetLevel) || targetLevel < 1 || targetLevel > STATION_MAX_BODY_LEVEL) {
    return { changed: false, reason: "invalid-target" };
  }
  // 时间戳损坏 → fail closed（不免费升级），保留施工交由迁移层清理，不在此扣/退
  if (!Number.isFinite(startedAt) || startedAt < 0) return { changed: false, reason: "invalid-timestamp" };
  if (!Number.isFinite(completesAt) || completesAt <= startedAt) return { changed: false, reason: "invalid-timestamp" };

  // 时间闸门：必须真正到期才完成
  if (!(Date.now() >= completesAt)) return { changed: false, reason: "not-yet" };

  const costSnapshot = c.costSnapshot || null;

  // ---- 本体施工（body）----
  if (c.kind === "body") {
    const currentLevel = Math.floor(Number(s.bodyLevel)) || 0;
    // 目标必须严格 = 当前+1（防跳级/降级/重复升级）；否则该施工非法 → 清空、不升级
    if (targetLevel !== currentLevel + 1) {
      s.construction = null;
      state._dirty = true;
      return { changed: false, reason: "level-mismatch" };
    }
    const fromLevel = currentLevel;
    s.bodyLevel = targetLevel;
    s.construction = null;
    state._dirty = true;

    emitStationEvent("station:constructionCompleted", {
      kind: "body",
      fromLevel: fromLevel,
      targetLevel: targetLevel,
      startedAt: startedAt,
      completesAt: completesAt,
      costSnapshot: costSnapshot
    }, { offline: offline });

    emitStationEvent("station:bodyUpgraded", {
      fromLevel: fromLevel,
      toLevel: targetLevel,
      startedAt: startedAt,
      completesAt: completesAt,
      costSnapshot: costSnapshot
    }, { offline: offline });

    return { changed: true, kind: "body", fromLevel, toLevel: targetLevel, offline };
  }

  // ---- 附属建筑施工（building）----
  const buildingId = c.buildingId;
  if (!STATION_BUILDING_ID_LIST.includes(buildingId)) {
    s.construction = null;
    state._dirty = true;
    return { changed: false, reason: "invalid-building" };
  }
  const currentLevel = Math.floor(Number(s.buildings[buildingId])) || 0;
  // 目标必须严格 = 当前+1（防跳级/降级/重复升级）；否则该施工非法 → 清空、不升级
  if (targetLevel !== currentLevel + 1) {
    s.construction = null;
    state._dirty = true;
    return { changed: false, reason: "level-mismatch" };
  }
  const fromLevel = currentLevel;
  s.buildings[buildingId] = targetLevel;
  s.construction = null;
  state._dirty = true;

  emitStationEvent("station:constructionCompleted", {
    kind: "building",
    buildingId: buildingId,
    fromLevel: fromLevel,
    targetLevel: targetLevel,
    startedAt: startedAt,
    completesAt: completesAt,
    costSnapshot: costSnapshot
  }, { offline: offline });

  emitStationEvent("station:buildingUpgraded", {
    buildingId: buildingId,
    fromLevel: fromLevel,
    toLevel: targetLevel,
    startedAt: startedAt,
    completesAt: completesAt,
    costSnapshot: costSnapshot
  }, { offline: offline });

  return { changed: true, kind: "building", buildingId, fromLevel, toLevel: targetLevel, offline };
}

/* ----------------------------------------------------------------
   最小纯显示态（仅供审计 / 后续 UI 调用；本阶段不新增正式页面）。
   保证所有字段非 undefined / 非 NaN；缺失值统一用 null / 0。
   ---------------------------------------------------------------- */
function getStationBodyDisplayState(state, now) {
  const s = (state && typeof state === "object" && state.station && typeof state.station === "object") ? state.station : null;
  const bodyLevel = s ? (Math.floor(Number(s.bodyLevel)) || 0) : 0;
  const bodyName = getStationBodyName(bodyLevel);
  const atMax = bodyLevel >= getStationMaxBodyLevel(state);

  const nextLevel = atMax ? null : bodyLevel + 1;
  const nextPlan = nextLevel ? STATION_BODY_PLANS[nextLevel] : null;
  const nextName = nextPlan ? nextPlan.name : null;
  const nextDesc = nextPlan ? (nextPlan.desc || null) : null;
  const nextCost = nextPlan ? buildStationCostSnapshot(nextPlan) : null;

  const rawC = (s && s.construction) ? s.construction : null;
  let currentConstruction = null;
  let remainingMs = 0;
  let progress = 0;
  if (rawC) {
    const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const startedAt = Number(rawC.startedAt) || 0;
    const completesAt = Number(rawC.completesAt) || 0;
    const total = Math.max(1, Number(rawC.durationMs) || (completesAt - startedAt) || 1);
    remainingMs = Math.max(0, completesAt - nowMs);
    const elapsed = Math.max(0, Math.min(total, nowMs - startedAt));
    progress = Math.max(0, Math.min(1, elapsed / total));
    if (rawC.kind === "building") {
      const bid = rawC.buildingId;
      currentConstruction = {
        kind: "building",
        buildingId: bid,
        buildingName: STATION_BUILDING_NAMES[bid] || bid,
        targetLevel: Math.floor(Number(rawC.targetLevel)) || 0,
        startedAt: startedAt,
        completesAt: completesAt,
        durationMs: Math.floor(Number(rawC.durationMs)) || 0
      };
    } else {
      currentConstruction = {
        kind: "body",
        targetLevel: Math.floor(Number(rawC.targetLevel)) || 0,
        targetName: getStationBodyName(rawC.targetLevel),
        startedAt: startedAt,
        completesAt: completesAt,
        durationMs: Math.floor(Number(rawC.durationMs)) || 0
      };
    }
  }

  let canStart = false;
  let blockedReason = null;
  if (!s) {
    blockedReason = "no-station";
  } else if (rawC) {
    blockedReason = "construction-in-progress";
  } else if (atMax) {
    blockedReason = "max-level";
  } else if (ResourceRegistry.get(state, "currency:isk") < nextPlan.isk) {
    blockedReason = "insufficient-isk";
  } else if (!ResourceRegistry.canAffordCost(state, nextPlan.materials)) {
    blockedReason = "insufficient-materials";
  } else {
    canStart = true;
  }

  return {
    bodyLevel: bodyLevel,
    bodyName: bodyName,
    nextLevel: nextLevel,
    nextName: nextName,
    nextDesc: nextDesc,
    currentConstruction: currentConstruction,
    remainingMs: remainingMs,
    progress: progress,
    nextCost: nextCost,
    canStart: canStart,
    blockedReason: blockedReason
  };
}

/* ----------------------------------------------------------------
   Phase 3C-4：八附属建筑框架 + 资源调度中心 + 行星管控中心
   ----------------------------------------------------------------
   建筑 ID 稳定列表（优先复用 state.js 的 STATION_BUILDING_IDS，避免跨文件
   const TDZ 在加载期引用；此处本地兜底保证 station.js 独立可用）。
   七座建筑「每座三级成本相同」（策划 6.2 单座表），分级成本表对这七座共用；
   冶炼精炼厂 Lv.1 为「12h 内自动冶炼」目标使用专属覆盖（见下方 STATION_BUILDING_PLANS），
   移除镓/气体/行星材料、仅保留标准钛材+银镍合金，故并非八座建筑完全共用同一套 Lv.1 成本。
   ---------------------------------------------------------------- */
const STATION_BUILDING_ID_LIST = (typeof STATION_BUILDING_IDS !== "undefined" && Array.isArray(STATION_BUILDING_IDS))
  ? STATION_BUILDING_IDS
  : ["resource_dispatch", "planetary_control", "smelting_refinery", "equipment_factory", "booster_factory", "archaeology_lab", "combat_command", "shipyard"];

const STATION_BUILDING_NAMES = Object.freeze({
  resource_dispatch: "资源调度中心",
  planetary_control: "行星管控中心",
  smelting_refinery: "冶炼精炼厂",
  equipment_factory: "装备制造厂",
  booster_factory: "增强剂制造厂",
  archaeology_lab: "考古实验室",
  combat_command: "作战指挥中心",
  shipyard: "舰船船坞"
});

const STATION_MAX_BUILDING_LEVEL = 5;

// 单座建筑分级成本（严格取自策划 6.2 单座建筑表；时间取自 2.3 节 15min/30min/1h）。
// 行星材料按用户决策「严格按阶段总表拆分」：
//   Lv.1 = 同位素38 + 生物质25（合计63）、Lv.2 = 等离子体25、Lv.3 = 磁场聚合物24
// 资源寻址统一走 ResourceRegistry 命名空间：mineral: / moon: / gas: / planetary:
const STATION_BUILDING_LEVEL_PLANS = Object.freeze({
  1: Object.freeze({
    level: 1,
    durationMs: 900000, // 15min
    isk: 50000,
    materials: Object.freeze({
      "mineral:三钛合金": 2500,
      "mineral:类银超金属": 94,
      "moon:镓": 125,
      "gas:稳定富勒烯": 150,
      "planetary:同位素": 38,
      "planetary:生物质": 25
    })
  }),
  2: Object.freeze({
    level: 2,
    durationMs: 1800000, // 30min
    isk: 250000,
    materials: Object.freeze({
      "mineral:三钛合金": 5000,
      "mineral:类晶体胶矿": 410,
      "mineral:同位聚合体": 63,
      "moon:铂": 350,
      "gas:稳定富勒烯": 150,
      "planetary:等离子体": 25
    })
  }),
  3: Object.freeze({
    level: 3,
    durationMs: 3600000, // 1h
    isk: 500000,
    materials: Object.freeze({
      "mineral:三钛合金": 5000,
      "mineral:类晶体胶矿": 500,
      "mineral:同位聚合体": 312,
      "mineral:超新星诺克石": 250,
      "mineral:基腹断岩": 125,
      "mineral:超噬矿": 62,
      "moon:铪": 375,
      "gas:高纯富勒烯": 250,
      "planetary:磁场聚合物": 24
    })
  }),
  // 公共建筑 Lv.4 / Lv.5（军团 DLC 扩展；每座共用同一套分级成本，冶炼精炼厂 Lv.1 仍用专属覆盖）。
  // ⚠️ 材料单调性：Lv.4 基腹断岩 = 200（非 100），否则相对 Lv.3 的 125 出现材料倒挂（违反「每级材料 ≥ 上一级」）。
  4: Object.freeze({
    level: 4,
    durationMs: 7200000, // 2h
    isk: 2000000,
    materials: Object.freeze({
      "mineral:三钛合金": 12000,
      "mineral:类晶体胶矿": 2000,
      "mineral:同位聚合体": 1000,
      "mineral:超新星诺克石": 600,
      "mineral:基腹断岩": 200,   // MUST be 200（材料倒挂修复点）
      "mineral:超噬矿": 70,      // ≥ Lv.3 的 62，保持每档材料单调递增
      "moon:铪": 500,
      "gas:高纯富勒烯": 300,
      "planetary:磁场聚合物": 50
    })
  }),
  5: Object.freeze({
    level: 5,
    durationMs: 14400000, // 4h
    isk: 8000000,
    materials: Object.freeze({
      "mineral:三钛合金": 30000,
      "mineral:类晶体胶矿": 5000,
      "mineral:同位聚合体": 2500,
      "mineral:超新星诺克石": 1500,
      "mineral:基腹断岩": 300,
      "mineral:超噬矿": 120,
      "moon:铷": 50,
      "mineral:莫尔石": 5,
      "gas:超纯聚合气体": 10,
      "planetary:磁场聚合物": 120
    })
  })
});

// 精炼厂（smelting_refinery）Lv.1 专属成本：降低入门门槛，移除镓 / 气体 / 行星材料，
// 仅保留「标准钛材 + 银镍合金」两项。其余七座建筑与全部 Lv.2/Lv.3 仍沿用共享 STATION_BUILDING_LEVEL_PLANS。
// ⚠️ 扣费 / 显示态 / 成本预览统一读取 STATION_BUILDING_PLANS[buildingId][level]；
//    startStationBuildingConstruction 也读此处，不要在别处复制第二套成本判断。
const STATION_SMELTING_REFINERY_LV1_PLAN = Object.freeze({
  level: 1,
  durationMs: 900000,          // 15min（与共享 Lv.1 施工时间一致）
  isk: 50000,
  materials: Object.freeze({
    "mineral:三钛合金": 400,    // 标准钛材：2500 → 400
    "mineral:类银超金属": 20    // 银镍合金：94 → 20
  })
});

// 军团议事大厅（legion_hall）分级成本表：专属覆盖（含功勋 lp 消耗 + 不同材料配比）。
// 解锁门槛在 startStationBuildingConstruction / 显示态 中统一判定：
//   · 必须持有 DLC（state.station.dlc.npcWorkers 或 state.corporation.dlc.npcWorkers）
//   · Hall Lv1 需本体 ≥ Lv2；Hall Lv2~Lv5 受「建筑等级 ≤ 本体等级」通用门槛约束
// 功勋 = currency:lp（标量货币），随 ISK + 材料一次性原子扣减。
const STATION_LEGION_HALL_PLANS = Object.freeze({
  1: Object.freeze({
    level: 1,
    durationMs: 7200000,          // 2h
    isk: 3000000,                 // 星币 3M
    lp: 100,                      // 功勋 100
    materials: Object.freeze({
      "mineral:三钛合金": 25000,
      "mineral:类晶体胶矿": 2500,
      "mineral:同位聚合体": 800,
      "mineral:超新星诺克石": 300,
      "moon:铂": 500,
      "gas:稳定富勒烯": 300,
      "planetary:同位素": 100
    })
  }),
  2: Object.freeze({
    level: 2,
    durationMs: 14400000,         // 4h
    isk: 6000000,                 // 星币 6M
    lp: 250,                      // 功勋 250
    materials: Object.freeze({
      "mineral:三钛合金": 40000,
      "mineral:类晶体胶矿": 4000,
      "mineral:同位聚合体": 1500,
      "mineral:超新星诺克石": 800,
      "moon:铪": 600,
      "gas:高纯富勒烯": 300,
      "planetary:磁场聚合物": 50
    })
  }),
  3: Object.freeze({
    level: 3,
    durationMs: 28800000,         // 8h
    isk: 15000000,                // 星币 15M
    lp: 500,                      // 功勋 500
    materials: Object.freeze({
      "mineral:三钛合金": 70000,
      "mineral:类晶体胶矿": 6000,
      "mineral:同位聚合体": 3000,
      "mineral:超新星诺克石": 1500,
      "mineral:基腹断岩": 300,
      "moon:铪": 1000,
      "moon:铷": 30,
      "gas:高纯富勒烯": 600,
      "planetary:磁场聚合物": 120
    })
  }),
  4: Object.freeze({
    level: 4,
    durationMs: 43200000,         // 12h
    isk: 35000000,                // 星币 35M
    lp: 1000,                     // 功勋 1000
    materials: Object.freeze({
      "mineral:三钛合金": 120000,
      "mineral:类晶体胶矿": 10000,
      "mineral:同位聚合体": 5000,
      "mineral:超新星诺克石": 3000,
      "mineral:基腹断岩": 700,
      "mineral:超噬矿": 250,
      "moon:铷": 80,
      "gas:聚合气体": 1000,
      "planetary:磁场聚合物": 200
    })
  }),
  5: Object.freeze({
    level: 5,
    durationMs: 86400000,         // 24h
    isk: 80000000,                // 星币 80M
    lp: 2000,                     // 功勋 2000
    materials: Object.freeze({
      "mineral:三钛合金": 200000,
      "mineral:类晶体胶矿": 18000,
      "mineral:同位聚合体": 10000,
      "mineral:超新星诺克石": 6000,
      "mineral:基腹断岩": 1200,
      "mineral:超噬矿": 500,
      "moon:铷": 150,
      "mineral:莫尔石": 15,
      "gas:超纯聚合气体": 25,
      "planetary:磁场聚合物": 400
    })
  })
});

// 八建筑分级成本表：默认共用 STATION_BUILDING_LEVEL_PLANS；精炼厂 Lv.1 以专属计划覆盖（其余等级不变）。
// legion_hall 走专属 STATION_LEGION_HALL_PLANS（含功勋成本）。
const STATION_BUILDING_PLANS = Object.freeze(
  Object.fromEntries(STATION_BUILDING_ID_LIST.map(id => [id,
    id === "smelting_refinery"
      ? Object.freeze({ 1: STATION_SMELTING_REFINERY_LV1_PLAN, 2: STATION_BUILDING_LEVEL_PLANS[2], 3: STATION_BUILDING_LEVEL_PLANS[3], 4: STATION_BUILDING_LEVEL_PLANS[4], 5: STATION_BUILDING_LEVEL_PLANS[5] })
      : id === "legion_hall"
      ? STATION_LEGION_HALL_PLANS
      : STATION_BUILDING_LEVEL_PLANS
  ]))
);

function getStationBuildingLevel(state, buildingId) {
  const s = state && state.station;
  if (!s || !s.buildings || !STATION_BUILDING_ID_LIST.includes(buildingId)) return 0;
  const lvl = Math.floor(Number(s.buildings[buildingId]));
  return Number.isFinite(lvl) && lvl >= 0 && lvl <= STATION_MAX_BUILDING_LEVEL ? lvl : 0;
}

/* ----------------------------------------------------------------
   开工附属建筑（station/startBuildingConstruction 语义）
   契约（与本体建设队列同构，单队列共用 station.construction）：
     · 目标等级 = 当前 +1；顺序推进（0→1→2→3），Lv.3 后返回 max-level
     · 建筑等级 ≤ 本体等级（targetLevel > bodyLevel → body-level-cap）
     · 同一时间仅一个 construction（含本体/建筑，均占用队列）→ construction-in-progress
     · 完整校验（ISK + 每种材料）后一次性原子扣费；任一不足 → 不扣任何资源
     · 开工即支付；完成不重复扣费；不提供取消 / 退款
   返回：{ changed, buildingId?, targetLevel?, startedAt?, completesAt?, durationMs?, costSnapshot? }
   ---------------------------------------------------------------- */
function startStationBuildingConstruction(state, buildingId, nowOverride) {
  if (!state || typeof state !== "object") return { changed: false, reason: "invalid-state" };
  const s = state.station;
  if (!s || typeof s !== "object") return { changed: false, reason: "no-station" };
  if (!STATION_BUILDING_ID_LIST.includes(buildingId)) return { changed: false, reason: "unknown-building" };
  if (s.construction) return { changed: false, reason: "construction-in-progress" };

  const bodyLevel = Math.floor(Number(s.bodyLevel)) || 0;
  const currentLevel = getStationBuildingLevel(state, buildingId);
  if (currentLevel >= STATION_MAX_BUILDING_LEVEL) return { changed: false, reason: "max-level" };

  const targetLevel = currentLevel + 1;

  // ⚠️ DLC 授权门禁当前未实际生效（接口 getStationDlcNpcWorkers 保留，待接入）。
  // 原「legion_hall 需 DLC」「targetLevel>=4 需 DLC」两道 dlc-required 拦截已暂时移除，
  // 改由本体/建筑等级上限与下方通用 body-level-cap 约束 Lv4/Lv5 与大厅的可建性。
  // 军团议事大厅 Lv1 需本体 ≥ Lv2（Lv2~Lv5 的本体门槛由下方通用 body-level-cap 统一约束）。
  if (buildingId === "legion_hall" && targetLevel === 1 && bodyLevel < 2) {
    return { changed: false, reason: "body-level-cap" };
  }
  if (targetLevel > bodyLevel) return { changed: false, reason: "body-level-cap" };

  const plan = STATION_BUILDING_PLANS[buildingId] && STATION_BUILDING_PLANS[buildingId][targetLevel];
  if (!plan) return { changed: false, reason: "no-plan" };

  // 预校验：ISK + 功勋(lp) + 每种材料（均不产生副作用）
  if (ResourceRegistry.get(state, "currency:isk") < plan.isk) return { changed: false, reason: "insufficient-isk" };
  const lpCost = Number(plan.lp) || 0;
  if (lpCost > 0 && ResourceRegistry.get(state, "currency:lp") < lpCost) return { changed: false, reason: "insufficient-lp" };
  if (!ResourceRegistry.canAffordCost(state, plan.materials)) return { changed: false, reason: "insufficient-materials" };

  // 原子扣费：三项均已预校验通过，保证均成功（ISK 标量 + 功勋标量 + 材料命名空间）
  ResourceRegistry.spend(state, "currency:isk", plan.isk);
  if (lpCost > 0) ResourceRegistry.spend(state, "currency:lp", lpCost);
  ResourceRegistry.spendCost(state, plan.materials);

  const startedAt = Number.isFinite(Number(nowOverride)) ? Number(nowOverride) : Date.now();
  const durationMs = getStationConstructionDurationMs(state, plan);
  const completesAt = startedAt + durationMs;
  const costSnapshot = buildStationCostSnapshot(plan);

  s.construction = {
    kind: "building",
    buildingId: buildingId,
    targetLevel: targetLevel,
    startedAt: startedAt,
    completesAt: completesAt,
    durationMs: durationMs,
    paid: true,
    costSnapshot: costSnapshot
  };
  state._dirty = true;

  emitStationEvent("station:constructionStarted", {
    kind: "building",
    buildingId: buildingId,
    fromLevel: currentLevel,
    targetLevel: targetLevel,
    startedAt: startedAt,
    completesAt: completesAt,
    durationMs: durationMs,
    costSnapshot: costSnapshot
  }, { offline: false });

  return { changed: true, buildingId, targetLevel, startedAt, completesAt, durationMs, costSnapshot };
}

/* ----------------------------------------------------------------
   资源调度中心（Resource Dispatch Center）— 勘探指令
   每 20/14/10/9/8 次真实采矿/采气行动，额外获得 1 次产出（不增 XP）。
   计数器入 station.dispatch（miningCount / gasCount），切换矿带/气体带清零。
   ---------------------------------------------------------------- */
function getStationDispatchThreshold(state) {
  const lvl = getStationBuildingLevel(state, "resource_dispatch");
  if (lvl >= 5) return 8;
  if (lvl === 4) return 9;
  if (lvl === 3) return 10;
  if (lvl === 2) return 14;
  if (lvl === 1) return 20;
  return 0;
}

// 累加一次真实采集行动（cycles 通常=1，离线可批量）；返回应额外发放的产出次数（已原子扣减阈值）。
function recordStationDispatchAction(state, kind, cycles) {
  if (!isStationOperational(state)) {
    // 断油期间不积累也不发放调度奖励，冻结计数器
    return 0;
  }
  const threshold = getStationDispatchThreshold(state);
  if (threshold <= 0 || !cycles || cycles < 1) return 0;
  const s = state.station;
  if (!s.dispatch) s.dispatch = { miningCount: 0, gasCount: 0 };
  const key = (kind === "gas") ? "gasCount" : "miningCount";
  s.dispatch[key] = (Number(s.dispatch[key]) || 0) + cycles;
  let bonus = 0;
  if (s.dispatch[key] >= threshold) {
    bonus = Math.floor(s.dispatch[key] / threshold);
    s.dispatch[key] -= bonus * threshold;
  }
  state._dirty = true;
  return bonus;
}

// 切换矿带/气体带时清零对应累计次数（保留另一类）。
function resetStationDispatchCounters(state, kind) {
  const s = state && state.station;
  if (!s || !s.dispatch) return;
  if (!kind || kind === "mining") s.dispatch.miningCount = 0;
  if (!kind || kind === "gas") s.dispatch.gasCount = 0;
  state._dirty = true;
}

/* ----------------------------------------------------------------
   行星管控中心（Planetary Control Center）
     · Lv.1 启用行星自动收取（装满即收：本地仓储达 6h 上限时移入库存并清零，不自动续期）
     · Lv.2/3/4/5 额外 +1/+2/+3/+4 行星槽位（与脑插同乘区，同步突破硬上限 5，即上限=5+加成）
   ---------------------------------------------------------------- */
function getStationPlanetarySlotBonus(state) {
  const lvl = getStationBuildingLevel(state, "planetary_control");
  if (lvl >= 5) return 4;
  if (lvl === 4) return 3;
  if (lvl === 3) return 2;
  if (lvl === 2) return 1;
  return 0;
}

function getStationAutoCollectEnabled(state) {
  return getStationBuildingLevel(state, "planetary_control") >= 1;
}

// 行星自动收取：storage>=storageMax 时移入库存并清零本地仓储；返回收取数量（0 表示未触发）。
// offline=true 时事件带 offline 语义（同一逻辑，在线/离线一致）。
function applyStationAutoCollect(state, deployment, storageMax, offline) {
  if (!getStationAutoCollectEnabled(state) || !isStationOperational(state)) return 0;
  const storage = Number(deployment.storage) || 0;
  if (storage < storageMax) return 0;
  const config = (typeof PLANET_TYPES !== "undefined") ? PLANET_TYPES.find(planet => planet.id === deployment.planetType) : null;
  const resourceId = "planetary:" + (config ? config.output : deployment.planetType);
  ResourceRegistry.add(state, resourceId, storage);
  deployment.storage = 0;
  deployment.progress = 0;
  state._dirty = true;
  if (typeof GameEvents !== "undefined" && GameEvents && typeof GameEvents.emit === "function") {
    const payload = { deploymentId: deployment.id, planetType: deployment.planetType, resourceId, quantity: storage };
    if (offline && typeof emitOfflineGameEvent === "function") emitOfflineGameEvent("planetary:collected", payload);
    else GameEvents.emit("planetary:collected", payload, { source: "station", offline: Boolean(offline) });
  }
  return storage;
}

/* ----------------------------------------------------------------
   建筑显示态（仅供审计 / 后续 UI 调用；保证所有字段非 undefined / 非 NaN）。
   ---------------------------------------------------------------- */
function getStationBuildingDisplayState(state, buildingId) {
  const s = (state && typeof state === "object" && state.station && typeof state.station === "object") ? state.station : null;
  if (!s || !STATION_BUILDING_ID_LIST.includes(buildingId)) return null;
  const level = getStationBuildingLevel(state, buildingId);
  const name = STATION_BUILDING_NAMES[buildingId] || buildingId;
  const atMax = level >= STATION_MAX_BUILDING_LEVEL;
  const bodyLevel = Math.floor(Number(s.bodyLevel)) || 0;
  const nextLevel = atMax ? null : level + 1;
  const nextPlan = nextLevel ? (STATION_BUILDING_PLANS[buildingId] && STATION_BUILDING_PLANS[buildingId][nextLevel]) : null;
  const nextCost = nextPlan ? buildStationCostSnapshot(nextPlan) : null;

  const isConstructingThis = !!(s.construction && s.construction.kind === "building" && s.construction.buildingId === buildingId);

  let canUpgrade = false, blockedReason = null;
  if (isConstructingThis) blockedReason = "construction-in-progress";
  else if (atMax) blockedReason = "max-level";
  // ⚠️ DLC 门禁未生效：原 legion_hall dlc-required 分支已移除（见 startStationBuildingConstruction）。
  else if (buildingId === "legion_hall" && nextLevel === 1 && bodyLevel < 2) blockedReason = "body-level-cap";
  else if (nextLevel > bodyLevel) blockedReason = "body-level-cap";
  else if (ResourceRegistry.get(state, "currency:isk") < nextPlan.isk) blockedReason = "insufficient-isk";
  else if (Number(nextPlan.lp) > 0 && ResourceRegistry.get(state, "currency:lp") < nextPlan.lp) blockedReason = "insufficient-lp";
  else if (!ResourceRegistry.canAffordCost(state, nextPlan.materials)) blockedReason = "insufficient-materials";
  else canUpgrade = true;

  // Build effect text for current level
  var effectText = "";
  if (level >= 1) {
    switch (buildingId) {
      case "resource_dispatch": effectText = "勘探指令阈值 " + [20,14,10,9,8][Math.min(4, level-1)]; break;
      case "planetary_control": effectText = "自动收取·槽位+" + [0,1, 2,3,4][Math.min(4, level-1)]; break;
      case "smelting_refinery": effectText = "自动线 ×" + [1,1.15,1.30,1.40,1.50][Math.min(4, level-1)].toFixed(2); break;
      case "equipment_factory": effectText = "自动线 ×" + [1,1.15,1.30,1.40,1.50][Math.min(4, level-1)].toFixed(2); break;
      case "booster_factory":   effectText = "自动线 ×" + [1,1.15,1.30,1.40,1.50][Math.min(4, level-1)].toFixed(2); break;
      case "archaeology_lab":   effectText = "独特文物 ×" + [1,1.05,1.10,1.15,1.20,1.25][Math.min(5, level)].toFixed(2); break;
      case "combat_command":    effectText = "战斗XP ×" + [1,1.10,1.20,1.30,1.40,1.50][Math.min(5, level)].toFixed(2); break;
      case "shipyard":          effectText = "速度×" + [1,1.05,1.15,1.30,1.40,1.50][Math.min(5, level)].toFixed(2) + "·节省" + [0,2,4,6,8,10][Math.min(5, level)] + "%"; break;
    }
  } else {
    effectText = "未建造";
  }

  // Build next-level effect text
  var nextEffectText = "";
  if (nextLevel && nextLevel >= 1) {
    switch (buildingId) {
      case "resource_dispatch": nextEffectText = "→ 勘探指令阈值 " + [20,14,10,9,8][Math.min(4, nextLevel-1)]; break;
      case "planetary_control": nextEffectText = "→ 槽位+" + [0,1,2,3,4][Math.min(4, nextLevel-1)]; break;
      case "smelting_refinery": nextEffectText = "→ 自动线 ×" + [1,1.15,1.30,1.40,1.50][Math.min(4, nextLevel-1)].toFixed(2); break;
      case "equipment_factory": nextEffectText = "→ 自动线 ×" + [1,1.15,1.30,1.40,1.50][Math.min(4, nextLevel-1)].toFixed(2); break;
      case "booster_factory":   nextEffectText = "→ 自动线 ×" + [1,1.15,1.30,1.40,1.50][Math.min(4, nextLevel-1)].toFixed(2); break;
      case "archaeology_lab":   nextEffectText = "→ 独特文物 ×" + [1,1.05,1.10,1.15,1.20,1.25][Math.min(5, nextLevel)].toFixed(2); break;
      case "combat_command":    nextEffectText = "→ 战斗XP ×" + [1,1.10,1.20,1.30,1.40,1.50][Math.min(5, nextLevel)].toFixed(2); break;
      case "shipyard":          nextEffectText = "→ 速度×" + [1,1.05,1.15,1.30,1.40,1.50][Math.min(5, nextLevel)].toFixed(2) + "·节省" + [0,2,4,6,8,10][Math.min(5, nextLevel)] + "%"; break;
    }
  }

  return {
    buildingId: buildingId,
    name: name,
    level: level,
    atMax: atMax,
    nextLevel: nextLevel,
    nextCost: nextCost,
    canUpgrade: canUpgrade,
    blockedReason: blockedReason,
    isConstructingThis: isConstructingThis,
    effectText: effectText,
    nextEffectText: nextEffectText
  };
}

function getStationBuildingsDisplayState(state) {
  return STATION_BUILDING_ID_LIST.map(id => getStationBuildingDisplayState(state, id));
}

/* ----------------------------------------------------------------
   Phase 3C-5：三条自动线（冶炼 / 装备 / 增强剂）
   ----------------------------------------------------------------
   三条独立的后台自动生产线，共线：
     · smelting  → 冶炼精炼厂（smelting_refinery）
     · equipment → 装备制造厂（equipment_factory）
     · booster   → 增强剂制造厂（booster_factory）
   每线只能运行一个目标；三条线可同时运行。
   不占 currentAction / 队列 / construction，玩家可并行其他行动。
   operatorId 首版恒 null。
   ---------------------------------------------------------------- */

const AUTO_LINE_IDS = ["smelting", "equipment", "booster"];

// 装备自动线产线白名单：仅生产消耗品（燃料 / 弹药 / 考古探针）。
// 可装配装备一律不出现在装备自动线（手动制造页不受影响，仍可造全部装备）。
const EQUIPMENT_AUTO_LINE_CATEGORIES = Object.freeze(["fuel", "ammunition", "probes"]);

const AUTO_LINE_CONFIG = Object.freeze({
  smelting:  { buildingId:"smelting_refinery",  name:"冶炼自动线" },
  equipment: { buildingId:"equipment_factory",  name:"装备自动线" },
  booster:   { buildingId:"booster_factory",    name:"增强剂自动线" }
});

function getStationAutoLineInfo(state, lineId) {
  const cfg = AUTO_LINE_CONFIG[lineId];
  if (!cfg) return null;
  const buildingLevel = getStationBuildingLevel(state, cfg.buildingId);
  const buildingName = STATION_BUILDING_NAMES[cfg.buildingId] || cfg.buildingId;
  // 复用建筑速度倍率表（Lv.1–5 一致），消除 UI 显示与自动线结算的分叉
  const multiplier = getStationBuildingSpeedMultiplier(state, cfg.buildingId);
  const unlocked = buildingLevel >= 1;
  const s = state && state.station;
  const line = s && s.autoLines && s.autoLines[lineId];
  return {
    lineId,
    buildingId: cfg.buildingId,
    buildingName,
    buildingLevel,
    unlocked,
    multiplier,
    enabled: line ? Boolean(line.enabled) : false,
    selectedTargetId: line ? line.selectedTargetId : null,
    startedTargetId: line ? line.startedTargetId : null,
    progress: line ? (Number(line.progress) || 0) : 0,
    stoppedReason: line ? line.stoppedReason : null
  };
}

/* ----------------------------------------------------------------
   内部辅助：停止一条自动线（设置 stoppedReason、清 enabled、emit 事件）。
   幂等：已停止（enabled===false 且有 stoppedReason）则不重复派发。
   ---------------------------------------------------------------- */
function stopAutoLineInternal(state, lineId, reason, offline) {
  const s = state && state.station;
  if (!s || !s.autoLines) return;
  const line = s.autoLines[lineId];
  if (!line) return;
  // 已停止且 stoppedReason 已设置则不再重复派发
  if (!line.enabled && line.stoppedReason) return;
  const targetId = line.startedTargetId || line.selectedTargetId || null;
  line.enabled = false;
  line.stoppedReason = reason;
  state._dirty = true;
  emitStationEvent("station:autoLineStopped", {
    lineId, targetId, reason,
    quantity:0, xp:0, offline:Boolean(offline)
  }, { offline:Boolean(offline) });
}

/* ----------------------------------------------------------------
   冶炼自动线处理核心
   使用真实 SMELTING_RECIPES，原矿消耗/矿物产出/XP 与手动一致。
   效率 = (1 + shipBonus + rigBonus) × buildingMultiplier（不乘 refining 等级速度）。
   产出量 = Math.max(1, floor(baseOutput × skillEfficiency))（技能经验仍影响单次产出）。
   ---------------------------------------------------------------- */
function processSmeltingAutoLine(state, line, multiplier, offline) {
  const recipe = SMELTING_RECIPES.find(r => r.name === line.startedTargetId);
  if (!recipe) { stopAutoLineInternal(state, "smelting", "unknown-recipe", offline); return { cycles:0 }; }

  // 防御性等级检查：旧存档中可能启用了非法高级配方
  const sLvl = getEffectiveSkillLevel(state, "refining");
  if (sLvl < recipe.level) { stopAutoLineInternal(state, "smelting", "level-locked", offline); return { cycles:0 }; }

  // 获取舰船与改装件加成（与手动冶炼同源）
  const assigned = (typeof getAssignedShipState === "function") ? getAssignedShipState(state, "refining") : { config:null, instance:null };
  const shipBonus = (assigned.config && assigned.config.bonuses) ? (assigned.config.bonuses.smeltingSpeed || 0) : 0;
  const rigMods = (assigned.instance && typeof getRigModifiers === "function")
    ? getRigModifiers(state, assigned.instance) : {};
  const rigBonus = rigMods.smeltingSpeed || 0;
  // 舰船强化（工业乘数 industryMultiplier）对冶炼仅享受 50% 幅度（与采矿/采气全幅区分）
  const shipEnhanceSmelt = (assigned.config && typeof getShipEnhancementSmeltMultiplier === "function")
    ? getShipEnhancementSmeltMultiplier(assigned.config, assigned.instance ? assigned.instance.enhancementLevel : 0) : 1;

  const skillEfficiency = 1 + getEffectiveSkillLevel(state, "refining") * 0.02;
  const legionRefine = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getLegionContributionSnapshot)
    ? LEGION_NPC.getLegionContributionSnapshot(state).multipliers.refining : 1;
  const efficiency = (1 + shipBonus + rigBonus) * multiplier * shipEnhanceSmelt * legionRefine;
  const cycleTimeSec = recipe.baseTime / Math.max(0.001, efficiency);
  const outputPerCycle = Math.max(1, Math.floor(recipe.baseOutput * skillEfficiency));
  const oreId = "ore:" + recipe.consumeOre;
  const mineralId = "mineral:" + recipe.outputMineral;

  // 计算可完成周期（加权前进度）
  let remainingSec = line.progress || 0;
  const cyclesByTime = Math.floor(remainingSec / cycleTimeSec);
  remainingSec -= cyclesByTime * cycleTimeSec;

  if (cyclesByTime <= 0) {
    line.progress = remainingSec;
    return { cycles:0 };
  }

  // 材料约束
  const oreStock = ResourceRegistry.get(state, oreId);
  const maxCyclesFromOre = Math.floor(oreStock);
  let cycles = Math.min(cyclesByTime, maxCyclesFromOre);

  // 生产数量封顶（按产出件数，0/≤0 = 无限）：达到目标后立即停止
  if (line.targetQuantity && line.targetQuantity > 0) {
    const remainingQty = line.targetQuantity - (line.producedQty || 0);
    if (remainingQty <= 0) {
      stopAutoLineInternal(state, "smelting", "target-reached", offline);
      line.progress = remainingSec;
      return { cycles:0 };
    }
    const maxByTarget = Math.ceil(remainingQty / Math.max(1, outputPerCycle));
    cycles = Math.min(cycles, maxByTarget);
  }

  if (cycles <= 0) {
    stopAutoLineInternal(state, "smelting", "insufficient-materials", offline);
    line.progress = remainingSec;
    return { cycles:0 };
  }

  // 原子执行：扣料 + 产出 + XP + 事件
  ResourceRegistry.spend(state, oreId, cycles);
  const made = cycles * outputPerCycle;
  ResourceRegistry.add(state, mineralId, made);
  line.producedQty = (line.producedQty || 0) + made;
  const xpGained = cycles * recipe.baseXP;
  addSkillXpToState(state, "refining", xpGained, { source:"station-auto-line", offline, job:"refining" });
  state._dirty = true;

  emitStationEvent("station:autoLineCompleted", {
    lineId:"smelting", targetId:recipe.name,
    quantity:made, xp:xpGained, offline, cycles
  }, { offline });

  // 停止判定：达标（按产出件数）优先；否则材料不足则安全停止
  const targetDone = line.targetQuantity && line.targetQuantity > 0 && (line.producedQty || 0) >= line.targetQuantity;
  if (targetDone) {
    stopAutoLineInternal(state, "smelting", "target-reached", offline);
  } else if (cycles < cyclesByTime) {
    stopAutoLineInternal(state, "smelting", "insufficient-materials", offline);
  }

  line.progress = remainingSec;
  return { cycles, xp:xpGained };
}

/* ----------------------------------------------------------------
   装备自动线处理核心
   使用真实 EQUIPMENT_ENGINEERING_RECIPES。
   效率 = recipe.time × multiplier（不乘 equipmentEngineering 等级速度）。
   仍检查配方等级门槛。
   禁止舰船部件（shipComponents/shipAssembly 类配方）。
   ---------------------------------------------------------------- */
function processEquipmentAutoLine(state, line, multiplier, offline) {
  const recipe = EQUIPMENT_ENGINEERING_RECIPES.find(r => r.id === line.startedTargetId);
  if (!recipe) { stopAutoLineInternal(state, "equipment", "unknown-recipe", offline); return { cycles:0 }; }

  // 精密配给剂（舰船/装备制造通用减料）报价：激活期间材料成本×0.9、配方等级门槛+N
  const eqQuote = (typeof getEquipEngBuildingQuote === "function") ? getEquipEngBuildingQuote(state, recipe) : { cost: recipe.cost, levelGate: recipe.level };

  // 产线白名单兜底：装备自动线仅允许消耗品类（燃料/弹药/探针），
  // 防止旧存档 / 非法 dispatch 让可装配装备目标继续生产
  if (EQUIPMENT_AUTO_LINE_CATEGORIES.indexOf(recipe.category) === -1) {
    stopAutoLineInternal(state, "equipment", "target-not-allowed", offline);
    return { cycles:0 };
  }

  // 检查配方等级门槛（含配给剂激活期间的 +N 门槛）
  const eeLvl = getEffectiveSkillLevel(state, "equipmentEngineering");
  if (eeLvl < eqQuote.levelGate) { stopAutoLineInternal(state, "equipment", "level-locked", offline); return { cycles:0 }; }

  // 蓝图门槛兜底：未持有蓝图则停止，防止非法存档 / 直接 dispatch 绕过。
  // 探针类走限次抄本 BPC：要求剩余流程 > 0（见 manufacturingRecipeHasBlueprint）。
  if (!manufacturingRecipeHasBlueprint(state, recipe)) {
    stopAutoLineInternal(state, "equipment", "blueprint-locked", offline);
    return { cycles:0 };
  }

  // 自动线不乘技能速度：cycleTime = recipe.time / multiplier
  // 装备总装协调剂（equipmentSpeed）仅作用于「手动装备制造」（manufacturing.js / selectors.js），自动线不消费增强剂。
  const cycleTimeSec = recipe.time / Math.max(0.001, multiplier);

  let remainingSec = line.progress || 0;
  const cyclesByTime = Math.floor(remainingSec / cycleTimeSec);
  remainingSec -= cyclesByTime * cycleTimeSec;

  if (cyclesByTime <= 0) {
    line.progress = remainingSec;
    return { cycles:0 };
  }

  // 材料约束：cost（配给剂折扣后）+ inputEquipment（如有）
  const maxFromCost = (function() {
    let cycles = Infinity;
    for (const [ref, qty] of Object.entries(eqQuote.cost)) {
      cycles = Math.min(cycles, Math.floor(ResourceRegistry.getByRef(state, ref) / Math.max(1, qty)));
    }
    return Number.isFinite(cycles) ? Math.max(0, cycles) : 0;
  })();

  let maxFromInput = cyclesByTime;
  if (recipe.inputEquipment) {
    // 显式护栏：自动线只消耗 inventory 字符串池中的 +0 装备，绝不触碰 instances（强化件永留实例池）。
    // 且 inputEquipment 配方（死亡空间类）本就不在 EQUIPMENT_AUTO_LINE_CATEGORIES 白名单内，此处为双保险。
    const inv = (state.equipment && Array.isArray(state.equipment.inventory)) ? state.equipment.inventory : [];
    const need = Math.max(1, Number(recipe.inputEquipment.quantity) || 1);
    maxFromInput = Math.floor(inv.filter(id => id === recipe.inputEquipment.itemId).length / need);
  }

  const cyclesCalc = Math.min(cyclesByTime, maxFromCost, maxFromInput);
  let cycles = cyclesCalc;

  // 生产数量封顶（按产出件数，0/≤0 = 无限）：达到目标后立即停止
  if (line.targetQuantity && line.targetQuantity > 0) {
    const remainingQty = line.targetQuantity - (line.producedQty || 0);
    if (remainingQty <= 0) {
      stopAutoLineInternal(state, "equipment", "target-reached", offline);
      line.progress = remainingSec;
      return { cycles:0 };
    }
    const maxByTarget = Math.ceil(remainingQty / Math.max(1, (recipe.output && recipe.output.qty) || 1));
    cycles = Math.min(cycles, maxByTarget);
  }

  if (cycles <= 0) {
    stopAutoLineInternal(state, "equipment", "insufficient-materials", offline);
    line.progress = remainingSec;
    return { cycles:0 };
  }

  // 限次抄本（BPC）：探针类配方可完成的周期数受剩余流程次数限制；归零即停线。
  const bpcMaxCycles = manufacturingMaxCyclesByBlueprint(state, recipe);
  if (bpcMaxCycles <= 0) {
    stopAutoLineInternal(state, "equipment", "blueprint-runs-depleted", offline);
    line.progress = remainingSec;
    return { cycles:0 };
  }
  if (bpcMaxCycles < cycles) cycles = bpcMaxCycles;

  // 原子执行：扣料（配给剂折扣后）+ 预留抄本流程 + 产出 + XP + 事件
  if (!ResourceRegistry.canAffordCost(state, eqQuote.cost, cycles)) {
    stopAutoLineInternal(state, "equipment", "insufficient-materials", offline);
    line.progress = remainingSec;
    return { cycles:0 };
  }
  // 材料校验通过后才预留流程：材料不足 → 上面已零副作用停止，不会白扣流程（无需退还）。
  if (!manufacturingReserveBlueprintRuns(state, recipe, cycles)) {
    stopAutoLineInternal(state, "equipment", "blueprint-runs-depleted", offline);
    line.progress = remainingSec;
    return { cycles:0 };
  }
  ResourceRegistry.spendCost(state, eqQuote.cost, cycles);

  if (recipe.inputEquipment) {
    const need = Math.max(1, Number(recipe.inputEquipment.quantity) || 1) * cycles;
    for (let i = 0; i < need; i++) {
      const idx = (state.equipment.inventory || []).indexOf(recipe.inputEquipment.itemId);
      if (idx >= 0) state.equipment.inventory.splice(idx, 1);
    }
  }

  // 应用产出
  const output = recipe.output;
  const totalQty = output.qty * cycles;
  line.producedQty = (line.producedQty || 0) + totalQty;
  if (output.type === "equipment") {
    if (!state.equipment) state.equipment = { inventory:[] };
    if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
    for (let i = 0; i < cycles; i++) state.equipment.inventory.push(output.itemId);
  } else if (output.type === "fuel") {
    ResourceRegistry.add(state, "consumable:fuel", totalQty);
  } else if (output.type === "ammo") {
    addAmmo(state, { type: output.weapon, tier: output.tier || "T1", props: output.props, qty: totalQty });
  } else if (output.type === "probe") {
    ResourceRegistry.add(state, "probe:" + output.itemId, totalQty);
  }

  const xpGained = cycles * recipe.xp;
  addSkillXpToState(state, "equipmentEngineering", xpGained, { source:"station-auto-line", offline });
  state._dirty = true;

  emitStationEvent("station:autoLineCompleted", {
    lineId:"equipment", targetId:recipe.id,
    quantity:totalQty, xp:xpGained, offline, cycles
  }, { offline });

  // 2026-09-03 补漏：装备自动线此前不发 manufacturing:completed，导致同配方手动队列出脑插、
  // 自动线不出（口径差）。现对齐手动队列（tick.js）与离线结算（offline.js）字段，
  // 按 cycles 聚合掷骰 —— 装备线成品（含燃料/弹药/探针消耗品）均计入脑插掉落路径。
  emitStationEvent("manufacturing:completed", {
    branch:"equipment", recipeId:recipe.id, productType:output.type,
    quantity:totalQty, time:recipe.time, cycles, xp:xpGained, offline
  }, { offline });

  if (recipe.slot === "rig") {
    emitStationEvent("rig:manufactured", { rigId:output.itemId, quantity:totalQty }, { offline });
  }

  // 停止判定：达标（按产出件数）优先；否则材料不足则安全停止
  const targetDone = line.targetQuantity && line.targetQuantity > 0 && (line.producedQty || 0) >= line.targetQuantity;
  if (targetDone) {
    stopAutoLineInternal(state, "equipment", "target-reached", offline);
  } else if (cycles < cyclesByTime) {
    stopAutoLineInternal(state, "equipment", "insufficient-materials", offline);
  }

  line.progress = remainingSec;
  return { cycles, xp:xpGained };
}

/* ----------------------------------------------------------------
   增强剂自动线处理核心
   使用真实 BOOSTER_RECIPES。每周期只生产一瓶。
   不乘 boosterEngineering 等级速度，但检查配方等级门槛。
   ---------------------------------------------------------------- */
function processBoosterAutoLine(state, line, multiplier, offline) {
  const recipe = BOOSTER_RECIPES.find(r => r.id === line.startedTargetId);
  if (!recipe) { stopAutoLineInternal(state, "booster", "unknown-recipe", offline); return { cycles:0 }; }

  // 检查配方等级门槛
  const bLvl = getEffectiveSkillLevel(state, "boosterEngineering");
  if (bLvl < recipe.level) { stopAutoLineInternal(state, "booster", "level-locked", offline); return { cycles:0 }; }

  // 蓝图门槛兜底：未持有蓝图则停止，防止非法存档 / 直接 dispatch 绕过
  if (recipe.requiresBlueprint === true && !hasBoosterBlueprintFromState(state, recipe.id)) {
    stopAutoLineInternal(state, "booster", "blueprint-locked", offline);
    return { cycles:0 };
  }

  // 自动线不乘技能速度：cycleTime = recipe.time / multiplier
  const cycleTimeSec = recipe.time / Math.max(0.001, multiplier);

  let remainingSec = line.progress || 0;
  const cyclesByTime = Math.floor(remainingSec / cycleTimeSec);
  remainingSec -= cyclesByTime * cycleTimeSec;

  if (cyclesByTime <= 0) {
    line.progress = remainingSec;
    return { cycles:0 };
  }

  // 材料约束
  const maxFromCost = (function() {
    let cycles = Infinity;
    for (const [ref, qty] of Object.entries(recipe.cost || {})) {
      cycles = Math.min(cycles, Math.floor(ResourceRegistry.getByRef(state, ref) / Math.max(1, qty)));
    }
    return Number.isFinite(cycles) ? Math.max(0, cycles) : 0;
  })();

  let cycles = Math.min(cyclesByTime, maxFromCost);

  // 生产数量封顶（按产出件数，0/≤0 = 无限）：达到目标后立即停止
  if (line.targetQuantity && line.targetQuantity > 0) {
    const remainingQty = line.targetQuantity - (line.producedQty || 0);
    if (remainingQty <= 0) {
      stopAutoLineInternal(state, "booster", "target-reached", offline);
      line.progress = remainingSec;
      return { cycles:0 };
    }
    const maxByTarget = Math.ceil(remainingQty / Math.max(1, (recipe.output && recipe.output.qty) || 1));
    cycles = Math.min(cycles, maxByTarget);
  }

  if (cycles <= 0) {
    stopAutoLineInternal(state, "booster", "insufficient-materials", offline);
    line.progress = remainingSec;
    return { cycles:0 };
  }

  // 原子执行：扣料 + 产出 + XP + 事件
  if (!ResourceRegistry.canAffordCost(state, recipe.cost, cycles)) {
    stopAutoLineInternal(state, "booster", "insufficient-materials", offline);
    line.progress = remainingSec;
    return { cycles:0 };
  }
  ResourceRegistry.spendCost(state, recipe.cost, cycles);
  const made = cycles * recipe.output.qty;
  ResourceRegistry.add(state, recipe.output.itemId, made);
  line.producedQty = (line.producedQty || 0) + made;

  const xpGained = cycles * recipe.xp;
  addSkillXpToState(state, "boosterEngineering", xpGained, { source:"station-auto-line", offline });
  state._dirty = true;

  emitStationEvent("station:autoLineCompleted", {
    lineId:"booster", targetId:recipe.id,
    quantity:cycles * recipe.output.qty, xp:xpGained, offline, cycles
  }, { offline });

  emitStationEvent("booster:manufactured", {
    recipeId:recipe.id, itemId:recipe.output.itemId,
    series:recipe.series, quality:recipe.quality,
    quantity:cycles, time:recipe.time, cycles, xpGained, offline
  }, { offline });

  // 停止判定：达标（按产出件数）优先；否则材料不足则安全停止
  const targetDone = line.targetQuantity && line.targetQuantity > 0 && (line.producedQty || 0) >= line.targetQuantity;
  if (targetDone) {
    stopAutoLineInternal(state, "booster", "target-reached", offline);
  } else if (cycles < cyclesByTime) {
    stopAutoLineInternal(state, "booster", "insufficient-materials", offline);
  }

  line.progress = remainingSec;
  return { cycles, xp:xpGained };
}

/* ----------------------------------------------------------------
   统一入口：根据 elapsedMs 推进三条自动线进度（在线/离线共用）
   now：当前时间戳，用于计算各线 elapsed 并更新 lastTick。
   离线 / 在线通过 offline 参数控制事件的 meta 标记。
   幂等：已停止（enabled===false 且有 stoppedReason）的线不处理。
   ---------------------------------------------------------------- */
// 军团 NPC 自动线速度加成（autolineSpeed）：与建造/后勤/科研同乘，只加速周期，不改材料与单周期产量。
function getLegionAutoLineMultiplier(state) {
  if (typeof LEGION_NPC !== "undefined" && typeof LEGION_NPC.getLegionContributionSnapshot === "function") {
    return LEGION_NPC.getLegionContributionSnapshot(state).multipliers.autoline;
  }
  return 1;
}

function processAutoLines(state, now, offline) {
  if (!state || !state.station || !state.station.autoLines) return 0;
  const s = state.station;
  let totalCycles = 0;
  for (const lineId of AUTO_LINE_IDS) {
    const line = s.autoLines[lineId];
    if (!line || !line.enabled || !line.startedTargetId || line.stoppedReason) continue;
    if (line.lastTick > 0 && now <= line.lastTick) continue;
    const elapsedMs = line.lastTick > 0 ? Math.max(0, now - line.lastTick) : 0;
    if (elapsedMs <= 0 && line.lastTick > 0) continue;
    // 首次启动（lastTick===0）：初始化 lastTick，不处理
    if (line.lastTick <= 0) {
      line.lastTick = now;
      state._dirty = true;
      continue;
    }
    // 防溢出：最大 24 小时（离线 path 已受 MAX_OFFLINE_SECONDS 约束，安全网）
    const cappedMs = Math.min(elapsedMs, 86400000);

    const buildingMultiplier = getStationBuildingSpeedMultiplier(state, AUTO_LINE_CONFIG[lineId].buildingId);
    if (buildingMultiplier <= 0) {
      line.lastTick = now;
      stopAutoLineInternal(state, lineId, "building-required", offline);
      continue;
    }

    // 燃料闸门：断油时暂停——推进 lastTick，但【不累积进度】、不产出、不扣料、不加XP。
    // 关键：进度累加必须在燃料闸门之后，否则断油时段会被计入 progress，
    // 补油后首个在线 tick 会一次性结算整段黑暗期（违反「补油后只结算实际时长」）。
    const isOperational = (typeof isStationOperational === "function") ? isStationOperational(state) : true;
    if (!isOperational && AUTO_LINE_CONFIG[lineId].buildingId !== "shipyard") {
      line.lastTick = now;
      state._dirty = true;
      continue;
    }

    // 仅 operational 段累积进度并结算。自动线最终倍率 = buildingMultiplier × stationLogisticsMultiplier
    // 系数 B：装备厂房/增强剂厂房自动线接入对应核心（equipEng/booster），冶炼线保持 smelt。
    const stationLogisticsMult = (typeof getStationLogisticsMultiplier === "function") ? getStationLogisticsMultiplier(state, LINE_CORE_TAG[lineId]) : 1;
    // 研究批次 G · autoline 组：自动化协议提速（只加速周期，材料消耗与单周期产量完全不变）
    let autoLineResearchMult = (typeof ResearchState !== "undefined") ? Number(ResearchState.getResearchMultiplier(state, ["autoline"])) : 1;
    if (!Number.isFinite(autoLineResearchMult) || autoLineResearchMult <= 0) autoLineResearchMult = 1;
    const multiplier = buildingMultiplier * stationLogisticsMult * autoLineResearchMult * getLegionAutoLineMultiplier(state);
    line.progress = (line.progress || 0) + cappedMs / 1000;
    line.lastTick = now;

    let result;
    if (lineId === "smelting") result = processSmeltingAutoLine(state, line, multiplier, offline);
    else if (lineId === "equipment") result = processEquipmentAutoLine(state, line, multiplier, offline);
    else if (lineId === "booster") result = processBoosterAutoLine(state, line, multiplier, offline);

    if (result && result.cycles > 0) totalCycles += result.cycles;
  }
  return totalCycles;
}

/* ----------------------------------------------------------------
   建筑速度倍率：按建筑等级返回 1.00 / 1.15 / 1.30
   Lv.0 → 0（线不可启动）
   ---------------------------------------------------------------- */
function getStationBuildingSpeedMultiplier(state, buildingId) {
  const lvl = getStationBuildingLevel(state, buildingId);
  if (lvl >= 5) return 1.50;
  if (lvl === 4) return 1.40;
  if (lvl === 3) return 1.30;
  if (lvl === 2) return 1.15;
  if (lvl === 1) return 1.00;
  return 0;
}

/* ----------------------------------------------------------------
   共用自动线周期计算：processAutoLines 与 UI 显示共享，防止公式漂移
   返回单个周期的秒数。
   冶炼包含舰船/rig/建筑/后勤倍率；装备/增强剂包含建筑/后勤倍率。
   recipe 参数可直接传入配方对象。
   ---------------------------------------------------------------- */
function getStationAutoLineCycleDuration(state, lineId, recipe) {
  if (!recipe) return 0;
  const buildingMult = getStationBuildingSpeedMultiplier(state, AUTO_LINE_CONFIG[lineId].buildingId);
  // 系数 B：装备厂房/增强剂厂房自动线接入对应核心（equipEng/booster），冶炼线保持 smelt。
  const logisticsMult = (typeof getStationLogisticsMultiplier === "function") ? getStationLogisticsMultiplier(state, LINE_CORE_TAG[lineId]) : 1;
  // 研究批次 G · autoline 组：与 processAutoLines 完全同式，UI 显示周期 = 实际结算周期
  let autoLineResearchMult = (typeof ResearchState !== "undefined") ? Number(ResearchState.getResearchMultiplier(state, ["autoline"])) : 1;
  if (!Number.isFinite(autoLineResearchMult) || autoLineResearchMult <= 0) autoLineResearchMult = 1;
  const mult = Math.max(0.001, buildingMult * logisticsMult * autoLineResearchMult * getLegionAutoLineMultiplier(state));
  if (lineId === "smelting") {
    const assigned = (typeof getAssignedShipState === "function") ? getAssignedShipState(state, "refining") : { config:null, instance:null };
    const shipBonus = (assigned.config && assigned.config.bonuses) ? (assigned.config.bonuses.smeltingSpeed || 0) : 0;
    const rigMods = (assigned.instance && typeof getRigModifiers === "function") ? getRigModifiers(state, assigned.instance) : {};
    const rigBonus = rigMods.smeltingSpeed || 0;
    // 舰船强化（工业乘数 industryMultiplier）对冶炼仅享受 50% 幅度（与结算 processSmeltingAutoLine 同式）
    const shipEnhanceSmelt = (assigned.config && typeof getShipEnhancementSmeltMultiplier === "function")
      ? getShipEnhancementSmeltMultiplier(assigned.config, assigned.instance ? assigned.instance.enhancementLevel : 0) : 1;
    const eff = (1 + shipBonus + rigBonus) * mult * shipEnhanceSmelt;
    return recipe.baseTime / Math.max(0.001, eff);
  }
  return (recipe.time || recipe.baseTime || 30) / mult;
}

/* ----------------------------------------------------------------
   自动线显示态（纯函数，无副作用，供后续 UI 消费）
   保证所有字段非 undefined / 非 NaN。
   ---------------------------------------------------------------- */
function getStationAutoLineDisplayState(state, lineId) {
  const info = getStationAutoLineInfo(state, lineId);
  if (!info) return null;
  const s = state && state.station;
  const line = s && s.autoLines && s.autoLines[lineId];
  const lvl = info.buildingLevel;

  // 能否启动
  let canStart = false;
  let blockedReason = null;
  if (!info.unlocked) {
    blockedReason = "building-required";
  } else if (info.enabled && info.startedTargetId) {
    blockedReason = "already-running";
  } else if (!info.selectedTargetId) {
    blockedReason = "no-target-selected";
  } else {
    // 蓝图限制（equipment/booster 线）：选中目标需对应蓝图，否则禁止启动
    let blueprintOk = true;
    let categoryOk = true;
    const selId = info.selectedTargetId;
    if (selId && (lineId === "equipment" || lineId === "booster")) {
      const pool = lineId === "equipment" ? EQUIPMENT_ENGINEERING_RECIPES : BOOSTER_RECIPES;
      const recipe = pool && pool.find(r => r.id === selId);
      if (recipe && recipe.requiresBlueprint === true) {
        blueprintOk = lineId === "equipment"
          ? manufacturingRecipeHasBlueprint(state, recipe)
          : hasBoosterBlueprintFromState(state, recipe.id);
      }
      // 产线白名单（仅 equipment 线）：非消耗品目标禁止启动
      if (lineId === "equipment" && recipe && EQUIPMENT_AUTO_LINE_CATEGORIES.indexOf(recipe.category) === -1) {
        categoryOk = false;
      }
    }
    if (!categoryOk) blockedReason = "target-not-allowed";
    else if (!blueprintOk) blockedReason = "blueprint-locked";
    else canStart = true;
  }

  // 材料状态（仅运行时检查）
  let materialState = null;
  if (info.enabled && info.startedTargetId) {
    materialState = "checking";
  }

  return {
    lineId,
    buildingId: info.buildingId,
    buildingName: info.buildingName,
    buildingLevel: lvl,
    unlocked: info.unlocked,
    buildingMultiplier: info.multiplier,
    selectedTargetId: info.selectedTargetId,
    startedTargetId: info.startedTargetId,
    running: info.enabled && !!info.startedTargetId,
    progress: info.progress,
    canStart,
    blockedReason,
    stoppedReason: info.stoppedReason,
    materialState,
    operatorId: line ? (line.operatorId !== undefined ? line.operatorId : null) : null,
    targetQuantity: line ? (Number(line.targetQuantity) || 0) : 0,
    producedQty: line ? (Number(line.producedQty) || 0) : 0
  };
}

function getStationAutoLinesDisplayState(state) {
  return AUTO_LINE_IDS.map(id => getStationAutoLineDisplayState(state, id));
}

/* ================================================================
   Phase 3C-6：维护燃料、考古实验室、作战指挥中心、舰船船坞
   ================================================================ */

// ---- 维护燃料消耗 ----
const MAINTENANCE_WEEKLY_FUEL_PER_POINT = 1500;
const MAINTENANCE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAINTENANCE_REFILL_HOURS = 24;

function getStationMaintenancePoints(state) {
  const s = state && state.station;
  if (!s) return 0;
  const bodyLvl = Math.floor(Number(s.bodyLevel)) || 0;
  let sum = bodyLvl;
  for (const id of STATION_BUILDING_ID_LIST) {
    // 舰船船坞不增加燃料维护点数；军团议事大厅为「管理 NPC」建筑，亦不计入燃料维护点数。
    if (id === "shipyard" || id === "legion_hall") continue;
    const lvl = Math.floor(Number(s.buildings && s.buildings[id])) || 0;
    sum += lvl;
  }
  return sum;
}

/* ----------------------------------------------------------------
   军团 DLC 内容授权接口（复用既有 content-permission 接口，禁止在站点系统内硬编码平台判断）。
   DLC 由平台在运行时注入，存档不持久化（save-codec 已剥离 station.dlc / corporation.dlc），
   两种位置任一为真即视为已授权（平台可能写其中一处）。
   ---------------------------------------------------------------- */
// 开发期：DLC 授权恒放行（军团入口恒定开启）。接回正式 DLC 门禁时，将本常量置 false 并恢复下方真实读取。
const LEGION_DLC_DEV_BYPASS = true;
function getStationDlcNpcWorkers(state) {
  if (LEGION_DLC_DEV_BYPASS) return true;
  const sDlc = state && state.station && state.station.dlc;
  const cDlc = state && state.corporation && state.corporation.dlc;
  return Boolean((sDlc && sDlc.npcWorkers) || (cDlc && cDlc.npcWorkers));
}

// 本体实际可建等级上限：当前 DLC 授权门禁未实际生效（接口 getStationDlcNpcWorkers 保留，待平台接入），
// 故本体上限暂行 STATION_MAX_BODY_LEVEL（=5），让 Lv.4/Lv.5 在 body/cap 规则下可建。
// ⚠️ 待 DLC 门禁真正生效时，此处应改回 `getStationDlcNpcWorkers(state) ? STATION_MAX_BODY_LEVEL : 3`。
function getStationMaxBodyLevel(state) {
  return STATION_MAX_BODY_LEVEL;
}

// 管理 NPC 经验总量：九座建筑（含舰船船坞与原八座 + 军团议事大厅）等级之和，最大 9×5 = 45。
// 与燃料维护点数不同——此处计入全部九座建筑（含舰船船坞），hall 作为第九座。
function getStationManagementNpcXpTotal(state) {
  const s = state && state.station;
  if (!s) return 0;
  let sum = 0;
  for (const id of STATION_BUILDING_ID_LIST) {
    const lvl = Math.floor(Number(s.buildings && s.buildings[id])) || 0;
    sum += Math.max(0, Math.min(STATION_MAX_BUILDING_LEVEL, lvl));
  }
  return sum;
}

// 管理 NPC 经验倍率（基于九座建筑等级总量，0~45）：
//   0~8 → 0.5×；9~17 → 1.0×；18~26 → 1.5×；27~35 → 2.0×；36~44 → 2.5×；45 → 3.0×
function getStationManagementNpcXpMultiplier(state) {
  const total = getStationManagementNpcXpTotal(state);
  if (total >= 45) return 3.0;
  if (total >= 36) return 2.5;
  if (total >= 27) return 2.0;
  if (total >= 18) return 1.5;
  if (total >= 9) return 1.0;
  return 0.5;
}

function getStationFuelBurnRatePerMs(points) {
  return points * MAINTENANCE_WEEKLY_FUEL_PER_POINT / MAINTENANCE_WEEK_MS;
}

/* ----------------------------------------------------------------
   研究批次 G · fuel 组：燃料后勤减耗（reduceFraction）
   实际燃烧速率 = 基础速率 × (1 - getResearchBonusValue(state,"fuel"))
   在线结算 / 离线结算 / 剩余时长显示三处共用此唯一入口。
   ---------------------------------------------------------------- */
function getStationEffectiveFuelBurnRatePerMs(state, points) {
  const base = getStationFuelBurnRatePerMs(points);
  const raw = (typeof ResearchState !== "undefined") ? Number(ResearchState.getResearchBonusValue(state, "fuel")) : 0;
  const reduction = Number.isFinite(raw) ? Math.max(0, Math.min(0.95, raw)) : 0;
  return base * (1 - reduction);
}

function isStationOperational(state) {
  const s = state && state.station;
  if (!s) return false;
  const bodyLvl = Math.floor(Number(s.bodyLevel)) || 0;
  if (bodyLvl <= 0) return false;
  const points = getStationMaintenancePoints(state);
  const fuel = Number(s.maintenance && s.maintenance.fuelRemaining) || 0;
  return points <= 0 || fuel > 0;
}

// 在线/离线共用燃料结算
function settleStationMaintenance(state, now, offline) {
  const s = state && state.station;
  if (!s) return;
  const m = s.maintenance;
  if (!m || typeof m !== "object") return;
  const bodyLvl = Math.floor(Number(s.bodyLevel)) || 0;
  if (bodyLvl <= 0) { m.lastTick = now; return; }
  const lastTick = Number(m.lastTick);
  if (!Number.isFinite(lastTick) || lastTick <= 0) { m.lastTick = now; return; }
  if (now <= lastTick) return;
  const points = getStationMaintenancePoints(state);
  if (points <= 0) { m.lastTick = now; return; }
  const burnRate = getStationEffectiveFuelBurnRatePerMs(state, points);
  const elapsed = now - lastTick;
  const consumed = burnRate * elapsed;
  const beforeFuel = m.fuelRemaining;
  m.fuelRemaining = Math.max(0, m.fuelRemaining - consumed);
  m.lastTick = now;
  state._dirty = true;
  if (m.fuelRemaining <= 0 && !m.depletedNotified) {
    m.depletedNotified = true;
    emitStationEvent("station:maintenanceDepleted", { fuelRemaining:0 }, { offline:Boolean(offline) });
  }
  const remainingMs = (m.fuelRemaining > 0 && points > 0) ? m.fuelRemaining / getStationEffectiveFuelBurnRatePerMs(state, points) : 0;
  if (m.fuelRemaining > 0 && remainingMs < MAINTENANCE_REFILL_HOURS * 3600000 && !m.lowFuelNotified) {
    m.lowFuelNotified = true;
    emitStationEvent("station:maintenanceLow", { fuelRemaining:m.fuelRemaining, remainingMs }, { offline:Boolean(offline) });
  }
}


// ---- 一键补给 ----
function getStationRefillMaintenanceState(state) {
  const s = state && state.station;
  if (!s) return { canRefill:false, reason:"no-station" };
  const points = getStationMaintenancePoints(state);
  if (points <= 0) return { canRefill:false, reason:"station-not-built" };
  const fuel = Number(s.maintenance && s.maintenance.fuelRemaining) || 0;
  const targetFuel = points * MAINTENANCE_WEEKLY_FUEL_PER_POINT;
  // 研究批次 G · fuel：补给闸门的“剩余时长”必须与显示态/结算同用实际燃烧速率，
  // 否则有燃料科研时会出现“显示还能撑很久、却已允许补给”的两套口径。
  const remainingMs = (fuel > 0 && points > 0) ? fuel / getStationEffectiveFuelBurnRatePerMs(state, points) : 0;
  if (remainingMs > MAINTENANCE_REFILL_HOURS * 3600000) {
    return { canRefill:false, reason:"maintenance-not-needed", remainingMs, points, fuel, targetFuel };
  }
  return { canRefill:true, points, fuel, targetFuel, remainingMs };
}

// ---- 展示态 ----
function getStationMaintenanceDisplayState(state, now) {
  const s = state && state.station;
  if (!s) return null;
  const nowMs = Number(now) || Date.now();
  const bodyLvl = Math.floor(Number(s.bodyLevel)) || 0;
  const points = getStationMaintenancePoints(state);
  const fuel = Number(s.maintenance && s.maintenance.fuelRemaining) || 0;
  const burnRate = points > 0 ? getStationEffectiveFuelBurnRatePerMs(state, points) : 0;
  const remainingMs = burnRate > 0 ? fuel / burnRate : 0;
  const refillInfo = getStationRefillMaintenanceState(state);
  return {
    operational: isStationOperational(state),
    maintenancePoints: points,
    fuelRemaining: fuel,
    remainingMs,
    remainingText: remainingMs > 0 ? Math.ceil(remainingMs / 3600000) + "h" : "0h",
    refillFuelCost: refillInfo.canRefill ? Math.ceil(refillInfo.targetFuel - fuel) : 0,
    canRefill: refillInfo.canRefill,
    blockedReason: refillInfo.canRefill ? null : refillInfo.reason,
    warehouseFuel: (typeof ResourceRegistry !== "undefined") ? (Number(ResourceRegistry.get(state, "consumable:fuel")) || 0) : 0,
    lowFuelNotified: Boolean(s.maintenance && s.maintenance.lowFuelNotified),
    depletedNotified: Boolean(s.maintenance && s.maintenance.depletedNotified)
  };
}

// ---- 考古实验室倍率 ----
function getArchaeologyLabMultiplier(state) {
  if (!isStationOperational(state)) return 1;
  const lvl = getStationBuildingLevel(state, "archaeology_lab");
  if (lvl >= 5) return 1.25;
  if (lvl === 4) return 1.20;
  if (lvl === 3) return 1.15;
  if (lvl === 2) return 1.10;
  if (lvl === 1) return 1.05;
  return 1;
}

// ---- 作战指挥中心倍率 ----
function getStationCombatXpMultiplier(state) {
  if (!isStationOperational(state)) return 1;
  const lvl = getStationBuildingLevel(state, "combat_command");
  if (lvl >= 5) return 1.50;
  if (lvl === 4) return 1.40;
  if (lvl === 3) return 1.30;
  if (lvl === 2) return 1.20;
  if (lvl === 1) return 1.10;
  return 1;
}

// 唯一 XP 包装函数（作战指挥中心加成）
const COMBAT_SKILL_WHITELIST = Object.freeze([
  "capacitorManagement", "laserOps", "cannonOps", "missileOperations",
  "targeting", "shieldOperation", "armorReinforcement", "hullEngineering",
  "piloting", "defense"
]);

function addStationModifiedCombatXp(state, skillId, baseXp, job) {
  // 非白名单技能不加成：既不吃作战指挥中心倍率，也不吃 combatExp 科研
  if (!COMBAT_SKILL_WHITELIST.includes(skillId)) {
    return addSkillXpToState(state, skillId, baseXp, { source:"station-combat-command" });
  }
  // 研究批次 H · combatExp：科研与作战指挥中心是两个彼此独立的乘区。
  //   researchAdjustedBase = baseXp × getResearchMultiplier(state, ["combatExp"])   ← 只乘一次
  //   actualXp             = researchAdjustedBase × 真实空间站倍率
  // 科研乘子不依赖空间站是否建成、是否有燃料；零科研时 researchAdjustedBase === baseXp，
  // 旧结果与事件 payload 逐值不变。
  const researchMultiplier = (typeof ResearchState !== "undefined")
    ? ResearchState.getResearchMultiplier(state, ["combatExp"]) : 1;
  const researchAdjustedBase = baseXp * researchMultiplier;
  // 战区烈度（第三个独立乘区，2026-09-04）：与科研、空间站指挥中心彼此独立相乘。
  // 烈度口径 = zone.fuelMult（1 / 1.1 / 1.2 / 1.35 / 1.6 / 1.8）；死亡空间继承来源星带烈度。
  // 无战区上下文（补给预检等非战斗路径）时回退 1，行为与改动前逐值一致。
  const zoneIntensityMultiplier = (typeof getZoneIntensityXpMultiplier === "function" && typeof getCurrentCombatIntensityZone === "function")
    ? getZoneIntensityXpMultiplier(getCurrentCombatIntensityZone(state)) : 1;
  const zoneAdjustedBase = researchAdjustedBase * zoneIntensityMultiplier;
  const mult = getStationCombatXpMultiplier(state);
  const totalXp = zoneAdjustedBase * mult;
  const gained = addSkillXpToState(state, skillId, totalXp, { source:"station-combat-command", job: job || "combat" });
  // 只有真实空间站倍率 > 1 才算「空间站加成」；仅科研生效时不得伪报该事件。
  // payload.baseXp 用 zoneAdjustedBase（已含科研与战区烈度），
  // 保证 baseXp × multiplier === actualXp 的数学关系仍然成立。
  if (mult > 1 && gained > zoneAdjustedBase) {
    emitStationEvent("station:combatXpBoosted", { skillId, baseXp:zoneAdjustedBase, multiplier:mult, actualXp:gained }, { offline:false });
  }
  return gained;
}

// ---- 舰船船坞 ----
function getShipyardSpeedMultiplier(state) {
  const lvl = getStationBuildingLevel(state, "shipyard");
  const MULT = [1, 1.05, 1.15, 1.30, 1.40, 1.50];
  return MULT[Math.min(5, lvl)] || 1;
}

function getShipyardSavingRate(state) {
  const lvl = getStationBuildingLevel(state, "shipyard");
  const RATE = [0, 0.02, 0.04, 0.06, 0.08, 0.10];
  let rate = RATE[Math.min(5, lvl)] || 0;
  // 系数 B（shipEng）：空间站船坞核心已获取并持有库存时，部件制造材料消耗额外降低 2%（与船坞等级节省加算）。
  // 仅作用于部件制造（部件车间），不作用于总装；与 getShipyardProductionQuote 共用此唯一入口。
  if (state && state.stationCoresObtained && state.stationCoresObtained.shipEng) {
    const held = (typeof ResourceRegistry !== "undefined")
      ? Number(ResourceRegistry.get(state, STATION_CORE_RESOURCE.shipEng)) || 0
      : 0;
    if (held > 0) rate += 0.02;
  }
  return rate;
}

function getShipyardLevel(state) {
  return getStationBuildingLevel(state, "shipyard");
}

// 部件制造门槛：检查 shipyard 等级是否足够制造指定配方
// 通过配方 ID 前缀判断 capital/supercapital 级别
// 技能、蓝图、材料门槛继续独立生效
function canManufactureAtShipyard(state, recipeId) {
  const lvl = getShipyardLevel(state);
  // 超级旗舰部件：Lv.3
  if (recipeId.startsWith("supercapital_")) return lvl >= 3;
  // 旗舰部件：Lv.2
  if (recipeId.startsWith("capital_")) return lvl >= 2;
  // 常规/工业/考古（非 capital）：Lv.0 即可
  return true;
}

// 舰船总装门槛
// 单一权威规则源：给定配方返回组装所需船坞等级（不复制第二套判定）。
// 与 canAssembleAtShipyard 共用，供 UI 显示「真实船坞等级要求」文本，杜绝伪造为技能/蓝图问题。
// 规则（与原正式设计一致，不得改写）：
//   · 未知配方（不在 SHIP_ASSEMBLY_RECIPES）→ 返回 null（fail closed，不得伪装成正常配方）
//   · 超级旗舰（supercapital）                 → 3
//   · 旗舰 / 工业旗舰 / 考古旗舰                 → 2
//   · 其余常规/工业/考古舰船                     → 0（无需船坞等级）
function getShipyardAssemblyLevelRequirement(state, recipeId) {
  // 查询 SHIP_ASSEMBLY_RECIPES 获取配方数据
  const recipe = (typeof SHIP_ASSEMBLY_RECIPES !== "undefined")
    ? SHIP_ASSEMBLY_RECIPES.find(r => r.id === recipeId) : null;
  if (!recipe) return null; // 未知配方：fail closed，返回 null 交由 canAssembleAtShipyard 判否
  // 通过舰船类型判断级别：查找 shipId 的 type
  const shipConfig = (typeof getShipConfigById === "function") ? getShipConfigById(recipe.shipId) : null;
  if (!shipConfig) {
    // fallback: 按 recipeId 判断（理论上 getShipConfigById 必命中；未知 type 一律按 Lv.0 处理，不伪装）
    if (recipeId === "starcrown" || recipeId === "eternal_fortress" || recipeId === "arbiter") return 3;
    if (recipeId === "firmament" || recipeId === "heavy_bastion" || recipeId === "riftbreaker" || recipeId === "orca" || recipeId === "illuminator") return 2;
    return 0;
  }
  const shipType = shipConfig.type || "";
  // 超级旗舰组装：Lv.3
  if (shipType === "supercapital") return 3;
  // 旗舰/工业旗舰/考古旗舰组装：Lv.2
  if (shipType === "capital" || shipType === "industrial_capital" || shipType === "archaeology_capital") return 2;
  // 常规/工业/考古非旗舰：Lv.0
  return 0;
}

function canAssembleAtShipyard(state, recipeId) {
  // 阻塞判定唯一复用本函数（不得复制第二套规则）；门槛文本由 getShipyardAssemblyLevelRequirement 提供。
  // 未知配方（required === null）必须判否，不得因 null <= level 被 JS 隐式转 0 而误通过。
  const required = getShipyardAssemblyLevelRequirement(state, recipeId);
  if (required === null) return false;
  return getShipyardLevel(state) >= required;
}

// ---- 确定性余数节省（quote + commit 两阶段）----
function getShipyardProductionQuote(state, recipe, cycles) {
  const savingRate = getShipyardSavingRate(state);
  const savingsLedger = state.station.shipyard.savingsLedger || {};
  const payable = {};
  const saved = {};
  const nextRemainders = {};
  const cc = recipe.componentCost || {};
  const mc = recipe.materialCost || {};
  const combined = {};
  for (const [key, qty] of Object.entries(cc)) combined["component:" + key] = qty * cycles;
  for (const [key, qty] of Object.entries(mc)) combined[key] = qty * cycles;
  for (const [ref, totalQty] of Object.entries(combined)) {
    const oldRem = Number(savingsLedger[ref]) || 0;
    const rawSaving = totalQty * savingRate + oldRem;
    const savedUnits = Math.floor(rawSaving);
    payable[ref] = Math.max(0, totalQty - savedUnits);
    saved[ref] = savedUnits;
    nextRemainders[ref] = rawSaving - savedUnits;
    if (!Number.isFinite(nextRemainders[ref]) || nextRemainders[ref] < 0) nextRemainders[ref] = 0;
    if (nextRemainders[ref] >= 1) nextRemainders[ref] = 0.999999;
  }
  return { payable, saved, nextRemainders, totalSaved:Object.values(saved).reduce((a,b)=>a+b,0), recipeId: recipe.id || null };
}

function canAffordShipyardQuote(state, quote) {
  for (const [ref, qty] of Object.entries(quote.payable)) {
    // ref 形态：component:xxx 走精确读；纯材料名（materialCost 键）跨命名空间按名聚合
    const stock = ResourceRegistry.getByRef(state, ref);
    if (stock < qty) return false;
  }
  return true;
}

function commitShipyardProductionQuote(state, quote) {
  // fail-closed：内部再次验证全部可支付（materialCost 键按材料名解析）
  for (const [ref, qty] of Object.entries(quote.payable)) {
    const stock = ResourceRegistry.getByRef(state, ref);
    if (stock < qty) return { changed:false, reason:"insufficient-materials", ref, need:qty, have:stock };
  }
  for (const [ref, qty] of Object.entries(quote.payable)) {
    ResourceRegistry.spendByRef(state, ref, qty);
  }
  const ledger = state.station.shipyard.savingsLedger || {};
  for (const [ref, remainder] of Object.entries(quote.nextRemainders)) {
    ledger[ref] = remainder;
  }
  state._dirty = true;
  return { changed:true };
}

// ---- 建筑综合显示态 ----
function getStationBuildingEffectsDisplayState(state) {
  return {
    archaeologyLabMultiplier: getArchaeologyLabMultiplier(state),
    combatXpMultiplier: getStationCombatXpMultiplier(state),
    shipyardSpeedMultiplier: getShipyardSpeedMultiplier(state),
    shipyardSavingRate: getShipyardSavingRate(state),
    capitalUnlocked: getShipyardLevel(state) >= 2,
    supercapitalUnlocked: getShipyardLevel(state) >= 3,
    operational: isStationOperational(state),
    stationLogisticsMultiplier: getStationLogisticsMultiplier(state)
  };
}

// ---- 综合后勤倍率（Phase 3C-7，系数 B 扩展）----
// Lv.0=×1, Lv.1=×1.03, Lv.2=×1.08, Lv.3=×1.15, Lv.4=×1.24；断油=×1；非法 bodyLevel/NaN/Infinity fail-closed ×1
// 独立速度乘区，仅缩短周期时间，不改变产量/XP/材料/掉落/成功率
// 系数 B（2026-08-06）：传入 coreTag 且对应空间站核心已获取并持有库存时，该制造线额外 +10%（加算，非乘算）。
const STATION_CORE_RESOURCE = {
  smelt:   "special:空间站冶炼核心",
  shipEng: "special:空间站船坞核心",
  equipEng:"special:空间站装备制造核心",
  booster: "special:空间站增强剂制造核心",
};
// coreTag → 自动线 lineId 映射：决定系数 B 接入哪条自动线。
// 冶炼/装备制造/增强剂三条自动线走 getStationLogisticsMultiplier；船坞(shipyard)的的核心加成不在此映射，
// 而是并入 getShipyardSavingRate（部件制造材料消耗 -2%，与船坞等级节省加算）。
const LINE_CORE_TAG = { smelting: "smelt", equipment: "equipEng", booster: "booster" };
// 基础物流倍率：不含 GAME_SPEED（十倍速），但保留「空间站运行状态 + 核心加成语义」。
// 用于成就判定（H13）等不应被速度开关扭曲的场景（speed=10 时 Lv.1 的 1.03 不会被放大成 10.3）。
function getAllianceMemberLogisticsBonus(state) {
  const alliance = state && state.alliance;
  const memberCount = alliance && alliance.isMember === true ? Math.floor(Number(alliance.memberCount)) : 0;
  if (memberCount >= 10) return 0.30;
  if (memberCount >= 5) return 0.20;
  if (memberCount >= 1) return 0.10;
  return 0;
}

function getStationLogisticsBaseMultiplier(state, coreTag) {
  const s = state && state.station;
  if (!s) return 1;
  let bodyLevel = Math.floor(Number(s.bodyLevel));
  if (!Number.isFinite(bodyLevel) || bodyLevel < 0 || bodyLevel > 5) return 1;
  if (!isStationOperational(state)) return 1;
  const table = {0: 1, 1: 1.03, 2: 1.08, 3: 1.15, 4: 1.24, 5: 1.35};
  const base = table[bodyLevel] !== undefined ? table[bodyLevel] : 1;
  let mult = base;
  // 系数 B：携带对应空间站核心（已获取且库存持有）时该制造线 +10%（加算，叠在本体基础倍率上）
  if (coreTag && STATION_CORE_RESOURCE[coreTag]) {
    const obtained = state.stationCoresObtained || {};
    const held = (typeof ResourceRegistry !== "undefined")
      ? Number(ResourceRegistry.get(state, STATION_CORE_RESOURCE[coreTag])) || 0
      : 0;
    if (obtained[coreTag] && held > 0) mult += 0.10;
  }
  // 联盟后勤：只读取游戏从云端回传并落入存档的联盟摘要；成员人数档位为
  // 1–4 人 +0.10、5–9 人 +0.20、10 人 +0.30，和空间站本体/核心加算。
  // 不在联盟或联盟数据无效时为 0；联盟加成不绕过空间站未建立/断油状态。
  mult += getAllianceMemberLogisticsBonus(state);
  return mult;
}
// 生产用物流倍率：基础倍率 × 十倍速开关（仅缩放产出周期，冷却/到期仍实时）。
// speed=1 时恒为 1，与基础倍率一致；speed=10 时放大产出速度（保留 X10 效果，不用于成就判定）。
function getStationLogisticsMultiplier(state, coreTag) {
  const base = getStationLogisticsBaseMultiplier(state, coreTag);
  const speed = (typeof getGameSpeed === "function") ? getGameSpeed() : 1;
  return base * speed;
}

function getStationLogisticsDisplayState(state) {
  const s = state && state.station;
  const bodyLevel = s ? (Math.floor(Number(s.bodyLevel)) || 0) : 0;
  const operational = isStationOperational(state);
  const multiplier = getStationLogisticsBaseMultiplier(state);
  const allianceBonusRate = getAllianceMemberLogisticsBonus(state);
  const bonusRate = multiplier - 1;
  const bodyName = getStationBodyName(bodyLevel);
  let disabledReason = null;
  let text = "";
  if (bodyLevel === 0) { disabledReason = "no-station"; text = "未建立"; }
  else if (!operational) { disabledReason = "no-fuel"; text = "燃料不足"; }
  else { text = "+" + Math.round(bonusRate * 100) + "%"; }
  return { bodyLevel, bodyName, operational, bonusRate, multiplier, allianceBonusRate, disabledReason, text };
}

// Phase 3C-8：统一空间站页面显示态
function getStationPageDisplayState(state, now) {
  const renderNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const bodyRaw = (typeof getStationBodyDisplayState === "function") ? getStationBodyDisplayState(state, renderNow) : {};
  // 补齐 body nextCostRows/durationMs/blockedText
  const bodyLevel = Number(bodyRaw.bodyLevel) || 0;
  const nextLevel = bodyLevel < getStationMaxBodyLevel(state) ? bodyLevel + 1 : null;
  const nextPlan = nextLevel && STATION_BODY_PLANS[nextLevel];
  const atMax = bodyLevel >= getStationMaxBodyLevel(state);
  const body = {
    bodyLevel, bodyName: bodyRaw.bodyName || "未建立",
    nextLevel, nextName: nextPlan ? nextPlan.name : null,
    nextDesc: nextPlan ? (nextPlan.desc || null) : null,
    currentConstruction: bodyRaw.currentConstruction || null,
    remainingMs: bodyRaw.remainingMs || 0,
    nextCostRows: nextPlan ? buildStationCostRows(state, nextPlan.isk, nextPlan.materials) : [],
    durationMs: nextPlan ? getStationConstructionDurationMs(state, nextPlan) : 0,
    canStart: bodyRaw.canStart || false,
    blockedReason: atMax ? "max-level" : (bodyRaw.blockedReason || null),
    blockedText: atMax ? "已达到最高等级" : (bodyRaw.blockedText || null)
  };

  const maintenance = (typeof getStationMaintenanceDisplayState === "function") ? getStationMaintenanceDisplayState(state, renderNow) : {};

  const buildingsRaw = (typeof getStationBuildingsDisplayState === "function") ? getStationBuildingsDisplayState(state, renderNow) : [];
  const buildings = (buildingsRaw || []).map(function(b) {
    const plan = b.nextPlan || (b.level < STATION_MAX_BUILDING_LEVEL ? getStationBuildingPlan(b.buildingId, b.level + 1) : null);
    return {
      buildingId: b.buildingId, name: b.name || b.buildingId,
      level: b.level || 0, nextLevel: b.level < STATION_MAX_BUILDING_LEVEL ? b.level + 1 : null,
      isConstructingThis: b.isConstructingThis || false,
      effectText: b.effectText || "",
      nextEffectText: b.nextEffectText || (plan ? plan.effectText || "" : ""),
      durationMs: plan ? getStationConstructionDurationMs(state, plan) : 0,
      nextCostRows: plan ? buildStationCostRows(state, plan.isk, plan.materials, plan.lp) : [],
      canUpgrade: b.canUpgrade || false,
      blockedReason: b.blockedReason || null,
      blockedText: b.blockedText || null
    };
  });

  // Generate auto-line display from real recipe pools
  var autoLines = [];
  var alConfigs = [
    { lineId:"smelting", buildingId:"smelting_refinery", recipePool:typeof SMELTING_RECIPES!="undefined"?SMELTING_RECIPES:[], keyFn:function(r){return r.name;}, skillKey:"refining", category:"smelting" },
    { lineId:"equipment", buildingId:"equipment_factory", recipePool:typeof EQUIPMENT_ENGINEERING_RECIPES!="undefined"?EQUIPMENT_ENGINEERING_RECIPES:[], keyFn:function(r){return r.id;}, skillKey:"equipmentEngineering", excludeShip:true, allowedCategories:EQUIPMENT_AUTO_LINE_CATEGORIES },
    { lineId:"booster", buildingId:"booster_factory", recipePool:typeof BOOSTER_RECIPES!="undefined"?BOOSTER_RECIPES:[], keyFn:function(r){return r.id;}, skillKey:"boosterEngineering" }
  ];
  // 自动线目标显示名解析：只认配方的正式中文名称字段（recipe.name）。
  // 查不到配方、或配方缺正式名称时一律返回"未知配方"——绝不用内部 recipeId 兜底，
  // 避免 mining_lubricant_n 这类内部 ID 泄漏到界面。id 只作稳定 option.value 与调试用。
  var UNKNOWN_RECIPE_NAME = "未知配方";
  function findAutoLineRecipe(cfg, targetId) {
    if (!targetId) return null;
    return cfg.recipePool.find(function(r) { return cfg.keyFn(r) === targetId; }) || null;
  }
  function autoLineTargetName(recipe, lineId) {
    var nm = recipe && typeof recipe.name === "string" ? recipe.name.trim() : "";
    if (!nm) return UNKNOWN_RECIPE_NAME;
    // 矿带类配方（冶炼自动线）：内部 name 为原矿星带名（如"凡晶石带"），
    // 显示层统一走 DisplayNames.getAreaName 转换为原创名（如"铁硅原矿带"）。
    // 非星带配方（装备/加成工厂）未在 AREA_NAMES 映射，getAreaName 回退原值，无副作用。
    if (typeof DisplayNames !== "undefined" && DisplayNames && typeof DisplayNames.getAreaName === "function") {
      nm = DisplayNames.getAreaName(nm, nm);
    }
    // 冶炼自动线冶炼的是原矿/矿物，不是星带，去掉显示名末尾的"带"字。
    // 内部 targetId（selectedTargetId/startedTargetId）仍保留"带"字，旧存档与后端结算不受影响。
    if (lineId === "smelting" && typeof nm === "string" && nm.charAt(nm.length - 1) === "带") {
      nm = nm.slice(0, nm.length - 1);
    }
    return nm;
  }

  autoLines = alConfigs.map(function(cfg) {
    var line = state.station && state.station.autoLines ? state.station.autoLines[cfg.lineId] : null;
    var skillLvl = Number(state.skills[cfg.skillKey] && state.skills[cfg.skillKey].lvl) || 1;
    var targets = cfg.recipePool.filter(function(r) {
      if (cfg.excludeShip && (r.category === "ship" || r.category === "shipComponent")) return false;
      // 产线白名单：装备自动线仅显示消耗品类（燃料/弹药/探针）
      if (cfg.allowedCategories && cfg.allowedCategories.indexOf(r.category) === -1) return false;
      return skillLvl >= (r.level || 1);
    }).map(function(r) {
      // option.value 用稳定内部 id；option 文本只用正式中文名称。
      // category 透传给 UI（按应用类聚成 <optgroup>），缺省回落到产线 category / lineId。
      var opt = { id:cfg.keyFn(r), name:autoLineTargetName(r, cfg.lineId), level:r.level||1, category:(r.category || cfg.category || cfg.lineId) };
      // equipment / booster 线：透传蓝图状态，供 UI 灰显「需蓝图」选项
      if (cfg.lineId === "equipment" || cfg.lineId === "booster") {
        opt.requiresBlueprint = !!r.requiresBlueprint;
        opt.hasRequiredBlueprint = opt.requiresBlueprint
          ? (cfg.lineId === "equipment" ? manufacturingRecipeHasBlueprint(state, r) : hasBoosterBlueprintFromState(state, r.id))
          : true;
      }
      return opt;
    });
    var baseDisplay = (typeof getStationAutoLineDisplayState === "function") ? getStationAutoLineDisplayState(state, cfg.lineId) : {};
    var bm = getStationBuildingSpeedMultiplier(state, cfg.buildingId);
    var lm = (typeof getStationLogisticsMultiplier === "function") ? getStationLogisticsMultiplier(state) : 1;
    var effMult = bm * lm;
    var lineData = line || {};
    var selectedTarget = lineData.selectedTargetId || null;
    var startedTarget = lineData.startedTargetId || null;
    // Find matching recipe for started or selected target（周期计算用，运行中优先按已启动配方）
    var matchedRecipe = findAutoLineRecipe(cfg, startedTarget || selectedTarget);
    var cycleDurationSec = (typeof getStationAutoLineCycleDuration === "function" && matchedRecipe)
      ? getStationAutoLineCycleDuration(state, cfg.lineId, matchedRecipe) : 0;
    var progressVal = Number(lineData.progress) || 0;
    var progressRatio = cycleDurationSec > 0 ? Math.min(1, Math.max(0, progressVal / cycleDurationSec)) : 0;
    var remainingSec = cycleDurationSec > 0 ? Math.max(0, cycleDurationSec - progressVal) : 0;
    var running = !!(lineData.enabled && lineData.startedTargetId && !lineData.stoppedReason);
    return {
      lineId: cfg.lineId,
      name: AUTO_LINE_CONFIG[cfg.lineId].name,
      buildingId: cfg.buildingId,
      selectedTargetId: selectedTarget,
      // 各自按自己的 recipe.id 独立查配方读中文名，互不串味；未选择/未启动时为 null。
      selectedTargetName: selectedTarget ? autoLineTargetName(findAutoLineRecipe(cfg, selectedTarget), cfg.lineId) : null,
      startedTargetId: startedTarget,
      startedTargetName: startedTarget ? autoLineTargetName(findAutoLineRecipe(cfg, startedTarget), cfg.lineId) : null,
      // 限次抄本（BPC）：运行中优先、否则选中的探针配方剩余流程数（非 BPC 恒 null），供 UI 显示。
      selectedBlueprintRuns: (matchedRecipe && typeof isProbeBlueprintRecipe === "function" && isProbeBlueprintRecipe(matchedRecipe))
        ? ((typeof manufacturingMaxCyclesByBlueprint === "function") ? manufacturingMaxCyclesByBlueprint(state, matchedRecipe) : 0)
        : null,
      running: running,
      // 必须透传 targetQuantity / producedQty：核心结算按这两个字段停止，
      // 但 UI 显示态若不携带，prodText 会误判为「无限」。
      targetQuantity: (baseDisplay && baseDisplay.targetQuantity) || 0,
      producedQty: (baseDisplay && baseDisplay.producedQty) || 0,
      targetOptions: targets,
      buildingMultiplier: bm,
      logisticsMultiplier: lm,
      effectiveMultiplier: effMult,
      cycleDurationMs: cycleDurationSec * 1000,
      progress: progressVal,
      progressRatio: progressRatio,
      remainingMs: remainingSec * 1000,
      canStart: baseDisplay.canStart === true,
      canStop: running,
      blockedReason: baseDisplay.blockedReason || null,
      stoppedReason: lineData.stoppedReason || null,
      stoppedText: lineData.stoppedReason === "insufficient-materials" ? "材料不足"
        : lineData.stoppedReason === "user-stopped" ? "已停止"
        : lineData.stoppedReason === "target-not-allowed" ? "目标不在产线范围"
        : lineData.stoppedReason || null
    };
  });

  // Build 9 effect rows from real building effects state
  var effectsRaw = (typeof getStationBuildingEffectsDisplayState === "function") ? getStationBuildingEffectsDisplayState(state) : {};
  var op = effectsRaw.operational !== false;
  var lvl = function(id) { return getStationBuildingLevel(state, id); };
  var buildingNames = { resource_dispatch:"资源调度中心", planetary_control:"行星管控中心", smelting_refinery:"冶炼精炼厂", equipment_factory:"装备制造厂", booster_factory:"增强剂制造厂", archaeology_lab:"考古实验室", combat_command:"作战指挥中心", shipyard:"舰船船坞" };
  // 综合后勤只依赖本体等级和燃料，不依赖资源调度中心
  var bodyLevelForLogistics = (typeof getStationLogisticsBaseMultiplier === "function") ? getStationLogisticsBaseMultiplier(state) : 1;
  var logisticsActive = op && bodyLevel > 0;
  var effectDefs = [
    { id:"logistics", name:"综合后勤", bid:null, text:(bodyLevel >= 1 ? (op ? "综合后勤 ×"+bodyLevelForLogistics.toFixed(2) : "综合后勤 ×1.00（燃料不足）") : "综合后勤 ×1.00（未建立）") },
    { id:"dispatch", name:"资源调度中心", bid:"resource_dispatch", text:lvl("resource_dispatch")>=1?"勘探指令阈值 "+[20,14,10,9,8][Math.min(4,lvl("resource_dispatch")-1)]:"未建造" },
    { id:"planetary", name:"行星管控中心", bid:"planetary_control", text:lvl("planetary_control")>=1?"自动收取·槽位+"+[0,1,2,3,4][Math.min(4,lvl("planetary_control")-1)]:"未建造" },
    { id:"smelting", name:"冶炼精炼厂", bid:"smelting_refinery", text:lvl("smelting_refinery")>=1?"自动线 ×"+[1,1.15,1.30,1.40,1.50][Math.min(4,lvl("smelting_refinery")-1)].toFixed(2):"未建造" },
    { id:"equipment", name:"装备制造厂", bid:"equipment_factory", text:lvl("equipment_factory")>=1?"自动线 ×"+[1,1.15,1.30,1.40,1.50][Math.min(4,lvl("equipment_factory")-1)].toFixed(2):"未建造" },
    { id:"booster", name:"增强剂制造厂", bid:"booster_factory", text:lvl("booster_factory")>=1?"自动线 ×"+[1,1.15,1.30,1.40,1.50][Math.min(4,lvl("booster_factory")-1)].toFixed(2):"未建造" },
    { id:"archaeology", name:"考古实验室", bid:"archaeology_lab", text:lvl("archaeology_lab")>=1?"独特文物倍率 ×"+((effectsRaw.archaeologyLabMultiplier||1)).toFixed(2):"未建造" },
    { id:"combat", name:"作战指挥中心", bid:"combat_command", text:lvl("combat_command")>=1?"战斗XP ×"+((effectsRaw.combatXpMultiplier||1)).toFixed(2):"未建造" },
    { id:"shipyard", name:"舰船船坞", bid:"shipyard", text:lvl("shipyard")>=1?"速度 ×"+((effectsRaw.shipyardSpeedMultiplier||1)).toFixed(2)+"·节省 "+(Math.round((effectsRaw.shipyardSavingRate||0)*100))+"%":"未建造", shipyardException:true }
  ];
  var effectRows = effectDefs.map(function(e) {
    var built = !e.bid || lvl(e.bid) >= 1;
    // 综合后勤（bid=null）：bodyLevel>=1 且有油时 active；bodyLevel=0 或断油时 inactive
    var isLogistics = (e.id === "logistics");
    var dr = null;
    if (!built) dr = "未建造";
    else if (isLogistics && !op && bodyLevel >= 1) dr = "燃料不足";
    else if (isLogistics && bodyLevel === 0) dr = "未建立";
    else if (!op && e.bid && e.bid !== "shipyard") dr = "燃料不足";
    var isActive = built && (e.bid === "shipyard" || (isLogistics ? (op && bodyLevel >= 1) : (e.bid ? op : true)));
    return { id:e.id, name:e.name, text:e.text, level:e.bid?lvl(e.bid):0, active:isActive, disabledReason:dr, shipyardException:e.bid==="shipyard"&&built };
  });

  const logistics = (typeof getStationLogisticsDisplayState === "function") ? getStationLogisticsDisplayState(state) : {};

  // ---- 空间站核心加成（展示层）----
  // 读 stationCoresObtained[coreTag] + 库存持有，输出四核心激活状态与效果文案。
  var coreEffectDefs = [
    { coreTag:"smelt",   label:"冶炼核心",   effectText:"自动线 +10%" },
    { coreTag:"shipEng", label:"船坞核心",   effectText:"部件制造材料 -2%" },
    { coreTag:"equipEng",label:"装备制造核心", effectText:"自动线 +10%" },
    { coreTag:"booster", label:"增强剂核心", effectText:"自动线 +10%" }
  ];
  var obtainedMap = state.stationCoresObtained || {};
  var coreEffects = coreEffectDefs.map(function(c) {
    var obtained = obtainedMap[c.coreTag] === true;
    var held = (typeof ResourceRegistry !== "undefined" && STATION_CORE_RESOURCE[c.coreTag])
      ? (Number(ResourceRegistry.get(state, STATION_CORE_RESOURCE[c.coreTag])) || 0)
      : 0;
    var active = obtained && held > 0;
    return { coreTag:c.coreTag, label:c.label, effectText:c.effectText, obtained:obtained, held:held, active:active };
  });

  // corporation 读 state.corporation
  var corp = state.corporation || {};
  const corporation = {
    name: corp.name || "未成立",
    foundedAt: corp.foundedAt || null,
    npcWorkers: (corp.dlc && corp.dlc.npcWorkers) || false,
    combatWings: (corp.dlc && corp.dlc.combatWings) || false,
    statusText: "军团 NPC 工作、战斗编队与任务系统为 DLC 预留，当前未开放"
  };

  return { body, maintenance, buildings, autoLines, effects:effectRows, logistics, corporation, coreEffects };
}

function buildStationCostRows(state, isk, materials, lp) {
  var rows = [];
  if (Number.isFinite(isk) && isk > 0) {
    var haveIsk = 0;
    if (ResourceRegistry && ResourceRegistry.get) haveIsk = ResourceRegistry.get(state, "currency:isk");
    rows.push({ ref:"currency:isk", displayName:"星币", quantity:isk, have:haveIsk, enough:haveIsk >= isk });
  }
  if (Number.isFinite(lp) && lp > 0) {
    var haveLp = 0;
    if (ResourceRegistry && ResourceRegistry.get) haveLp = ResourceRegistry.get(state, "currency:lp");
    rows.push({ ref:"currency:lp", displayName:"功勋", quantity:lp, have:haveLp, enough:haveLp >= lp });
  }
  if (materials && typeof materials === "object") {
    for (var ref in materials) {
      if (materials.hasOwnProperty(ref)) {
        var qty = materials[ref];
        var have = 0;
        if (ResourceRegistry.getByRef) have = ResourceRegistry.getByRef(state, ref);
        else if (ResourceRegistry.getMaterialStock) have = ResourceRegistry.getMaterialStock(state, ref);
        rows.push({ ref:ref, displayName:(typeof getResourceDisplayName === "function" ? getResourceDisplayName(ref) : ref.replace(/^(mineral|planetary|moon|special|component):/, "")), quantity:qty, have:have, enough:have >= qty });
      }
    }
  }
  return rows;
}

function getStationBuildingPlan(buildingId, level) {
  var plans = STATION_BUILDING_PLANS;
  if (!plans || !plans[buildingId]) return null;
  return plans[buildingId][level] || null;
}

const StationSystem = {
  STATION_BODY_PLANS,
  STATION_MAX_BODY_LEVEL,
  STATION_BUILDING_ID_LIST,
  STATION_BUILDING_NAMES,
  STATION_MAX_BUILDING_LEVEL,
  STATION_BUILDING_LEVEL_PLANS,
  STATION_BUILDING_PLANS,
  STATION_LEGION_HALL_PLANS,
  AUTO_LINE_IDS,
  AUTO_LINE_CONFIG,
  getStationBodyName,
  buildStationCostSnapshot,
  startStationBodyConstruction,
  completeStationConstruction,
  getStationBodyDisplayState,
  startStationBuildingConstruction,
  getStationBuildingLevel,
  getStationBuildingDisplayState,
  getStationBuildingsDisplayState,
  getStationDispatchThreshold,
  recordStationDispatchAction,
  resetStationDispatchCounters,
  getStationPlanetarySlotBonus,
  getStationAutoCollectEnabled,
  applyStationAutoCollect,
  getStationAutoLineInfo,
  getStationBuildingSpeedMultiplier,
  getStationAutoLineCycleDuration,
  processAutoLines,
  getStationAutoLineDisplayState,
  getStationAutoLinesDisplayState,
  getStationPageDisplayState,
  getStationBuildingPlan,
  buildStationCostRows,
  // Phase 3C-6
  MAINTENANCE_WEEKLY_FUEL_PER_POINT,
  MAINTENANCE_WEEK_MS,
  getStationMaintenancePoints,
  getStationFuelBurnRatePerMs,
  getStationEffectiveFuelBurnRatePerMs,
  getStationConstructionDurationMs,
  // 军团 DLC 内容授权接口 + 管理 NPC 经验倍率
  getStationDlcNpcWorkers,
  getStationMaxBodyLevel,
  getStationManagementNpcXpTotal,
  getStationManagementNpcXpMultiplier,
  isStationOperational,
  settleStationMaintenance,
  getStationRefillMaintenanceState,
  getStationMaintenanceDisplayState,
  getArchaeologyLabMultiplier,
  getStationCombatXpMultiplier,
  addStationModifiedCombatXp,
  getShipyardSpeedMultiplier,
  getShipyardSavingRate,
  getShipyardLevel,
  canManufactureAtShipyard,
  canAssembleAtShipyard,
  getShipyardAssemblyLevelRequirement,
  getShipyardProductionQuote,
  canAffordShipyardQuote,
  commitShipyardProductionQuote,
  getStationBuildingEffectsDisplayState,
  getStationLogisticsBaseMultiplier,
  getStationLogisticsMultiplier,
  getStationLogisticsDisplayState
};
if (typeof window !== "undefined") {
  window.StationSystem = StationSystem;
  window.startStationBodyConstruction = startStationBodyConstruction;
  window.completeStationConstruction = completeStationConstruction;
  window.getStationBodyDisplayState = getStationBodyDisplayState;
  window.startStationBuildingConstruction = startStationBuildingConstruction;
  window.getStationBuildingLevel = getStationBuildingLevel;
  window.getStationBuildingDisplayState = getStationBuildingDisplayState;
  window.getStationBuildingsDisplayState = getStationBuildingsDisplayState;
  window.getStationDispatchThreshold = getStationDispatchThreshold;
  window.recordStationDispatchAction = recordStationDispatchAction;
  window.resetStationDispatchCounters = resetStationDispatchCounters;
  window.getStationPlanetarySlotBonus = getStationPlanetarySlotBonus;
  window.getStationAutoCollectEnabled = getStationAutoCollectEnabled;
  window.applyStationAutoCollect = applyStationAutoCollect;
  window.getStationAutoLineInfo = getStationAutoLineInfo;
  window.getStationBuildingSpeedMultiplier = getStationBuildingSpeedMultiplier;
  window.processAutoLines = processAutoLines;
  window.getStationAutoLineDisplayState = getStationAutoLineDisplayState;
  window.getStationAutoLinesDisplayState = getStationAutoLinesDisplayState;
  // Phase 3C-6
  window.getStationMaintenancePoints = getStationMaintenancePoints;
  window.getStationFuelBurnRatePerMs = getStationFuelBurnRatePerMs;
  // 研究批次 G：燃料实耗（fuel 组）与建设时长（build 组）的唯一计算层
  window.getStationEffectiveFuelBurnRatePerMs = getStationEffectiveFuelBurnRatePerMs;
  window.getStationConstructionDurationMs = getStationConstructionDurationMs;
  // 军团 DLC 内容授权接口 + 管理 NPC 经验倍率
  window.getStationDlcNpcWorkers = getStationDlcNpcWorkers;
  window.getStationMaxBodyLevel = getStationMaxBodyLevel;
  window.getStationManagementNpcXpTotal = getStationManagementNpcXpTotal;
  window.getStationManagementNpcXpMultiplier = getStationManagementNpcXpMultiplier;
  window.isStationOperational = isStationOperational;
  window.settleStationMaintenance = settleStationMaintenance;
  window.getStationRefillMaintenanceState = getStationRefillMaintenanceState;
  window.getStationMaintenanceDisplayState = getStationMaintenanceDisplayState;
  window.getArchaeologyLabMultiplier = getArchaeologyLabMultiplier;
  window.getStationCombatXpMultiplier = getStationCombatXpMultiplier;
  window.addStationModifiedCombatXp = addStationModifiedCombatXp;
  window.getShipyardSpeedMultiplier = getShipyardSpeedMultiplier;
  window.getShipyardSavingRate = getShipyardSavingRate;
  window.getShipyardLevel = getShipyardLevel;
  window.canManufactureAtShipyard = canManufactureAtShipyard;
  window.canAssembleAtShipyard = canAssembleAtShipyard;
  window.getShipyardAssemblyLevelRequirement = getShipyardAssemblyLevelRequirement;
  window.getShipyardProductionQuote = getShipyardProductionQuote;
  window.canAffordShipyardQuote = canAffordShipyardQuote;
  window.commitShipyardProductionQuote = commitShipyardProductionQuote;
  window.getStationBuildingEffectsDisplayState = getStationBuildingEffectsDisplayState;
  // Phase 3C-7
  window.getStationLogisticsMultiplier = getStationLogisticsMultiplier;
  window.getStationLogisticsBaseMultiplier = getStationLogisticsBaseMultiplier;
  window.getStationLogisticsDisplayState = getStationLogisticsDisplayState;
  // Phase 3C-8
  window.getStationPageDisplayState = getStationPageDisplayState;
}
