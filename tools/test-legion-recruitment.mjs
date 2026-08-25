// ================================================================
// 军团 DLC —— NPC 招募与贡献系统 单元测试
// ----------------------------------------------------------------
// 纯 Node 运行（不依赖浏览器 / index.html 脚本清单）。
// 通过 createRequire 加载 UMD 模块链：
//   legion-npc.js -> (npc-names / personalities / skills / dialogue) + ships.js
// 覆盖需求清单的全部场景（>=34）：
//   激活门控 / 人数上限(15) / 候选人刷新 / 手动刷新翻倍 / 招募费用与工资 /
//   原子扣费 / 工资结算(充足·欠薪·在线=离线) / 经验曲线 / 等级上限(LV70) /
//   里程碑 / 舰船经验倍率(含不相容惩罚) / 管理类倍率分段 / 同类递减 /
//   舰船绑定·销毁·不存在 / 解雇 / 迁移幂等 / 重复执行防护 / 双环境可调用。
// 原则：发现既有失败必须列出，绝不为通过而屏蔽。
// ================================================================
import { createRequire } from "module";
import { readFileSync } from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const LEGION_NPC = require(path.join(ROOT, "js/systems/legion-npc.js"));

// 研究数据层 + 状态层：set globalThis.ResearchData / globalThis.ResearchState，
// 供 NPC 系统经 ResearchState 读取军团研究加成（容量/等级上限/经验乘子）。
// 顺序敏感：research-state.js 在 IIFE 加载时读取 globalThis.ResearchData。
require(path.join(ROOT, "js/data/research.js"));       // globalThis.ResearchData
require(path.join(ROOT, "js/core/research-state.js")); // globalThis.ResearchState（依赖 ResearchData）

// ---------- 测试框架 ----------
let PASS = 0, FAIL = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { PASS++; }
  else { FAIL++; failures.push(name + (extra != null ? " :: " + extra : "")); console.log("  FAIL:", name, extra != null ? ":: " + extra : ""); }
}
function eq(name, a, b) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  check(name, ok, "expected " + JSON.stringify(b) + " got " + JSON.stringify(a));
}
function approx(name, a, b, eps = 1e-9) {
  check(name, Math.abs(a - b) <= eps, "expected " + b + " got " + a);
}
function ok(name, cond) { check(name, !!cond); }

// ---------- 状态构造 ----------
const T0 = 1700000000000; // 固定基准时间，避免 Date.now() 抖动
const PERIOD = LEGION_NPC.SETTLEMENT_PERIOD_MS; // 4h

function makeState(opts = {}) {
  const { bodyLevel = 2, hall = 1, isk = 1e12, lp = 1e6, ships = [], legion } = opts;
  const state = {
    station: { bodyLevel, buildings: { legion_hall: hall } },
    resources: { isk, lp },
    inventory: { ships: ships.slice() }
  };
  if (legion !== undefined) state.legion = legion;
  LEGION_NPC.ensureLegionState(state); // 默认保证 legion 结构存在，便于各处直接访问
  return state;
}
function makeNpc(over = {}) {
  return LEGION_NPC.createNpc(Object.assign({
    npcId: "n_" + Math.random().toString(36).slice(2),
    name: "测试员", personalityId: "calm", skillId: "mining", skillGrade: "D",
    level: 1, xp: 0, boundShipInstanceId: null, salaryState: "paid", dialogueHistory: []
  }, over));
}
function addShip(state, instanceId, shipId) { state.inventory.ships.push({ instanceId, shipId }); }

// 确定性 PRNG（LCG）—— 避免常数 rng 导致的批内同名 / 同技能
function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const detRng = lcg(20240824);

// ================================================================
// 一、接口导出（双环境可调用性前置）
// ================================================================
console.log("\n[1] 接口导出");
{
  const required = [
    "getLegionState", "getLegionNpcCount", "getLegionNpcCapacity", "getLegionCandidateRefreshState",
    "refreshLegionNpcCandidates", "manuallyRefreshLegionNpcCandidates", "recruitLegionNpc",
    "settleLegionNpcSalaries", "calculateLegionNpcXp", "settleLegionNpcExperience",
    "assignLegionNpcShip", "dismissLegionNpc", "getLegionNpcSkillEffects",
    "getLegionNpcManagementXpMultiplier", "getLegionNpcShipXpMultiplier", "getLegionNpcLevelCap",
    "getLegionNpcSkillRawValue", "isLegionSystemActive", "getHallLevel", "tickLegionNpc",
    "getNpcXpMultiplier", "createNpc", "generateLegionNpcCandidates", "getNpcDialogue"
  ];
  required.forEach((k) => ok("导出 " + k, typeof LEGION_NPC[k] === "function"));
  ["CANDIDATE_REFRESH_MS", "SETTLEMENT_PERIOD_MS", "RECRUIT_COST", "WAGE"].forEach((k) =>
    ok("常量 " + k, LEGION_NPC[k] != null));
  // 招募/工资数值表（与需求严格一致）
  eq("RECRUIT_COST.D", LEGION_NPC.RECRUIT_COST.D, { isk: 1e6, lp: 25 });
  eq("RECRUIT_COST.C", LEGION_NPC.RECRUIT_COST.C, { isk: 2e6, lp: 50 });
  eq("RECRUIT_COST.B", LEGION_NPC.RECRUIT_COST.B, { isk: 4e6, lp: 100 });
  eq("RECRUIT_COST.A", LEGION_NPC.RECRUIT_COST.A, { isk: 8e6, lp: 200 });
  eq("WAGE.D", LEGION_NPC.WAGE.D, 100000);
  eq("WAGE.C", LEGION_NPC.WAGE.C, 200000);
  eq("WAGE.B", LEGION_NPC.WAGE.B, 350000);
  eq("WAGE.A", LEGION_NPC.WAGE.A, 600000);
}

// ================================================================
// 二、激活门控（本体 >=2 且 议事大厅 >=1）
// ================================================================
console.log("\n[2] 激活门控");
{
  ok("本体1/大厅1 → 未激活", !LEGION_NPC.isLegionSystemActive(makeState({ bodyLevel: 1, hall: 1 })));
  ok("本体2/大厅0 → 未激活", !LEGION_NPC.isLegionSystemActive(makeState({ bodyLevel: 2, hall: 0 })));
  ok("本体2/大厅1 → 激活", LEGION_NPC.isLegionSystemActive(makeState({ bodyLevel: 2, hall: 1 })));
  ok("本体3/大厅5 → 激活", LEGION_NPC.isLegionSystemActive(makeState({ bodyLevel: 3, hall: 5 })));
  // 未激活时所有核心动作返回 inactive
  const s = makeState({ bodyLevel: 1, hall: 1 });
  eq("未激活 refresh", LEGION_NPC.refreshLegionNpcCandidates(s).reason, "inactive");
  eq("未激活 manualRefresh", LEGION_NPC.manuallyRefreshLegionNpcCandidates(s).reason, "inactive");
  eq("未激活 recruit", LEGION_NPC.recruitLegionNpc(s, "x").reason, "inactive");
  eq("未激活 salaries", LEGION_NPC.settleLegionNpcSalaries(s).reason, "inactive");
  eq("未激活 experience", LEGION_NPC.settleLegionNpcExperience(s).reason, "inactive");
}

// ================================================================
// 三、人数上限（6 + (大厅-1) + 研究(legion_staffing 每级+1)，封顶 15）
//   注：旧档 state.legion.technologyLevel 已不再提供数值效果（仅兼容保留）。
// ================================================================
console.log("\n[3] 人数上限");
{
  eq("大厅1/无军团研究 = 6", LEGION_NPC.getLegionNpcCapacity(makeState({ hall: 1, legion: { technologyLevel: 0 } })), 6);
  eq("大厅5/无军团研究 = 10", LEGION_NPC.getLegionNpcCapacity(makeState({ hall: 5, legion: { technologyLevel: 0 } })), 10);
  // 旧 technologyLevel 字段不再影响容量（验证“旧档兼容但不生效”）
  eq("大厅1/旧technologyLevel=3 仍=6", LEGION_NPC.getLegionNpcCapacity(makeState({ hall: 1, legion: { technologyLevel: 3 } })), 6);
  // 新机制：征募编制研究驱动容量
  const sStaff3 = makeState({ hall: 1 }); sStaff3.research = { completedLevels: { legion_staffing: 3 } };
  eq("大厅1 + 征募编制@3 = 9", LEGION_NPC.getLegionNpcCapacity(sStaff3), 9);
  const sStaffCap = makeState({ hall: 10 }); sStaffCap.research = { completedLevels: { legion_staffing: 5 } };
  eq("大厅10 + 征募@5 = 封顶15", LEGION_NPC.getLegionNpcCapacity(sStaffCap), 15);
  // 容量-1 = 可招募 NPC 上限（含玩家本人）
  const s = makeState({ hall: 1, isk: 1e9, lp: 1e6 });
  LEGION_NPC.ensureLegionState(s);
  // 塞入 5 名候选人（不同 npcId，均 D 级）
  for (let i = 0; i < 6; i++) s.legion.candidates.push(makeNpc({ npcId: "c" + i, name: "候选" + i, skillGrade: "D" }));
  let recruited = 0;
  for (let i = 0; i < 6; i++) {
    const r = LEGION_NPC.recruitLegionNpc(s, "c" + i);
    if (r.changed) recruited++;
  }
  eq("大厅1 最多招募 5 名 NPC", recruited, 5);
  eq("第6名因 capacity 被拒", LEGION_NPC.recruitLegionNpc(s, "c5").reason, "capacity");
  eq("NPC 总数 = 5", LEGION_NPC.getLegionNpcCount(s), 5);
  // 解雇释放名额
  const dismissed = LEGION_NPC.dismissLegionNpc(s, s.legion.npcs[0].npcId);
  ok("解雇成功", dismissed.changed);
  eq("解雇后总数 4", LEGION_NPC.getLegionNpcCount(s), 4);
  ok("解雇后可再招募", LEGION_NPC.recruitLegionNpc(s, "c5").changed);
  eq("解雇后再招募总数 5", LEGION_NPC.getLegionNpcCount(s), 5);
}

// ================================================================
// 四、候选人刷新（3 名/批，4h 周期，重置手动次数）
// ================================================================
console.log("\n[4] 候选人刷新");
{
  const s = makeState({});
  const r = LEGION_NPC.refreshLegionNpcCandidates(s, { now: T0, rng: detRng });
  ok("刷新 changed", r.changed);
  eq("生成 3 名候选", s.legion.candidates.length, 3);
  eq("刷新时间 = now+4h", s.legion.candidateRefreshAt, T0 + PERIOD);
  eq("重置手动次数=0", s.legion.manualRefreshCount, 0);
  eq("记录周期起点", s.legion.manualRefreshCycleStartedAt, T0);
  // 批内不重名
  const names = s.legion.candidates.map((c) => c.name);
  eq("批内名字不重复", new Set(names).size, 3);
  // 自然刷新再生 3 名（不堆积）
  const oldIds = s.legion.candidates.map((c) => c.npcId);
  LEGION_NPC.refreshLegionNpcCandidates(s, { now: T0 + PERIOD, rng: detRng });
  eq("再刷新仍为 3 名", s.legion.candidates.length, 3);
  const newIds = s.legion.candidates.map((c) => c.npcId);
  ok("旧候选被替换", oldIds.every((id) => !newIds.includes(id)));
  eq("刷新后 candidateRefreshAt 再推进 4h", s.legion.candidateRefreshAt, T0 + 2 * PERIOD);
}

// ================================================================
// 五、手动刷新：费用翻倍（1/2/4/8/16，封顶 16）且不改自然计时
// ================================================================
console.log("\n[5] 手动刷新费用翻倍");
{
  const costSeq = [1, 2, 4, 8, 16, 16, 16];
  for (let c = 0; c < costSeq.length; c++) {
    const cost = LEGION_NPC.manualRefreshCost(c);
    eq("manualRefreshCost(" + c + ")", cost, { isk: 1e6 * costSeq[c], lp: 50 * costSeq[c] });
  }
  const s = makeState({ isk: 1e9, lp: 1e6 });
  LEGION_NPC.refreshLegionNpcCandidates(s, { now: T0, rng: detRng });
  const refreshAtBefore = s.legion.candidateRefreshAt;
  const startIsk = s.resources.isk, startLp = s.resources.lp;
  let prevCount = 0;
  for (let i = 0; i < 5; i++) {
    const r = LEGION_NPC.manuallyRefreshLegionNpcCandidates(s, { rng: detRng });
    ok("第" + (i + 1) + "次手动刷新成功", r.changed);
    eq("手动次数=" + (i + 1), s.legion.manualRefreshCount, i + 1);
  }
  eq("自然刷新计时器未被手动刷新改动", s.legion.candidateRefreshAt, refreshAtBefore);
  eq("扣费翻倍合计 ISK", startIsk - s.resources.isk, 1e6 * (1 + 2 + 4 + 8 + 16));
  eq("扣费翻倍合计 LP", startLp - s.resources.lp, 50 * (1 + 2 + 4 + 8 + 16));
  // 不足原子拦截
  const s2 = makeState({ isk: 1e5, lp: 1e6 }); // ISK 不足
  LEGION_NPC.refreshLegionNpcCandidates(s2, { now: T0, rng: detRng });
  const before = { isk: s2.resources.isk, lp: s2.resources.lp };
  const r2 = LEGION_NPC.manuallyRefreshLegionNpcCandidates(s2, { rng: detRng });
  eq("ISK 不足返回 insufficient", r2.reason, "insufficient");
  eq("ISK 不足未扣 ISK", s2.resources.isk, before.isk);
  eq("ISK 不足未扣 LP（原子）", s2.resources.lp, before.lp);
}

// ================================================================
// 六、招募：费用/工资、移除候选、原子扣费、重复防护
// ================================================================
console.log("\n[6] 招募");
{
  const s = makeState({ isk: 1e9, lp: 1e6 });
  LEGION_NPC.ensureLegionState(s);
  s.legion.candidates.push(makeNpc({ npcId: "cd", skillGrade: "D" }));
  s.legion.candidates.push(makeNpc({ npcId: "ca", skillGrade: "A" }));
  const before = { isk: s.resources.isk, lp: s.resources.lp };
  const rd = LEGION_NPC.recruitLegionNpc(s, "cd");
  ok("招募 D 成功", rd.changed);
  eq("招募 D 扣 ISK=1M", before.isk - s.resources.isk, 1e6);
  eq("招募 D 扣 LP=25", before.lp - s.resources.lp, 25);
  eq("D 从候选移除", s.legion.candidates.length, 1);
  const npc = rd.npc;
  eq("等级=1", npc.level, 1);
  eq("经验=0", npc.xp, 0);
  eq("工资状态 paid", npc.salaryState, "paid");
  eq("未绑舰", npc.boundShipInstanceId, null);
  // 重复招募同一候选（已被移除）→ 失败
  eq("重复招募同候选被拒", LEGION_NPC.recruitLegionNpc(s, "cd").reason, "candidate-not-found");
  // 招募不存在候选
  eq("招募不存在候选", LEGION_NPC.recruitLegionNpc(s, "nope").reason, "candidate-not-found");
  // 原子扣费：ISK 足但 LP 不足 → 不扣
  const s3 = makeState({ isk: 1e12, lp: 0 });
  LEGION_NPC.ensureLegionState(s3);
  s3.legion.candidates.push(makeNpc({ npcId: "cb", skillGrade: "B" }));
  const b3 = { isk: s3.resources.isk, lp: s3.resources.lp };
  const r3 = LEGION_NPC.recruitLegionNpc(s3, "cb");
  eq("LP 不足返回 insufficient", r3.reason, "insufficient");
  eq("LP 不足未扣 ISK（原子）", s3.resources.isk, b3.isk);
  eq("LP 不足未扣 LP（原子）", s3.resources.lp, b3.lp);
}

// ================================================================
// 七、工资结算：首调排程 / 充足全付 / 欠薪全停 / 多周期不重复 / 在线=离线
// ================================================================
console.log("\n[7] 工资结算");
{
  // 首次排程
  const s = makeState({ isk: 1e9, lp: 1e6 });
  s.legion.npcs.push(makeNpc({ skillGrade: "D" })); // wage 100k
  const first = LEGION_NPC.settleLegionNpcSalaries(s, { now: T0 });
  eq("首次结算 scheduled", first.reason, "scheduled");
  eq("首次未扣费", first.totalPaid, 0);
  // 充足：推进 1 周期
  const isk0 = s.resources.isk;
  const r1 = LEGION_NPC.settleLegionNpcSalaries(s, { now: T0 + PERIOD });
  ok("结算 1 周期", r1.settled && r1.periods === 1);
  eq("扣 1 周期工资 100k", isk0 - s.resources.isk, 100000);
  eq("全部 paid", r1.overdueNpcIds.length, 0);
  eq("nextSettlement 再推进", r1.nextSettlementAt, T0 + 2 * PERIOD);
  // 多周期不重复：直接跳 8h（2 周期）
  const isk1 = s.resources.isk;
  const r2 = LEGION_NPC.settleLegionNpcSalaries(s, { now: T0 + 3 * PERIOD });
  eq("再结算 2 周期", r2.periods, 2);
  eq("扣 2 周期工资 200k", isk1 - s.resources.isk, 200000);

  // 在线=离线 一致性（累计口径：跨多次调用求和，而非末次返回值）
  function runOnline() {
    const st = makeState({ isk: 1e12, lp: 1e6 });
    st.legion.npcs.push(makeNpc({ skillGrade: "B" })); // wage 350k
    LEGION_NPC.settleLegionNpcSalaries(st, { now: T0 }); // schedule
    let cumPaid = 0, cumPeriods = 0;
    let r = LEGION_NPC.settleLegionNpcSalaries(st, { now: T0 + PERIOD });
    cumPaid += r.totalPaid; cumPeriods += r.periods;
    r = LEGION_NPC.settleLegionNpcSalaries(st, { now: T0 + 3 * PERIOD });
    cumPaid += r.totalPaid; cumPeriods += r.periods;
    return { isk: st.resources.isk, paid: cumPaid, periods: cumPeriods };
  }
  function runOffline() {
    const st = makeState({ isk: 1e12, lp: 1e6 });
    st.legion.npcs.push(makeNpc({ skillGrade: "B" }));
    LEGION_NPC.settleLegionNpcSalaries(st, { now: T0 }); // schedule
    let cumPaid = 0, cumPeriods = 0;
    const r = LEGION_NPC.settleLegionNpcSalaries(st, { now: T0 + 3 * PERIOD }); // 离线 3 周期合并
    cumPaid += r.totalPaid; cumPeriods += r.periods;
    return { isk: st.resources.isk, paid: cumPaid, periods: cumPeriods };
  }
  const on = runOnline(), off = runOffline();
  eq("在线=离线：扣费一致", on.isk, off.isk);
  eq("在线=离线：周期数一致(累计)", on.periods, off.periods);
  eq("在线=离线：paid 一致(累计)", on.paid, off.paid);

  // 欠薪：不足时不扣部分，全部 overdue；恢复仅下次成功
  const sd = makeState({ isk: 50000, lp: 1e6 }); // < 100k
  sd.legion.npcs.push(makeNpc({ skillGrade: "D" }));
  LEGION_NPC.settleLegionNpcSalaries(sd, { now: T0 }); // schedule
  const od = LEGION_NPC.settleLegionNpcSalaries(sd, { now: T0 + PERIOD });
  eq("欠薪 overdue", od.overdueNpcIds.length, 1);
  eq("欠薪未扣费", od.totalPaid, 0);
  eq("工资状态=overdue", sd.legion.npcs[0].salaryState, "overdue");
  // 下一周期仍欠（仍不足）
  LEGION_NPC.settleLegionNpcSalaries(sd, { now: T0 + 2 * PERIOD });
  eq("持续欠薪", sd.legion.npcs[0].salaryState, "overdue");
  // 注入资金后下一周期恢复
  sd.resources.isk = 1e9;
  const rec = LEGION_NPC.settleLegionNpcSalaries(sd, { now: T0 + 3 * PERIOD });
  eq("恢复后 paid", rec.paidNpcIds.length, 1);
  eq("恢复后工资状态 paid", sd.legion.npcs[0].salaryState, "paid");
  eq("恢复仅扣当前周期（不补欠薪积压）", rec.totalPaid, 100000);
}

// ================================================================
// 八、经验：基础曲线 / 仅 paid / 等级上限 / 里程碑 / 在线=离线
// ================================================================
console.log("\n[8] 经验结算");
{
  // calculateLegionNpcXp：基础 100/h * mult，仅 paid
  const s = makeState({});
  s.legion.npcs.push(makeNpc({ skillId: "laserOps", skillGrade: "D", boundShipInstanceId: "sh_frig" }));
  addShip(s, "sh_frig", "rifter"); // frigate 兼容 combat
  const paid = s.legion.npcs[0];
  approx("paid frigate 4h XP", LEGION_NPC.calculateLegionNpcXp(s, paid, 4), 100 * 4 * 1.0);
  paid.salaryState = "overdue";
  eq("overdue XP=0", LEGION_NPC.calculateLegionNpcXp(s, paid, 4), 0);
  paid.salaryState = "paid";

  // 等级上限：无军团训练研究 → cap 20；超大时间不越界
  const sc = makeState({ hall: 1, legion: { technologyLevel: 0 } });
  sc.legion.npcs.push(makeNpc({ skillId: "laserOps", skillGrade: "D", boundShipInstanceId: "sh_sc" }));
  addShip(sc, "sh_sc", "starcrown"); // supercapital 兼容 combat → mult 3.0
  LEGION_NPC.settleLegionNpcExperience(sc, { now: T0 }); // schedule
  const big = LEGION_NPC.settleLegionNpcExperience(sc, { now: T0 + 1000 * PERIOD });
  eq("等级封顶 20", sc.legion.npcs[0].level, 20);
  eq("达上限 xp 归零", sc.legion.npcs[0].xp, 0);

  // 训练条令研究提升上限（legion_training@5 → 20+50=70 封顶）
  const st2 = makeState({});
  st2.research = { completedLevels: { legion_training: 5 } };
  st2.legion.npcs.push(makeNpc({ skillId: "laserOps", skillGrade: "D", boundShipInstanceId: "sh_sc2" }));
  addShip(st2, "sh_sc2", "starcrown");
  eq("训练条令@5 cap=70", LEGION_NPC.getLegionNpcLevelCap(st2), 70);
  LEGION_NPC.settleLegionNpcExperience(st2, { now: T0 });
  LEGION_NPC.settleLegionNpcExperience(st2, { now: T0 + 1000 * PERIOD });
  eq("训练条令@5 不超 70", st2.legion.npcs[0].level, 70);

  // 里程碑：每 10 级触发（mult 3.0，3 周期即破 20 级）
  const sm = makeState({});
  sm.legion.npcs.push(makeNpc({ skillId: "laserOps", skillGrade: "D", boundShipInstanceId: "sh_m" }));
  addShip(sm, "sh_m", "starcrown");
  LEGION_NPC.settleLegionNpcExperience(sm, { now: T0 });
  const ml = LEGION_NPC.settleLegionNpcExperience(sm, { now: T0 + 3 * PERIOD });
  const levels = ml.milestones.map((m) => m.level).sort((a, b) => a - b);
  ok("里程碑含 10 级", levels.includes(10));
  ok("里程碑含 20 级", levels.includes(20));

  // 在线=离线 经验一致
  function xpOnline() {
    const st = makeState({});
    st.legion.npcs.push(makeNpc({ skillId: "laserOps", skillGrade: "D", boundShipInstanceId: "sh_o" }));
    addShip(st, "sh_o", "rifter");
    LEGION_NPC.settleLegionNpcExperience(st, { now: T0 });
    let cum = 0;
    let r = LEGION_NPC.settleLegionNpcExperience(st, { now: T0 + PERIOD }); cum += r.totalXpGained;
    r = LEGION_NPC.settleLegionNpcExperience(st, { now: T0 + 3 * PERIOD }); cum += r.totalXpGained;
    return { lvl: st.legion.npcs[0].level, xp: st.legion.npcs[0].xp, gained: cum };
  }
  function xpOffline() {
    const st = makeState({});
    st.legion.npcs.push(makeNpc({ skillId: "laserOps", skillGrade: "D", boundShipInstanceId: "sh_f" }));
    addShip(st, "sh_f", "rifter");
    LEGION_NPC.settleLegionNpcExperience(st, { now: T0 });
    const r = LEGION_NPC.settleLegionNpcExperience(st, { now: T0 + 3 * PERIOD });
    return { lvl: st.legion.npcs[0].level, xp: st.legion.npcs[0].xp, gained: r.totalXpGained };
  }
  const xo = xpOnline(), xf = xpOffline();
  eq("在线=离线：等级一致", xo.lvl, xf.lvl);
  eq("在线=离线：xp 一致", xo.xp, xf.xp);
  eq("在线=离线：总经验一致", xo.gained, xf.gained);
}

// ================================================================
// 九、舰船经验倍率（尺寸阶级 + 不相容惩罚 + 无船）
// ================================================================
console.log("\n[9] 舰船经验倍率");
{
  const cases = [
    ["rifter", "frigate", 1.0],
    ["raylight", "destroyer", 1.25],
    ["dawnlight", "cruiser", 1.6],
    ["sunlance", "battleship", 2.0],
    ["firmament", "capital", 2.5],
    ["starcrown", "supercapital", 3.0]
  ];
  for (const [shipId, , mult] of cases) {
    const s = makeState({});
    s.legion.npcs.push(makeNpc({ skillId: "laserOps", skillGrade: "D", boundShipInstanceId: "i_" + shipId }));
    addShip(s, "i_" + shipId, shipId);
    approx("兼容 " + shipId + " 倍率", LEGION_NPC.getLegionNpcShipXpMultiplier(s, s.legion.npcs[0]), mult);
  }
  // 无船 → 0.5
  const s0 = makeState({});
  s0.legion.npcs.push(makeNpc({ skillId: "laserOps", skillGrade: "D" }));
  approx("无舰船倍率 0.5", LEGION_NPC.getLegionNpcShipXpMultiplier(s0, s0.legion.npcs[0]), 0.5);
  // 不相容：combat 技能 + 工业舰 → 0.5（tier 1.0 * 0.5）
  const sIncompat = makeState({});
  sIncompat.legion.npcs.push(makeNpc({ skillId: "laserOps", skillGrade: "D", boundShipInstanceId: "i_ind" }));
  addShip(sIncompat, "i_ind", "miner_frigate"); // industrial_frigate
  approx("不相容惩罚 0.5", LEGION_NPC.getLegionNpcShipXpMultiplier(sIncompat, sIncompat.legion.npcs[0]), 0.5);
  // 不存在舰船引用 → 0.5
  const sBad = makeState({});
  sBad.legion.npcs.push(makeNpc({ skillId: "laserOps", skillGrade: "D", boundShipInstanceId: "ghost" }));
  approx("引用不存在舰船 0.5", LEGION_NPC.getLegionNpcShipXpMultiplier(sBad, sBad.legion.npcs[0]), 0.5);
}

// ================================================================
// 十、管理类经验倍率（9 建筑求和分段，封顶 45，大厅未建=0 贡献）
// ================================================================
console.log("\n[10] 管理类经验倍率");
{
  function buildingsAll(v) {
    return { resource_dispatch: v, planetary_control: v, smelting_refinery: v, equipment_factory: v,
      booster_factory: v, archaeology_lab: v, combat_command: v, shipyard: v, legion_hall: v };
  }
  const sB = (b) => makeState({ hall: b.legion_hall || 0, isk: 1e9, lp: 1e6, legion: { technologyLevel: 0 } });
  const tiered = [
    [0, 0.5], [1, 1.0], [2, 1.5], [3, 2.0], [4, 2.5], [5, 3.0], [99, 3.0]
  ];
  for (const [v, mult] of tiered) {
    const st = makeState({ hall: v });
    st.station.buildings = buildingsAll(v);
    approx("9建筑均=" + v + " → " + mult, LEGION_NPC.getLegionNpcManagementXpMultiplier(st), mult);
  }
  // 大厅未建（缺 legion_hall）→ 其余 8 建筑满级仅得 40 → 2.5（vs 含大厅 45 → 3.0）
  const noHall = makeState({ hall: 0 });
  noHall.station.buildings = {
    resource_dispatch: 5, planetary_control: 5, smelting_refinery: 5, equipment_factory: 5,
    booster_factory: 5, archaeology_lab: 5, combat_command: 5, shipyard: 5
  }; // 无 legion_hall
  approx("大厅未建 8建筑满=2.5", LEGION_NPC.getLegionNpcManagementXpMultiplier(noHall), 2.5);

  // 管理类 NPC 走建筑倍率，绑舰不改变（不叠加）
  const stM = makeState({ hall: 5 }); // 9*5=45 → 3.0
  stM.station.buildings = buildingsAll(5);
  stM.legion.npcs.push(makeNpc({ skillId: "autolineSpeed", skillGrade: "D" })); // management
  const mNpc = stM.legion.npcs[0];
  approx("管理无舰倍率=建筑倍率 3.0", LEGION_NPC.getNpcXpMultiplier(stM, mNpc), 3.0);
  addShip(stM, "i_frig", "rifter");
  mNpc.boundShipInstanceId = "i_frig";
  approx("管理绑舰后仍=建筑倍率 3.0（不叠加）", LEGION_NPC.getNpcXpMultiplier(stM, mNpc), 3.0);
}

// ================================================================
// 十一、技能效果聚合 + 同类递减（前 5 满，第 6 起 1/(1+0.25*(n-5))）
// ================================================================
console.log("\n[11] 技能效果与同类递减");
{
  const s = makeState({});
  LEGION_NPC.ensureLegionState(s);
  // 6 名 production(mining) D 级 paid
  for (let i = 0; i < 6; i++) s.legion.npcs.push(makeNpc({ npcId: "p" + i, skillId: "mining", skillGrade: "D", salaryState: "paid" }));
  const eff = LEGION_NPC.getLegionNpcSkillEffects(s);
  // D HIGH base 1.0, lv1 → 1.0
  eq("production 前5满额", eff.contributions[0].factor, 1);
  eq("production 第6递减因子", eff.contributions[5].factor, 1 / (1 + 0.25 * (6 - 5)));
  approx("production 聚合=5 + 0.8", eff.categories.production, 5 * 1.0 + 0.8);
  // 欠薪不计入
  s.legion.npcs[5].salaryState = "overdue";
  const eff2 = LEGION_NPC.getLegionNpcSkillEffects(s);
  approx("6号欠薪后 production=5.0", eff2.categories.production, 5.0);
  eq("6号 counted=false", eff2.contributions.find((c) => c.npcId === "p5").counted, false);
  // 同分类按数量（非按品质）：6 名中各含不同 grade 仍按 6 计数
  const s2 = makeState({});
  const grades = ["A", "B", "C", "D", "D", "D"];
  grades.forEach((g, i) => s2.legion.npcs.push(makeNpc({ npcId: "q" + i, skillId: "mining", skillGrade: g, salaryState: "paid" })));
  const eff3 = LEGION_NPC.getLegionNpcSkillEffects(s2);
  eq("第6名（混合品质）仍取递减", eff3.contributions[5].factor, 0.8);
  // 管理类同样递减
  const s3 = makeState({});
  for (let i = 0; i < 6; i++) s3.legion.npcs.push(makeNpc({ npcId: "m" + i, skillId: "autolineSpeed", skillGrade: "D", salaryState: "paid" }));
  const eff4 = LEGION_NPC.getLegionNpcSkillEffects(s3);
  eq("管理第6递减", eff4.contributions[5].factor, 0.8);
  ok("管理聚合计入 management", eff4.categories.management > 0);
}

// ================================================================
// 十二、舰船绑定接口：失败条件 / 替换销毁旧舰 / 解雇销毁
// ================================================================
console.log("\n[12] 舰船绑定与解雇");
{
  const s = makeState({});
  s.legion.npcs.push(makeNpc({ npcId: "n1" }));
  s.legion.npcs.push(makeNpc({ npcId: "n2" }));
  addShip(s, "sa", "rifter");
  addShip(s, "sb", "dawnlight");
  addShip(s, "sc", "sunlance");
  // 失败：NPC 不存在
  eq("绑舰 NPC 不存在", LEGION_NPC.assignLegionNpcShip(s, "nx", "sa").reason, "npc-not-found");
  // 失败：舰船不存在
  eq("绑舰 舰船不存在", LEGION_NPC.assignLegionNpcShip(s, "n1", "ghost").reason, "ship-not-found");
  // 成功绑定 sa
  ok("绑定 sa 成功", LEGION_NPC.assignLegionNpcShip(s, "n1", "sa").changed);
  eq("n1 绑定 sa", s.legion.npcs[0].boundShipInstanceId, "sa");
  // 失败：sa 已被 n1 占用
  eq("sa 被占用无法绑 n2", LEGION_NPC.assignLegionNpcShip(s, "n2", "sa").reason, "ship-in-use");
  // 替换：n1 改绑 sb → sa 被销毁
  ok("n1 改绑 sb", LEGION_NPC.assignLegionNpcShip(s, "n1", "sb").changed);
  eq("n1 绑定 sb", s.legion.npcs[0].boundShipInstanceId, "sb");
  eq("旧舰 sa 已销毁", s.inventory.ships.find((x) => x.instanceId === "sa"), undefined);
  // 解雇 n1 → 绑舰 sb 一并销毁
  LEGION_NPC.dismissLegionNpc(s, "n1");
  eq("解雇后 n1 移除", s.legion.npcs.find((n) => n.npcId === "n1"), undefined);
  eq("解雇销毁绑舰 sb", s.inventory.ships.find((x) => x.instanceId === "sb"), undefined);
  // 解雇不存在 NPC
  eq("解雇不存在", LEGION_NPC.dismissLegionNpc(s, "nope").reason, "npc-not-found");
}

// ================================================================
// 十三、迁移幂等（ensureLegionState 不破坏既有数据）
// ================================================================
console.log("\n[13] 迁移幂等");
{
  // 无 legion 键 → 创建（用裸状态验证自动创建，而非 makeState 预置）
  const s = {
    station: { bodyLevel: 2, buildings: { legion_hall: 1 } },
    resources: { isk: 1e9, lp: 1e6 },
    inventory: { ships: [] }
  };
  const L = LEGION_NPC.getLegionState(s);
  ok("自动创建 legion", L && Array.isArray(L.npcs) && Array.isArray(L.candidates));
  eq("默认 technologyLevel=0", L.technologyLevel, 0);
  // 已有 npcs/candidates 不被清空
  L.npcs.push(makeNpc({ npcId: "keep" }));
  L.candidates.push(makeNpc({ npcId: "keepc" }));
  const L2 = LEGION_NPC.getLegionState(s);
  eq("重复调用不丢 NPC", L2.npcs.length, 1);
  eq("重复调用不丢候选", L2.candidates.length, 1);
  // 字段补齐：部分 legion
  const sp = makeState({ legion: { npcs: [makeNpc({ npcId: "x" })] } });
  const Lp = LEGION_NPC.getLegionState(sp);
  eq("补齐 candidates", Array.isArray(Lp.candidates), true);
  eq("补齐 candidateRefreshAt", typeof Lp.candidateRefreshAt, "number");
  eq("保留既有 npc", Lp.npcs.length, 1);
}

// ================================================================
// 十四、tick 集成：首调排程，后续不重复扣费
// ================================================================
console.log("\n[14] tick 集成与重复执行防护");
{
  const s = makeState({ isk: 1e12, lp: 1e6 });
  s.legion.npcs.push(makeNpc({ skillId: "laserOps", skillGrade: "D", boundShipInstanceId: "i_t" }));
  addShip(s, "i_t", "rifter");
  const t1 = LEGION_NPC.tickLegionNpc(s, { now: T0 });
  eq("首 tick 激活", t1.active, true);
  // 首 tick 仅排程（边界设为 now），尚无到期周期 → 不结算、不扣费
  eq("首 tick 未结算(排程)", t1.salaries.settled, false);
  eq("首 tick 结算周期数=0", t1.salaries.periods, 0);
  // 连续两次同一时刻不应重复结算
  const iskBefore = s.resources.isk;
  LEGION_NPC.tickLegionNpc(s, { now: T0 }); // 同刻再 tick
  eq("同刻再 tick 不重复扣费", s.resources.isk, iskBefore);
  // 推进 4h 结算 1 周期
  const isk2 = s.resources.isk;
  const t2 = LEGION_NPC.tickLegionNpc(s, { now: T0 + PERIOD });
  eq("推进后结算 1 周期", t2.salaries.periods, 1);
  eq("扣 1 周期 100k", isk2 - s.resources.isk, 100000);
}

// ================================================================
// 十五、双环境可调用（浏览器 window 路径模拟）
// ================================================================
console.log("\n[15] 双环境可调用（window 模拟）");
{
  const code = readFileSync(path.join(ROOT, "js/systems/legion-npc.js"), "utf8");
  // 在 vm 中以“浏览器”上下文运行：提供 window + 自定义 require 解析依赖
  const hostRequire = (p) => {
    if (p.includes("npc-names")) return require(path.join(ROOT, "js/data/legion/npc-names.js"));
    if (p.includes("npc-personalities")) return require(path.join(ROOT, "js/data/legion/npc-personalities.js"));
    if (p.includes("npc-skills")) return require(path.join(ROOT, "js/data/legion/npc-skills.js"));
    if (p.includes("npc-dialogue")) return require(path.join(ROOT, "js/data/legion/npc-dialogue.js"));
    if (p.includes("ships.js")) return require(path.join(ROOT, "js/data/ships.js"));
    throw new Error("unexpected require: " + p);
  };
  const sandbox = { window: {}, require: hostRequire, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  ok("window.LEGION_NPC 已挂载", typeof sandbox.window.LEGION_NPC === "object");
  ok("window 下 getLegionState 可调用", typeof sandbox.window.LEGION_NPC.getLegionState === "function");
  // 在 window 上下文实际跑一次刷新
  const ws = makeState({});
  const wr = sandbox.window.LEGION_NPC.refreshLegionNpcCandidates(ws, { now: T0, rng: detRng });
  ok("window 上下文刷新可用", wr.changed && ws.legion.candidates.length === 3);
}

// ================================================================
// 汇总
// ================================================================
console.log("\n========================================");
console.log("军团 NPC 招募与贡献测试");
console.log("PASS: " + PASS + "   FAIL: " + FAIL);
if (failures.length) {
  console.log("\n失败项：");
  failures.forEach((f) => console.log("  - " + f));
}
console.log("========================================");
process.exit(FAIL > 0 ? 1 : 0);
