// ============================================================================
//  js/systems/research.js
//  研究系统逻辑层 —— 批次 B：状态/单槽队列；批次 C：在线/离线统一时间结算
//
//  职责：
//    - parseResearchStepKey(key)        严格解析 "techId@targetLevel"
//    - getResearchNode(techId)          取节点
//    - getResearchDuration(techId,lvl)  取冻结时长（秒）
//    - isStepValidAgainst(levels,...)   步骤合法性（恰好下一等级 + 前置满足）
//    - buildProjectedResearchLevels(s)  投影等级（completed + active + queue）
//    - enqueueResearch(state,...)       入队（投影校验 + 占用校验 + 上限 20）
//    - startResearch(state,...)         公共开始：先 processResearchUntil(now)
//                                       再真实等级校验启动（§4.7 不变式）
//    - startNextFromQueue(state,atMs)   队首真实校验启动（带 guard，私有原语）
//    - processResearchUntil(state,now)  ★ 在线/离线唯一时间结算入口（§4.2）
//    - completeResearchStep(state,atMs) 完成当前步骤（历史/事件/等级写入）
//    - getResearchProgress(state)       只读进度查询（ratio 夹紧 [0,1]）
//
//  时间结算铁律（§4.1/§4.2/§4.4，风险 2/3/12）：
//    - 唯一时间锚点 research.lastProcessedAt（ms）。不读 lastActiveTime，
//      不存在 lastResearchUpdate。startedAt 仅展示。
//    - 24h（86400s）封顶只在 processResearchUntil 内应用一次；调用方只传
//      绝对 now，不传 elapsed、不预封顶。超限部分随锚点推到 now 永久丢弃。
//    - 时钟倒退：elapsed=0，锚点 max() 单调不倒退。
//    - 多步离线完成用虚拟游标 cursorAt：history.completedAt 与下一步
//      startedAt 均为对应 cursorAt，不写登录时刻。
//    - 防递归：结算循环内用私有 beginResearchStep 启动原语；公共
//      startResearch 先结算再启动，绝不在循环内回调公共入口。
//    - 只推进科研；不执行任何协议业务（协议解锁仅表现为 completedLevels）。
//
//  依赖：ResearchData（js/data/research.js，挂 window/globalThis）。
//  事件：GameEvents.emit("research:stepCompleted", {techId, level}, {timestamp: atMs})，
//        每步严格一次；payload 固定 {techId, level}，atMs=完成该步的虚拟游标。
//  持久化：所有成功状态变更（入队/启动/完成/实际推进/修复非法）标记 state._dirty=true；
//        仅推进空闲锚点（activeResearch=null）不强制 dirty，沿用现有自动保存。
// ============================================================================

'use strict';

(function () {
  const RD =
    (typeof globalThis !== "undefined" && globalThis.ResearchData) ||
    (typeof window !== "undefined" && window.ResearchData) ||
    null;

  // -------------------------------------------------------------------------
  // 节点 / 时长访问
  // -------------------------------------------------------------------------
  function getResearchNode(techId) {
    if (!RD || !Array.isArray(RD.NODES)) return null;
    return RD.NODES.find((n) => n.id === techId) || null;
  }

  function getResearchDuration(techId, targetLevel) {
    const node = getResearchNode(techId);
    if (!node) return null;
    if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > node.maxLevel) return null;
    return node.durationByLevel[targetLevel - 1];
  }

  // 军团研究分支外部门禁（可用性 / 内容门禁，非前置科技）：
  //   本体等级 >= 2 且 军团议事大厅已建成(等级 >= 1) 且 军团 DLC 授权通过。
  //   DLC 接口缺失时视为放行（避免硬依赖；接入正式 DLC 后由该接口真实判定）。
  //   legion 分支锁定时：不能开始 / 不能入队；主研究树完全不受影响。
  function isLegionResearchUnlocked(state) {
    const bodyLevel = state && state.station ? (state.station.bodyLevel || 0) : 0;
    if (bodyLevel < 2) return false;
    const b = state && state.station && state.station.buildings;
    const hall = b && b.legion_hall;
    if (!(typeof hall === "number" && hall >= 1)) return false;
    if (typeof getStationDlcNpcWorkers === "function" && !getStationDlcNpcWorkers(state)) return false;
    return true;
  }

  // 人类可读的未解锁原因（供 UI 展示）；已解锁返回空串。
  function getLegionResearchLockReason(state) {
    const bodyLevel = state && state.station ? (state.station.bodyLevel || 0) : 0;
    if (bodyLevel < 2) return "需要 本体等级 ≥ 2（当前 " + bodyLevel + "）";
    const b = state && state.station && state.station.buildings;
    const hall = b && b.legion_hall;
    if (!(typeof hall === "number" && hall >= 1)) return "需要建造 军团大厅（legion_hall）≥ 1 级";
    if (typeof getStationDlcNpcWorkers === "function" && !getStationDlcNpcWorkers(state)) return "需要 军团 DLC 授权";
    return "";
  }

  // -------------------------------------------------------------------------
  // 持久化标记（批次 C 返修）：成功状态变更后置 state._dirty=true，
  // 沿用现有 setInterval 自动保存（约 5s 周期），不在此处直接调用 SaveManager。
  // 仅推进空闲锚点（activeResearch=null）不强制 dirty，避免空闲每 tick 保存。
  // 失败且未改变科研状态时绝不设置 dirty。
  // -------------------------------------------------------------------------
  function markResearchDirty(state) {
    if (state && typeof state === "object") {
      state._dirty = true;
    }
  }

  // -------------------------------------------------------------------------
  // 严格解析 step key："techId@targetLevel"
  //   拒绝：空串 / 多余 @ / 缺 @ / 非法 techId / 小数 / NaN / Infinity / 0 / 负数 /
  //         超过 maxLevel。返回 { techId, targetLevel } 或 null。
  //   等级字段统一叫 targetLevel（与 activeResearch 结构一致）。
  // -------------------------------------------------------------------------
  function parseResearchStepKey(key) {
    if (typeof key !== "string") return null;
    if (key.length === 0) return null;
    const parts = key.split("@");
    if (parts.length !== 2) return null; // 多余 @ 或缺 @
    const techId = parts[0];
    if (techId.length === 0) return null;
    if (!getResearchNode(techId)) return null; // 非法 techId
    if (!/^[0-9]+$/.test(parts[1])) return null; // 严格数字串（拒绝空白/正负号/小数点/科学计数）
    const level = Number(parts[1]);
    if (!Number.isInteger(level)) return null; // 小数 / NaN
    if (!isFinite(level)) return null;         // Infinity
    if (level <= 0) return null;               // 0 / 负数
    const node = getResearchNode(techId);
    if (level > node.maxLevel) return null;    // 超过节点最大等级
    return { techId, targetLevel: level };
  }

  // -------------------------------------------------------------------------
  // 步骤合法性（恰好下一等级 + 前置满足）
  //   levels: { techId: level } 快照（completedLevels 或投影）。
  //   同一科技必须连续升级（targetLevel === current+1）——
  //     既排除重复（已完成的等级），也排除倒序（如先 III 后 II）。
  // -------------------------------------------------------------------------
  function isStepValidAgainst(levels, techId, targetLevel) {
    const node = getResearchNode(techId);
    if (!node) return false;
    if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > node.maxLevel) return false;
    const current = (levels && typeof levels === "object") ? (Number(levels[techId]) || 0) : 0;
    if (targetLevel !== current + 1) return false; // 必须恰好下一等级
    for (const p of node.prerequisites) {
      const have = (levels && typeof levels === "object") ? (Number(levels[p.id]) || 0) : 0;
      if (have < p.level) return false; // 跨科技前置须已满足
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // 投影等级（§4.5）：completedLevels 副本 → 合法 activeResearch → 合法队列项
  //   - 非法旧档队列项不写入投影，也不能让后续项目错误获得前置。
  //   - 不修改原 state / completedLevels / activeResearch / pendingQueue。
  //   - 返回全新对象。
  // -------------------------------------------------------------------------
  function buildProjectedResearchLevels(state) {
    const research = state && state.research ? state.research : {};
    const completed = (research.completedLevels && typeof research.completedLevels === "object" && !Array.isArray(research.completedLevels))
      ? research.completedLevels : {};
    const projected = Object.assign({}, completed);

    // 合法 activeResearch 视为完成后的 targetLevel
    const ar = research.activeResearch;
    if (ar && typeof ar === "object" && !Array.isArray(ar) && typeof ar.techId === "string") {
      if (isStepValidAgainst(projected, ar.techId, ar.targetLevel)) {
        projected[ar.techId] = Math.max(Number(projected[ar.techId]) || 0, ar.targetLevel);
      }
    }

    const queue = Array.isArray(research.pendingQueue) ? research.pendingQueue : [];
    for (const key of queue) {
      const parsed = parseResearchStepKey(key);
      if (!parsed) continue;
      if (!isStepValidAgainst(projected, parsed.techId, parsed.targetLevel)) continue; // 非法旧档项跳过
      projected[parsed.techId] = Math.max(Number(projected[parsed.techId]) || 0, parsed.targetLevel);
    }
    return projected;
  }

  // -------------------------------------------------------------------------
  // 入队（§4.5）：投影校验 + 占用校验 + 上限 20
  //   返回稳定、可审计的 { ok, reason } 或 { ok:true, key }。
  //   失败绝不修改队列；成功只追加一个规范 key。
  // -------------------------------------------------------------------------
  function enqueueResearch(state, techId, targetLevel) {
    const research = state && state.research ? state.research : {};
    const node = getResearchNode(techId);
    if (!node) return { ok: false, reason: "UNKNOWN_TECH" };
    if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > node.maxLevel) {
      return { ok: false, reason: "LEVEL_OUT_OF_RANGE" };
    }
    // 军团分支外部门禁：未解锁则禁止入队（不影响主研究树）
    if (node.contentPack === "legion" && !isLegionResearchUnlocked(state)) {
      return { ok: false, reason: "LEGION_LOCKED" };
    }

    const projected = buildProjectedResearchLevels(state);
    const current = Number(projected[techId]) || 0;
    const key = techId + "@" + targetLevel;

    // 已占用（已完成 / 进行中 / 已排队）
    if (targetLevel <= current) {
      const ar = research.activeResearch;
      if (ar && typeof ar === "object" && !Array.isArray(ar) && ar.techId === techId && ar.targetLevel === targetLevel) {
        return { ok: false, reason: "ALREADY_ACTIVE" };
      }
      if (Array.isArray(research.pendingQueue) && research.pendingQueue.includes(key)) {
        return { ok: false, reason: "ALREADY_QUEUED" };
      }
      return { ok: false, reason: "ALREADY_COMPLETED" };
    }
    // 跳级（非恰好下一等级）
    if (targetLevel !== current + 1) {
      return { ok: false, reason: "SKIP_LEVEL" };
    }
    // 前置满足（用投影：前序队列项可满足另一科技前置）
    for (const p of node.prerequisites) {
      if ((Number(projected[p.id]) || 0) < p.level) {
        return { ok: false, reason: "PREREQ_UNMET" };
      }
    }
    // 容量上限严格 20
    const queue = research.pendingQueue;
    if (!Array.isArray(queue)) research.pendingQueue = [];
    if (research.pendingQueue.length >= 20) {
      return { ok: false, reason: "QUEUE_FULL" };
    }
    if (research.pendingQueue.includes(key)) {
      return { ok: false, reason: "ALREADY_QUEUED" };
    }
    research.pendingQueue.push(key);
    markResearchDirty(state); // 成功入队 → 标记待保存
    return { ok: true, key };
  }

  // -------------------------------------------------------------------------
  // 级联入队（一键补齐前置）：把「使 techId 达到 targetLevel」所需的全部步骤
  //   按顺序入队（前置在前、自身在后，天然满足「恰好下一等级」校验）。
  //   - targetLevel 仍由调用方传入（通常 = 详情面板 nextTarget）。
  //   - 依赖展开：逐项递归补齐前置科技到 prerequisites[i].level，再补齐目标自身
  //     current+1 .. targetLevel；同级多次引用（含已排队/已完成的）由 projection 去重。
  //   - 逐个调用 enqueueResearch（每次重算投影），不重复造轮子、不破坏既有不变式。
  //   - 返回 { ok, enqueued, skipped, failed, queueFull, reason }：
  //       enqueued 实际入队的 key 列表；skipped 已存在/已完成的（非致命）；
  //       failed 真实失败（应为空，拓扑序保证前置已满足）；queueFull 触顶中止。
  // -------------------------------------------------------------------------
  function enqueueResearchCascade(state, techId, targetLevel) {
    const node = getResearchNode(techId);
    if (!node) return { ok: false, reason: "UNKNOWN_TECH", enqueued: [], skipped: [], failed: [] };
    if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > node.maxLevel) {
      return { ok: false, reason: "LEVEL_OUT_OF_RANGE", enqueued: [], skipped: [], failed: [] };
    }

    // 收集步骤（拓扑序）：先递归前置，再自身层级。
    const projected = buildProjectedResearchLevels(state);
    const steps = [];
    (function gather(id, tgt) {
      const n = getResearchNode(id);
      if (!n) return;
      const cur = Number(projected[id]) || 0;
      if (tgt <= cur) return; // 已满足（含已排队/已完成）→ 跳过
      for (const p of (n.prerequisites || [])) {
        gather(p.id, p.level); // 先铺前置链（含其前置）
      }
      for (let lv = cur + 1; lv <= tgt; lv++) {
        const k = id + "@" + lv;
        if (!steps.includes(k)) steps.push(k); // 跨分支去重
      }
    })(techId, targetLevel);

    const enqueued = [];
    const skipped = [];
    const failed = [];
    let queueFull = false;
    for (const key of steps) {
      const parsed = parseResearchStepKey(key);
      if (!parsed) continue;
      const res = enqueueResearch(state, parsed.techId, parsed.targetLevel);
      if (res.ok) {
        enqueued.push(key);
      } else if (res.reason === "ALREADY_QUEUED" || res.reason === "ALREADY_COMPLETED" || res.reason === "ALREADY_ACTIVE") {
        skipped.push(key);
      } else if (res.reason === "QUEUE_FULL") {
        queueFull = true;
        failed.push(key + "(队列已满)");
        break; // 容量硬上限，后续步骤无法再入队
      } else {
        failed.push(key + "(" + res.reason + ")"); // 不应到达：拓扑序保证前置已满足
        break;
      }
    }
    const realOk = failed.length === 0;
    return {
      ok: realOk,
      enqueued,
      skipped,
      failed,
      queueFull,
      reason: realOk ? null : (queueFull ? "QUEUE_FULL" : "PARTIAL"),
    };
  }

  // -------------------------------------------------------------------------
  // 私有启动原语（批次 C，防递归核心）：不做任何时间结算。
  //   职责仅为：真实 completedLevels 校验 → 冻结 duration → 创建 activeResearch，
  //   remainingSeconds = baseDuration，startedAt = atMs（仅展示）。
  //   被 processResearchUntil 的结算循环（经 startNextFromQueue）与公共
  //   startResearch 共用；本函数绝不回调 processResearchUntil，杜绝
  //   processResearchUntil → startNextFromQueue → startResearch →
  //   processResearchUntil 递归。
  // -------------------------------------------------------------------------
  function beginResearchStep(state, techId, targetLevel, atMs) {
    const research = state && state.research ? state.research : {};
    if (research.activeResearch !== null && typeof research.activeResearch === "object" && !Array.isArray(research.activeResearch)) {
      return { ok: false, reason: "ALREADY_ACTIVE" };
    }
    const node = getResearchNode(techId);
    if (!node) return { ok: false, reason: "UNKNOWN_TECH" };
    if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > node.maxLevel) {
      return { ok: false, reason: "LEVEL_OUT_OF_RANGE" };
    }
    // 军团分支外部门禁：未解锁则禁止开始（不影响主研究树）
    if (node.contentPack === "legion" && !isLegionResearchUnlocked(state)) {
      return { ok: false, reason: "LEGION_LOCKED" };
    }
    const completed = (research.completedLevels && typeof research.completedLevels === "object" && !Array.isArray(research.completedLevels))
      ? research.completedLevels : {};
    if (!isStepValidAgainst(completed, techId, targetLevel)) {
      return { ok: false, reason: "PREREQ_UNMET" };
    }
    const duration = getResearchDuration(techId, targetLevel);
    if (typeof duration !== "number" || !isFinite(duration)) {
      return { ok: false, reason: "DURATION_UNAVAILABLE" };
    }
    const startedAt = (typeof atMs === "number" && isFinite(atMs))
      ? atMs
      : ((typeof Date !== "undefined" && Date.now) ? Date.now() : 0);
    const activeResearch = {
      techId,
      targetLevel,
      startedAt,
      baseDuration: duration,
      remainingSeconds: duration,
      appliedAchievementSeconds: 0,
    };
    research.activeResearch = activeResearch;
    markResearchDirty(state); // 成功创建 activeResearch → 标记待保存
    return { ok: true, activeResearch };
  }

  // -------------------------------------------------------------------------
  // 公共开始（§4.7 不变式）：
  //   ① 先 processResearchUntil(now) 把自然时间结算到 now（旧步骤可能自然完成
  //      并由结算循环自动衔接队列下一项）；
  //   ② 再检查 activeResearch —— 结算后仍被占用（含刚衔接的下一项）则拒绝，
  //      绝不覆盖正在研究的项目；
  //   ③ 最后调用私有启动原语（真实等级校验 + 冻结时长）。
  // -------------------------------------------------------------------------
  function startResearch(state, techId, targetLevel, now) {
    const resolvedNow = (typeof now === "number" && isFinite(now))
      ? now
      : ((typeof Date !== "undefined" && Date.now) ? Date.now() : 0);
    processResearchUntil(state, resolvedNow); // ① 先结算，保证自然时间不会被重复计给新节点
    const research = state && state.research ? state.research : {};
    if (research.activeResearch !== null && typeof research.activeResearch === "object" && !Array.isArray(research.activeResearch)) {
      return { ok: false, reason: "ALREADY_ACTIVE" }; // ② 结算后占用（含队列刚衔接项）→ 拒绝
    }
    return beginResearchStep(state, techId, targetLevel, resolvedNow); // ③ 私有原语
  }

  // -------------------------------------------------------------------------
  // 队首真实校验启动（§4.6）：用真实 completedLevels 二次校验。
  //   - 坏格式 / 非法（重复、倒序、缺前置、坏格式）旧档项移除后继续检查下一项。
  //   - 找到第一项真实合法步骤时启动并停止扫描。
  //   - 全部非法时安全停止，activeResearch 保持 null。
  //   - 显式 guard（最多处理本次队列初始长度），禁止递归无限循环。
  //   - 批次 C：内部改用私有 beginResearchStep 启动原语（不做时间结算），
  //     禁止回调公共 startResearch —— 否则 processResearchUntil →
  //     startNextFromQueue → startResearch → processResearchUntil 形成递归。
  //   - 不使用 js/core/queue.js 的 applyQueueItemConfig / executeQueueItemForState。
  // -------------------------------------------------------------------------
  function startNextFromQueue(state, atMs) {
    const research = state && state.research ? state.research : {};
    if (research.activeResearch !== null && typeof research.activeResearch === "object" && !Array.isArray(research.activeResearch)) {
      return { ok: false, reason: "ALREADY_ACTIVE" };
    }
    const queue = Array.isArray(research.pendingQueue) ? research.pendingQueue : [];
    const initialLen = queue.length;
    const completed = (research.completedLevels && typeof research.completedLevels === "object" && !Array.isArray(research.completedLevels))
      ? research.completedLevels : {};
    let guard = 0;
    while (guard < initialLen && queue.length > 0) {
      guard += 1;
      const key = queue[0];
      const parsed = parseResearchStepKey(key);
      if (!parsed) { queue.shift(); markResearchDirty(state); continue; } // 坏格式 → 移除并标记
      if (isStepValidAgainst(completed, parsed.techId, parsed.targetLevel)) {
        const res = beginResearchStep(state, parsed.techId, parsed.targetLevel, atMs); // 私有原语，无时间结算
        if (res.ok) {
          queue.shift(); // 已启动的项移出队列
          return { ok: true, started: key };
        }
        return res; // 不应到达（activeResearch 入队时已为 null）
      }
      queue.shift(); markResearchDirty(state); // 非法（重复/倒序/缺前置）→ 移除并标记，继续
    }
    return { ok: false, reason: "NO_LEGAL_STEP" };
  }

  // -------------------------------------------------------------------------
  // 完成当前步骤（§4.7 completeResearchStep，批次 C）：
  //   - completedLevels[techId] = max(旧值, targetLevel)（只增不降）
  //   - history 追加 { techId, level, completedAt: atMs }（atMs=虚拟游标或真实 now）
  //   - activeResearch = null
  //   - GameEvents.emit("research:stepCompleted", {techId, level}) —— 每步严格一次，
  //     payload 契约固定为 {techId, level}，不漂移。
  //   - 协议节点完成仅通过 completedLevels 表示"已解锁"：不自动置
  //     protocolSettings.enabled=true、不执行任何协议业务（§6.0）。
  // -------------------------------------------------------------------------
  function completeResearchStep(state, atMs) {
    const research = state && state.research ? state.research : {};
    const ar = research.activeResearch;
    if (!ar || typeof ar !== "object" || Array.isArray(ar)) {
      return { ok: false, reason: "NOTHING_ACTIVE" };
    }
    const techId = ar.techId;
    const level = ar.targetLevel;
    // atMs 非有限数字安全归一：history 与事件 metadata 使用同一最终时间值
    const safeTs = (typeof atMs === "number" && isFinite(atMs))
      ? atMs
      : ((typeof Date !== "undefined" && Date.now) ? Date.now() : 0);
    if (!research.completedLevels || typeof research.completedLevels !== "object" || Array.isArray(research.completedLevels)) {
      research.completedLevels = {};
    }
    research.completedLevels[techId] = Math.max(Number(research.completedLevels[techId]) || 0, level);
    if (!Array.isArray(research.history)) research.history = [];
    research.history.push({ techId, level, completedAt: safeTs }); // 虚拟游标 / 真实 now
    research.activeResearch = null;
    markResearchDirty(state); // 成功状态变更 → 标记待保存（沿用现有自动保存）
    // 事件：每个完成步骤严格一次；payload 契约固定为 {techId, level}（不漂移）；
    // 第三参 metadata.timestamp = 完成该步的虚拟游标时间（多步离线各事件时间独立）。
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (GE && typeof GE.emit === "function") {
      GE.emit("research:stepCompleted", { techId, level }, { timestamp: safeTs });
    }
    return { ok: true, techId, level };
  }

  // -------------------------------------------------------------------------
  // ★ 在线/离线唯一时间结算入口（§4.2，批次 C）。
  //   只接受 state 与绝对时间 now（ms）；不接受调用方传 elapsed。
  //   语义：
  //     oldAnchor = lastProcessedAt
  //     rawElapsed = max(0, (now - oldAnchor)/1000)      // 时钟倒退 ⇒ 0
  //     elapsed = min(rawElapsed, 86400)                 // 24h 封顶，全链路唯一封顶点
  //     cursorAt = oldAnchor                             // 虚拟时间游标（ms）
  //     while elapsed > 0 && activeResearch != null:
  //       完成整步 → cursorAt += 步耗时；completeResearchStep(cursorAt)；
  //                  startNextFromQueue(cursorAt)（私有原语启动，无递归）
  //       不足整步 → remainingSeconds -= elapsed；cursorAt += elapsed*1000；elapsed=0
  //     lastProcessedAt = max(oldAnchor, now)            // 无条件推进，单调不倒退
  //   要点：
  //     - activeResearch=null 也推进锚点（不积攒空闲时间；此时不擅自启动队列）。
  //     - 超 24h 部分随锚点推到 now 永久丢弃（不是 oldAnchor+86400）。
  //     - 相同 now 重复调用幂等（第二次 rawElapsed=0）。
  //     - exact boundary（elapsed === remainingSeconds）完成该步。
  //     - 显式 guard（10000 步）防坏档死循环；浮点精度不做整数化。
  //     - 只推进科研；不执行任何协议业务。
  // -------------------------------------------------------------------------
  var MAX_RESEARCH_OFFLINE_SECONDS = 86400; // 与 offline.js MAX_OFFLINE_SECONDS 同值；科研链路唯一封顶点

  function processResearchUntil(state, now, opts) {
    const research = state && state.research ? state.research : null;
    if (!research || typeof research !== "object") {
      return { ok: false, reason: "NO_RESEARCH_STATE" };
    }
    const resolvedNow = (typeof now === "number" && isFinite(now))
      ? now
      : ((typeof Date !== "undefined" && Date.now) ? Date.now() : 0);
    let oldAnchor = research.lastProcessedAt;
    if (typeof oldAnchor !== "number" || !isFinite(oldAnchor)) {
      // 坏锚点防御：视为无可结算时间，直接推进到 now（不白给任何 elapsed）
      research.lastProcessedAt = resolvedNow;
      return { ok: true, completedSteps: 0 };
    }
    const rawElapsed = Math.max(0, (resolvedNow - oldAnchor) / 1000);
    // 十倍速开关（2026-08-04）：仅缩放科研进度积累，冷却/到期保持实时；离线调用不传 opts → scale=1。
    const _scale = (opts && typeof opts.scale === "number" && isFinite(opts.scale) && opts.scale > 0) ? opts.scale : 1;
    let elapsed = Math.min(rawElapsed, MAX_RESEARCH_OFFLINE_SECONDS) * _scale;
    let cursorAt = oldAnchor;
    let completedSteps = 0;
    let guard = 0;
    while (elapsed > 0 && research.activeResearch !== null &&
           typeof research.activeResearch === "object" && !Array.isArray(research.activeResearch)) {
      guard += 1;
      if (guard > 10000) break; // 显式 guard：防坏档死循环（150 步全树 ×66 裕量）
      const ar = research.activeResearch;
      const stepLeft = Number(ar.remainingSeconds);
      if (!isFinite(stepLeft) || stepLeft <= 0) {
        // 防御：非法/已耗尽剩余时间 → 立即完成该步（不消耗 elapsed，游标不动）
        completeResearchStep(state, cursorAt);
        completedSteps += 1;
        startNextFromQueue(state, cursorAt);
        continue;
      }
      if (elapsed >= stepLeft) {
        // 完成整步（含 exact boundary：elapsed === stepLeft 也完成）
        elapsed -= stepLeft;
        cursorAt += stepLeft * 1000; // 虚拟游标推进该步实际消耗（保留浮点精度）
        completeResearchStep(state, cursorAt);
        completedSteps += 1;
        startNextFromQueue(state, cursorAt); // 私有原语启动，下一步 startedAt = cursorAt
      } else {
        ar.remainingSeconds = stepLeft - elapsed; // 浮点，不整数化
        cursorAt += elapsed * 1000;
        elapsed = 0;
        markResearchDirty(state); // 实际减少 remainingSeconds → 标记待保存
      }
    }
    // 无条件安全更新：锚点单调推进到 now（超限丢弃 / 空闲期不积攒 / 倒退不下降）
    research.lastProcessedAt = Math.max(oldAnchor, resolvedNow);
    return { ok: true, completedSteps };
  }

  // -------------------------------------------------------------------------
  // 只读进度查询（批次 C）：不修改 state。
  //   无 active：稳定 inactive 形态 { active:false, ratio:1 }。
  //   有 active：ratio = 1 - remaining/base，夹紧 [0,1]。
  // -------------------------------------------------------------------------
  function getResearchProgress(state) {
    const research = state && state.research ? state.research : {};
    const ar = research.activeResearch;
    if (!ar || typeof ar !== "object" || Array.isArray(ar)) {
      return { active: false, ratio: 1 };
    }
    const base = Number(ar.baseDuration);
    const remaining = Number(ar.remainingSeconds);
    let ratio = 1;
    if (isFinite(base) && base > 0 && isFinite(remaining)) {
      ratio = 1 - remaining / base;
    }
    if (!isFinite(ratio)) ratio = 0;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;
    return {
      active: true,
      techId: ar.techId,
      targetLevel: ar.targetLevel,
      ratio,
      baseDuration: ar.baseDuration,
      remainingSeconds: ar.remainingSeconds,
      appliedAchievementSeconds: ar.appliedAchievementSeconds,
      startedAt: ar.startedAt,
    };
  }

  // =========================================================================
  //  Batch E：科研工时消耗 / 研究取消（正式 API）
  //
  //  共同铁律：
  //    - 两个 API 都先调用唯一时间结算入口 processResearchUntil(state, now)，
  //      绝不自行计算 elapsed、绝不绕开锚点。
  //    - 工时单位统一为「秒」；state.research.researchHourBank 是唯一余额载体。
  //    - 单步可被成就工时抵扣的上限严格为 baseDuration 的 50%
  //      （activeResearch.appliedAchievementSeconds 累计不得越界）。
  //    - 失败分支一律不改状态、不设置 dirty、不 emit。
  //    - 事件系统缺失时业务仍然成功（emit 只是可选副作用）。
  // =========================================================================

  const ACHIEVEMENT_HOURS_CAP_RATIO = 0.5; // 单步成就工时抵扣上限占 baseDuration 的比例
  const SECONDS_PER_HOUR = 3600;

  function getEventBus() {
    return (
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null
    );
  }

  function resolveNowMs(now) {
    return (typeof now === "number" && isFinite(now))
      ? now
      : ((typeof Date !== "undefined" && Date.now) ? Date.now() : 0);
  }

  // -------------------------------------------------------------------------
  // applyResearchHours(state, hours, now)
  //   把科研工时银行中的时间投入当前研究，直接扣减 remainingSeconds。
  //
  //   ① processResearchUntil(state, now) 先结算自然时间；
  //   ② hours 必须是有限正数                → INVALID_HOURS
  //   ③ 无 research 状态                    → NO_RESEARCH_STATE
  //   ④ 无 activeResearch（结算后）         → NOTHING_ACTIVE
  //   ⑤ baseDuration / remainingSeconds 非法 → INVALID_ACTIVE
  //   ⑥ 本步已用满 50% 上限                 → CAP_REACHED
  //   ⑦ 银行余额 <= 0                        → INSUFFICIENT_BANK
  //   ⑧ 实扣 usedSeconds = min(请求秒数, 50% 剩余额度, 银行余额, 本步剩余时间)
  //      —— 请求超额不报错，按可用量截断（部分成交），usedSeconds 必然 > 0。
  //   ⑨ 若扣到 remainingSeconds <= 0 → 立即 completeResearchStep + 队列衔接。
  //
  //   成功 emit 恰一次 research:hoursApplied {techId, level, usedSeconds}。
  // -------------------------------------------------------------------------
  function applyResearchHours(state, hours, now) {
    const research = state && state.research ? state.research : null;
    if (!research || typeof research !== "object" || Array.isArray(research)) {
      return { ok: false, reason: "NO_RESEARCH_STATE" };
    }
    if (typeof hours !== "number" || !isFinite(hours) || hours <= 0) {
      return { ok: false, reason: "INVALID_HOURS" };
    }

    const resolvedNow = resolveNowMs(now);
    processResearchUntil(state, resolvedNow); // ① 唯一时间结算入口

    const ar = research.activeResearch;
    if (!ar || typeof ar !== "object" || Array.isArray(ar)) {
      return { ok: false, reason: "NOTHING_ACTIVE" };
    }

    const base = Number(ar.baseDuration);
    const remaining = Number(ar.remainingSeconds);
    if (!isFinite(base) || base <= 0 || !isFinite(remaining) || remaining <= 0) {
      return { ok: false, reason: "INVALID_ACTIVE" };
    }

    const appliedRaw = ar.appliedAchievementSeconds;
    const applied = (typeof appliedRaw === "number" && isFinite(appliedRaw) && appliedRaw > 0) ? appliedRaw : 0;
    const capTotal = base * ACHIEVEMENT_HOURS_CAP_RATIO;
    const capLeft = capTotal - applied;
    if (!(capLeft > 0)) {
      return { ok: false, reason: "CAP_REACHED", techId: ar.techId, level: ar.targetLevel, capSeconds: capTotal };
    }

    const bankRaw = research.researchHourBank;
    const bank = (typeof bankRaw === "number" && isFinite(bankRaw) && bankRaw > 0) ? bankRaw : 0;
    if (bank <= 0) {
      return { ok: false, reason: "INSUFFICIENT_BANK", techId: ar.techId, level: ar.targetLevel };
    }

    const requested = hours * SECONDS_PER_HOUR;
    const usedSeconds = Math.min(requested, capLeft, bank, remaining);
    if (!(usedSeconds > 0)) {
      // 理论不可达（上面四个量均已确认 > 0）；保守失败，不改状态。
      return { ok: false, reason: "INSUFFICIENT_BANK", techId: ar.techId, level: ar.targetLevel };
    }

    const techId = ar.techId;
    const level = ar.targetLevel;

    research.researchHourBank = bank - usedSeconds;
    ar.remainingSeconds = remaining - usedSeconds;
    ar.appliedAchievementSeconds = applied + usedSeconds;
    markResearchDirty(state);

    const finalRemaining = ar.remainingSeconds;
    const finalApplied = ar.appliedAchievementSeconds;

    // ⑨ 抵扣到 0 立即结算该步并衔接队列下一项（startedAt 用同一 resolvedNow）
    let completed = false;
    if (!(finalRemaining > 0)) {
      const done = completeResearchStep(state, resolvedNow);
      completed = !!(done && done.ok);
      if (completed) startNextFromQueue(state, resolvedNow);
    }

    const GE = getEventBus();
    if (GE && typeof GE.emit === "function") {
      GE.emit("research:hoursApplied", { techId, level, usedSeconds }, { timestamp: resolvedNow });
    }

    return {
      ok: true,
      reason: null,
      techId,
      level,
      usedSeconds,
      completed,
      bankSeconds: research.researchHourBank,
      remainingSeconds: finalRemaining,
      appliedAchievementSeconds: finalApplied,
      capSeconds: capTotal,
    };
  }

  // -------------------------------------------------------------------------
  // cancelResearch(state, now)
  //   取消当前研究：进度作废（不写 completedLevels、不写 history、不 emit
  //   research:stepCompleted），已投入的成就科研工时全额退回银行。
  //
  //   ① processResearchUntil(state, now) 先结算——若自然时间已让该步完成，
  //      则此刻取消的是「队列衔接后的下一项」或返回 NOTHING_ACTIVE，
  //      绝不出现「已完成还能取消退款」的双花。
  //   ② 无 research 状态            → NO_RESEARCH_STATE
  //   ③ 结算后无 activeResearch     → NOTHING_ACTIVE
  //   ④ 退款 refundedSeconds = 清洗后的 appliedAchievementSeconds（夹紧 50% 上限）
  //   ⑤ activeResearch = null，随后 startNextFromQueue 衔接队列下一项。
  //
  //   成功 emit 恰一次 research:cancelled {techId, level, refundedSeconds}。
  // -------------------------------------------------------------------------
  function cancelResearch(state, now) {
    const research = state && state.research ? state.research : null;
    if (!research || typeof research !== "object" || Array.isArray(research)) {
      return { ok: false, reason: "NO_RESEARCH_STATE" };
    }

    const resolvedNow = resolveNowMs(now);
    processResearchUntil(state, resolvedNow); // ① 唯一时间结算入口

    const ar = research.activeResearch;
    if (!ar || typeof ar !== "object" || Array.isArray(ar)) {
      return { ok: false, reason: "NOTHING_ACTIVE" };
    }

    const techId = ar.techId;
    const level = ar.targetLevel;

    // ④ 退款额度：只退真实投入过的成就工时，并再次夹紧 50% 上限（防坏档超额退款）
    const base = Number(ar.baseDuration);
    const capTotal = (isFinite(base) && base > 0) ? base * ACHIEVEMENT_HOURS_CAP_RATIO : 0;
    const appliedRaw = ar.appliedAchievementSeconds;
    let refundedSeconds = (typeof appliedRaw === "number" && isFinite(appliedRaw) && appliedRaw > 0) ? appliedRaw : 0;
    if (refundedSeconds > capTotal) refundedSeconds = capTotal;

    const bankRaw = research.researchHourBank;
    const bank = (typeof bankRaw === "number" && isFinite(bankRaw) && bankRaw > 0) ? bankRaw : 0;
    research.researchHourBank = bank + refundedSeconds;

    // ⑤ 进度作废：不写 completedLevels / history / research:stepCompleted
    research.activeResearch = null;
    markResearchDirty(state);

    const next = startNextFromQueue(state, resolvedNow);

    const GE = getEventBus();
    if (GE && typeof GE.emit === "function") {
      GE.emit("research:cancelled", { techId, level, refundedSeconds }, { timestamp: resolvedNow });
    }

    return {
      ok: true,
      reason: null,
      techId,
      level,
      refundedSeconds,
      bankSeconds: research.researchHourBank,
      startedNext: !!(next && next.ok) ? next.started : null,
    };
  }

  // -------------------------------------------------------------------------
  // removeQueuedResearch(state, stepKey, now)  —— Batch F：移除队列项
  //   严格 stepKey 定位，只删除完全匹配的一项。
  //   ① processResearchUntil(state, now) 先结算，确保基于最新状态操作；
  //   ② 非法 state           → INVALID_STATE；
  //   ③ stepKey 解析失败      → INVALID_STEP_KEY；
  //   ④ pendingQueue 精确匹配 → splice 移除一项并置 dirty → ok；
  //      否则                → NOT_QUEUED。
  //   不取消 activeResearch、不重新排列其他队列项、不复制队列合法性算法。
  // -------------------------------------------------------------------------
  function removeQueuedResearch(state, stepKey, now) {
    if (!state || !state.research || typeof state.research !== "object" || Array.isArray(state.research)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    const parsed = parseResearchStepKey(stepKey);
    if (!parsed) return { ok: false, reason: "INVALID_STEP_KEY" };

    const resolvedNow = resolveNowMs(now);
    processResearchUntil(state, resolvedNow); // ① 基于最新状态

    const research = state.research;
    const queue = Array.isArray(research.pendingQueue) ? research.pendingQueue : [];
    const index = queue.indexOf(stepKey); // 严格字符串匹配：仅删完全匹配的一项
    if (index < 0) return { ok: false, reason: "NOT_QUEUED" };

    queue.splice(index, 1); // 只移除一项，其余顺序保持（不重排）
    markResearchDirty(state);
    return { ok: true, reason: null, key: stepKey, removedIndex: index };
  }

  // -------------------------------------------------------------------------
  // 暴露
  // -------------------------------------------------------------------------
  const ResearchSystem = {
    parseResearchStepKey,
    getResearchNode,
    getResearchDuration,
    isStepValidAgainst,
    buildProjectedResearchLevels,
    enqueueResearch,
    enqueueResearchCascade,
    isLegionResearchUnlocked,
    getLegionResearchLockReason,
    startResearch,
    startNextFromQueue,
    // 批次 C：在线/离线统一时间结算
    processResearchUntil,
    completeResearchStep,
    getResearchProgress,
    // Batch E：科研工时消耗 / 研究取消
    applyResearchHours,
    cancelResearch,
    // Batch F：移除队列项
    removeQueuedResearch,
  };

  if (typeof window !== "undefined") window.ResearchSystem = ResearchSystem;
  if (typeof globalThis !== "undefined") globalThis.ResearchSystem = ResearchSystem;
})();
