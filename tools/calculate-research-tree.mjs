// ============================================================================
//  calculate-research-tree.mjs
//  研究科技树测算与断言（第二阶段 · 返修版）
//
//  核心修正（对照验收意见）：
//   1) 建模为「科技ID@等级」步骤图（buildSteps）。
//   2) 所有解锁/关键路径/推荐路线均按【唯一单科研槽】计算：
//        - 多个前置耗时累加；
//        - 重复前置只计算一次；
//        - 严禁使用 Math.max 模拟并行科研。
//   3) 推荐路线允许科技停在 II/III/IV 后转向其他分支，
//      不强制单节点连续 I→V（生成器逐等级推进）。
//   4) 成就工时池真实模拟（0/240-360/480-600/720h 四档 + 120-200h 说明）。
//   5) 采气汇总修正为 allMining + gas（不再引用 allMfg）。
//   6) 新增多项断言。
//
//  不修改任何数据或游戏代码。
// ============================================================================
import {
  NODES, WEIGHTS, RANK_MULT, TARGET_SECONDS, DAYS, UNIT, TOTAL_WEIGHT, STEP_COUNT, buildSteps,
} from "./research-tree-data.mjs";

// ---------------------------------------------------------------------------
//  断言工具
// ---------------------------------------------------------------------------
let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; }
  else { FAIL++; console.error("  ✗ FAIL: " + msg); }
}
const byId = {};
NODES.forEach(n => (byId[n.id] = n));
const durationOf = (id, lvl) => byId[id].durationByLevel[lvl - 1];
const DAY = 86400;

// ---------------------------------------------------------------------------
//  1-5. 规模断言
// ---------------------------------------------------------------------------
const foundations = NODES.filter(n => n.type === "foundation");
const numerics = NODES.filter(n => n.type === "numeric");
const protocols = NODES.filter(n => n.type === "protocol");
const totalSteps = NODES.reduce((s, n) => s + n.maxLevel, 0);

assert(NODES.length === 38, `节点总数=38 (实际 ${NODES.length})`);
assert(foundations.length === 4, `基础科技=4 (实际 ${foundations.length})`);
assert(numerics.length === 28, `五级科技=28 (实际 ${numerics.length})`);
assert(protocols.length === 6, `协议节点=6 (实际 ${protocols.length})`);
assert(totalSteps === 150, `总研究步骤=150 (实际 ${totalSteps})`);
assert(STEP_COUNT === 150, `步骤图 STEP_COUNT=150 (实际 ${STEP_COUNT})`);

// ---------------------------------------------------------------------------
//  6-7. 前置存在 & 等级合法
// ---------------------------------------------------------------------------
let prereqOk = true, levelOk = true;
for (const n of NODES) {
  for (const p of n.prerequisites) {
    if (!byId[p.id]) { prereqOk = false; console.error(`  前置ID不存在: ${n.id} -> ${p.id}`); }
    else if (p.level < 1 || p.level > byId[p.id].maxLevel) {
      levelOk = false;
      console.error(`  前置等级非法: ${n.id} -> ${p.id} L${p.level} (上限 ${byId[p.id].maxLevel})`);
    }
  }
}
assert(prereqOk, "所有前置ID存在");
assert(levelOk, "前置等级合法（1..前置maxLevel）");

// ---------------------------------------------------------------------------
//  8. 无循环依赖（节点级拓扑排序）
// ---------------------------------------------------------------------------
function topoSort() {
  const indeg = {}; NODES.forEach(n => (indeg[n.id] = 0));
  const adj = {}; NODES.forEach(n => (adj[n.id] = []));
  for (const n of NODES) for (const p of n.prerequisites) { adj[p.id].push(n.id); indeg[n.id]++; }
  const q = NODES.filter(n => indeg[n.id] === 0).map(n => n.id);
  const order = [];
  while (q.length) {
    const id = q.shift(); order.push(id);
    for (const m of adj[id]) { if (--indeg[m] === 0) q.push(m); }
  }
  return order;
}
const topo = topoSort();
assert(topo.length === NODES.length, `无循环依赖（拓扑序长度=${topo.length}）`);

// ---------------------------------------------------------------------------
//  9. 从根可达
// ---------------------------------------------------------------------------
const roots = NODES.filter(n => n.prerequisites.length === 0).map(n => n.id);
const reach = new Set(roots);
let changed = true;
while (changed) {
  changed = false;
  for (const n of NODES) {
    if (!reach.has(n.id) && n.prerequisites.every(p => reach.has(p.id))) {
      reach.add(n.id); changed = true;
    }
  }
}
assert(reach.size === NODES.length, `所有节点从根可达（可达 ${reach.size}/${NODES.length}）`);

// ---------------------------------------------------------------------------
//  10. 无成就加速总时间 = 90 天（误差 ≤ 1 分钟）
// ---------------------------------------------------------------------------
let totalTime = 0;
for (const n of NODES) for (let lvl = 1; lvl <= n.maxLevel; lvl++) totalTime += n.durationByLevel[lvl - 1];
const diffMin = Math.abs(totalTime - TARGET_SECONDS) / 60;
assert(diffMin <= 1, `无加速总时间=90天 (偏差 ${diffMin.toFixed(4)} 分钟)`);

// ===========================================================================
//  单科研槽步骤图模型（需求 1&2）
//    unlock(id@lvl) = 所有前置步骤（含传递）耗时之和，每个步骤只计一次。
//    严禁 Math.max：单槽下所有前置必须依次完成，耗时累加。
// ===========================================================================
// 返回 id@lvl 开始研究前必须完成的全部步骤 key 集合（不含 id@lvl 自身）
const closureMemo = new Map();
function closureSteps(id, lvl) {
  const key = "c:" + id + "@" + lvl;
  if (closureMemo.has(key)) return closureMemo.get(key);
  const set = new Set();
  const n = byId[id];
  // 同节点低等级步骤 1..lvl-1
  for (let k = 1; k < lvl; k++) set.add(id + "@" + k);
  // 跨节点前置：p@1..p@L 全部 + 其传递前置
  for (const p of n.prerequisites) {
    for (let k = 1; k <= p.level; k++) set.add(p.id + "@" + k);
    const sub = closureSteps(p.id, p.level);
    for (const s of sub) set.add(s);
  }
  closureMemo.set(key, set);
  return set;
}
// 单槽解锁时间 = 前置步骤耗时累加（每个一次）
function ancestorsDuration(id, lvl) {
  let sum = 0;
  for (const sk of closureSteps(id, lvl)) {
    const at = sk.lastIndexOf("@");
    const sid = sk.slice(0, at), sl = Number(sk.slice(at + 1));
    sum += durationOf(sid, sl);
  }
  return sum;
}
// 协议最快解锁（单槽）：开始研究协议前需完成其前置步骤之和
function protocolUnlock(id) { return ancestorsDuration(id, 1); }
// 某领域完成到 targetLvl 的耗时（单槽 = 目标步骤 ∪ 全部传递前置，去重后累加）
function domainCompletion(cat, targetLvl) {
  const set = new Set();
  for (const n of NODES) if (n.category === cat) {
    for (let lvl = 1; lvl <= targetLvl; lvl++) set.add(n.id + "@" + lvl);
    for (const s of closureSteps(n.id, targetLvl)) set.add(s);
  }
  let t = 0;
  for (const sk of set) {
    const at = sk.lastIndexOf("@");
    const sid = sk.slice(0, at), sl = Number(sk.slice(at + 1));
    t += durationOf(sid, sl);
  }
  return t;
}

// ---------------------------------------------------------------------------
//  11. 各等级总时间占比
// ---------------------------------------------------------------------------
const levelTotals = [0, 0, 0, 0, 0]; // I..V
for (const n of NODES) for (let lvl = 1; lvl <= n.maxLevel; lvl++) levelTotals[lvl - 1] += n.durationByLevel[lvl - 1];
const levelPct = levelTotals.map(t => (t / totalTime) * 100);

// ---------------------------------------------------------------------------
//  12. 各领域(rank)总时间占比
// ---------------------------------------------------------------------------
const catTotals = {};
for (const n of NODES) catTotals[n.category] = (catTotals[n.category] || 0) + n.durationByLevel.reduce((a, b) => a + b, 0);
const catPct = {};
for (const c in catTotals) catPct[c] = (catTotals[c] / totalTime) * 100;

// ---------------------------------------------------------------------------
//  13. 六个协议最快解锁时间（单槽，前置累加）
// ---------------------------------------------------------------------------
const protoUnlock = {};
protocols.forEach(p => (protoUnlock[p.id] = protocolUnlock(p.id)));
assert(protocols.every(p => isFinite(protoUnlock[p.id]) && protoUnlock[p.id] > 0), "单槽协议解锁时间均为正且有限");

// ---------------------------------------------------------------------------
//  14-16. 领域里程碑（单槽：完成该领域全部步骤到指定等级的耗时之和）
// ---------------------------------------------------------------------------
const domainIII = {
  industry: domainCompletion("industry", 3),
  exploration: domainCompletion("exploration", 3),
  combat: domainCompletion("combat", 3),
  logistics: domainCompletion("logistics", 3),
};
const domainIV = {
  industry: domainCompletion("industry", 4),
  exploration: domainCompletion("exploration", 4),
  combat: domainCompletion("combat", 4),
  logistics: domainCompletion("logistics", 4),
};
// 全数值节点 V：foundation + numeric 全部步骤之和（单槽）
let numericVTime = 0;
for (const n of NODES) if (n.type === "foundation" || n.type === "numeric") {
  for (let lvl = 1; lvl <= n.maxLevel; lvl++) numericVTime += durationOf(n.id, lvl);
}
const numericVDays = numericVTime / DAY;
assert(Object.values(domainIII).every(t => t > 0 && isFinite(t)), "单槽各领域III完成时间均为正且有限");
assert(Object.values(domainIV).every(t => t > 0 && isFinite(t)), "单槽各领域IV完成时间均为正且有限");

// 六协议加入后总计精确 90 天（分区断言：数值V + 协议 = 全树）
let protocolSum = 0;
protocols.forEach(p => (protocolSum += durationOf(p.id, 1)));
assert(Math.abs(numericVTime + protocolSum - TARGET_SECONDS) / 60 <= 1,
  `全数值V+六协议=90天 (分区断言, numericV=${numericVDays.toFixed(3)}天, 合计=${(numericVTime + protocolSum) / DAY}天)`);

// 协议解锁时间分散于 2.53–22.37 天（Codex 分散方案，不采纳旧 §13 估时）
const protoDaysArr = protocols.map(p => protoUnlock[p.id] / DAY);
const protoMin = Math.min(...protoDaysArr), protoMax = Math.max(...protoDaysArr);
assert(protoMin >= 2.5 && protoMax <= 22.5, `协议解锁分散于 2.53–22.37 天 (实测 ${protoMin.toFixed(2)}–${protoMax.toFixed(2)} 天)`);

// ---------------------------------------------------------------------------
//  17. 最终累计数值表（基础 + 专精叠加）
// ---------------------------------------------------------------------------
const finalTable = {};
function add(group, value, negative) {
  finalTable[group] = (finalTable[group] || 0) + (negative ? -value : value);
}
for (const n of NODES) {
  const b = n.bonus;
  if (!b) continue;
  if (b.flat !== undefined) add(b.group, b.flat, b.negative);
  else if (b.perLevel !== undefined) add(b.group, b.perLevel * n.maxLevel, b.negative);
}
// 综合战术模型：同时计入武器伤害与三层生命
if (finalTable.tactical !== undefined) {
  finalTable.allWeapon = (finalTable.allWeapon || 0) + finalTable.tactical;
  finalTable.tierHp = (finalTable.tierHp || 0) + finalTable.tactical;
}
const m = finalTable;
// 独立校验（需求 6）：采气 / 制造 / 考古 / 武器 / 防御
const gasVal = (m.allMining || 0) + (m.gas || 0);                       // 采气 = 基础采集 + 采气专精（修正：不再引用 allMfg）
const mfgVal = (m.allMfg || 0) + (m.equip || 0);                        // 制造 = 基础制造 + 装备专精
const archVal = (m.archEff || 0);                                      // 考古 = 基础考古 + 遗迹分析
const weaponVal = (m.allWeapon || 0) + (m.weaponDmg || 0) + (m.laserDmg || 0); // 武器专精（激光）
const defenseVal = (m.tierHp || 0) + (m.shield || 0);                   // 防御专精（护盾层）
assert(Math.abs((m.allMining + (m.mining || 0)) - 8) < 1e-9, `满采矿 +8% (实际 ${m.allMining + (m.mining || 0)})`);
assert(Math.abs(mfgVal - 8) < 1e-9, `满单项制造 +8% (实际 ${mfgVal})`);
assert(Math.abs(archVal - 8) < 1e-9, `满考古效率 +8% (实际 ${archVal})`);
assert(Math.abs(weaponVal - 12.5) < 1e-9, `单一武器完整专精 +12.5% (实际 ${weaponVal})`);
assert(Math.abs(defenseVal - 10.5) < 1e-9, `对应专精防御层 +10.5% (实际 ${defenseVal})`);
// 采气独立校验（需求6）
assert(Math.abs(gasVal - 8) < 1e-9, `满采气效率 +8% (实际 ${gasVal})`);

// ---------------------------------------------------------------------------
//  18. 无 NaN / Infinity / 负时间
// ---------------------------------------------------------------------------
let badTime = false;
for (const n of NODES) for (const d of n.durationByLevel) {
  if (!isFinite(d) || d < 0) { badTime = true; break; }
}
assert(!badTime, "不存在 NaN / Infinity / 负时间");

// ---------------------------------------------------------------------------
//  19. 幂等（同输入重复运行一致）
// ---------------------------------------------------------------------------
const totalAgain = NODES.reduce((s, n) => s + n.durationByLevel.reduce((a, b) => a + b, 0), 0);
assert(Math.abs(totalAgain - totalTime) < 1e-9, "同输入重复运行结果一致");

// ---------------------------------------------------------------------------
//  附加断言（占比 / 单槽解锁正值 / 数值节点全 5 级）
// ---------------------------------------------------------------------------
assert(Math.abs(levelPct.reduce((a, b) => a + b, 0) - 100) < 0.01, "各等级占比合计=100%");
assert(levelPct[4] > 50, `V级承担全树大部分时间 (>50%, 实际 ${levelPct[4].toFixed(1)}%)`);
assert(Object.values(catPct).every(p => p >= 0 && p <= 100), "各领域占比均在 [0,100]%");
assert(numerics.every(n => n.maxLevel === 5), "所有数值节点均为 5 级");
assert(isFinite(numericVTime) && numericVTime > 0, "全数值节点V时间为正且有限");

// ===========================================================================
//  成就工时池真实模拟（需求 4）
//    规则：成就奖励一次性科研工时；单节点最多跳过基础时间的 50%；
//          研究类成就本身不奖励工时。
//    模拟：按单槽开始时间顺序，对每个 step 扣除 min(50%*d, 剩余池)，
//          累计剩余时间。
// ===========================================================================
function simulateWithPool(poolSeconds) {
  let remaining = poolSeconds;
  let total = 0;
  const steps = [];
  for (const n of NODES) for (let lvl = 1; lvl <= n.maxLevel; lvl++) steps.push({ id: n.id, lvl });
  // 单槽开始时间顺序（ancestorsDuration 升序），保证确定性
  steps.forEach(s => (s._ad = ancestorsDuration(s.id, s.lvl)));
  steps.sort((a, b) => (a._ad - b._ad) || a.id.localeCompare(b.id) || (a.lvl - b.lvl));
  for (const s of steps) {
    const d = durationOf(s.id, s.lvl);
    const maxSkip = 0.5 * d;
    const skip = Math.min(maxSkip, remaining);
    remaining -= skip;
    total += d - skip;
  }
  return total;
}
const poolDays = h => simulateWithPool(h * 3600) / DAY;
// 理论：单节点≤50% → 全树最多省 45 天；低于该上限时 1:1 抵扣（省 = min(h/24, 45) 天）
const expectDays = h => 90 - Math.min(h / 24, 45);
const d0 = poolDays(0);
const d240 = poolDays(240), d360 = poolDays(360);
const d480 = poolDays(480), d600 = poolDays(600);
const d720 = poolDays(720);
const d120 = poolDays(120), d200 = poolDays(200);
const EPS = 1 / 60; // 1 分钟容差（步骤秒数浮点求和引入）
assert(Math.abs(d0 - expectDays(0)) < EPS, `成就 0h = 90天 (实际 ${d0.toFixed(4)} 期望 ${expectDays(0)})`);
assert(Math.abs(d240 - expectDays(240)) < EPS, `成就 240h = 75-80天 (实际 ${d240.toFixed(2)} 期望 ${expectDays(240)})`);
assert(Math.abs(d360 - expectDays(360)) < EPS, `成就 360h = 75-80天 (实际 ${d360.toFixed(2)} 期望 ${expectDays(360)})`);
assert(Math.abs(d480 - expectDays(480)) < EPS, `成就 480h = 65-70天 (实际 ${d480.toFixed(2)} 期望 ${expectDays(480)})`);
assert(Math.abs(d600 - expectDays(600)) < EPS, `成就 600h = 65-70天 (实际 ${d600.toFixed(2)} 期望 ${expectDays(600)})`);
assert(Math.abs(d720 - expectDays(720)) < EPS, `成就 720h = 60天 (实际 ${d720.toFixed(4)} 期望 ${expectDays(720)})`);
// 120-200h 区间说明（约 81.7-85 天）
assert(d120 <= 85 && d120 > 80, `成就 120h 约 81.7-85天 (实际 ${d120.toFixed(2)})`);
assert(d200 <= 85 && d200 >= 81, `成就 200h 约 81.7-85天 (实际 ${d200.toFixed(2)})`);

// ===========================================================================
//  推荐研究计划（需求 2&3：目标闭包优先 + 允许中途转向）
//    阶段一：按给定顺序先完成每个【目标协议】的闭包（全部传递前置 + 协议自身），
//            在依赖序下逐步入栈，绝不强制单节点连续 I→V；
//    阶段二：均衡补全（按 era 优先的确定性拓扑序）完成其余所有步骤。
// ===========================================================================
// 全局确定性单槽拓扑步序（era 优先，均衡铺开）——用于阶段二补参与阶段一过滤
const stepTopo = (() => {
  const order = [];
  const cur = {}; NODES.forEach(n => (cur[n.id] = 0));
  let progress = true;
  while (progress) {
    progress = false;
    const ns = NODES.slice().sort((a, b) => a.era - b.era || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
    for (const n of ns) {
      if (cur[n.id] < n.maxLevel && n.prerequisites.every(p => cur[p.id] >= p.level)) {
        cur[n.id]++; order.push({ id: n.id, lvl: cur[n.id] }); progress = true;
      }
    }
  }
  return order;
})();
function buildClosureFirstPlan(targets) {
  const done = new Set();
  const order = [];
  const addStep = (id, lvl) => { const k = id + "@" + lvl; if (!done.has(k)) { done.add(k); order.push({ id, lvl }); } };
  // 阶段一：各目标协议的闭包（传递前置）+ 协议自身，按全局拓扑序入栈
  for (const tid of targets) {
    const needed = new Set(closureSteps(tid, 1));
    needed.add(tid + "@1");
    for (const s of stepTopo) {
      const k = s.id + "@" + s.lvl;
      if (needed.has(k) && !done.has(k)) addStep(s.id, s.lvl);
    }
  }
  // 阶段二：均衡补全其余所有步骤
  for (const s of stepTopo) {
    const k = s.id + "@" + s.lvl;
    if (!done.has(k)) addStep(s.id, s.lvl);
  }
  return order;
}
const planDefs = {
  "工业自动化优先": { targets: ["intship", "autoenh"] },
  "探索自动化优先": { targets: ["autosell", "autoconv"] },
  "后勤优先":       { targets: ["planauto"] },
  "战斗专精优先":   { targets: ["autorepair"] },
  "均衡发展":       { targets: [] },
  "最短全满":       { targets: [] },
};
const planReports = {};
for (const [name, def] of Object.entries(planDefs)) {
  const order = buildClosureFirstPlan(def.targets);
  const finish = {}; let t = 0;
  for (const s of order) { t += durationOf(s.id, s.lvl); finish[s.id + "@" + s.lvl] = t; }
  const protoDone = {};
  protocols.forEach(p => (protoDone[p.id] = finish[p.id + "@1"] / DAY));
  const domainIIIInPlan = {};
  for (const c of ["industry", "exploration", "combat", "logistics"]) {
    const ns = numerics.filter(n => n.category === c);
    domainIIIInPlan[c] = Math.max(...ns.map(n => finish[n.id + "@3"])) / DAY;
  }
  planReports[name] = { steps: order.length, totalDays: t / DAY, protoDone, domainIII: domainIIIInPlan };
}

// ===========================================================================
//  报告
// ===========================================================================
console.log("\n================ 研究科技树测算报告（单槽步骤图 · 返修版） ================\n");
console.log(`统一公式: duration(step) = UNIT × WEIGHTS[level-1] × RANK_MULT[category]`);
console.log(`WEIGHTS(I..V) = [${WEIGHTS.join(", ")}]`);
console.log(`RANK_MULT = ${JSON.stringify(RANK_MULT)}`);
console.log(`TOTAL_WEIGHT = ${TOTAL_WEIGHT.toFixed(3)}`);
console.log(`UNIT = ${UNIT.toFixed(3)} 秒 ≈ ${(UNIT / 3600).toFixed(2)} 小时`);
console.log(`目标总时长 = ${DAYS} 天 = ${TARGET_SECONDS} 秒`);
console.log(`实测总时长 = ${(totalTime / DAY).toFixed(4)} 天 = ${totalTime.toFixed(1)} 秒`);
console.log(`偏差 = ${diffMin.toFixed(4)} 分钟`);
console.log(`步骤图规模 = ${STEP_COUNT} 步（科技ID@等级）\n`);

console.log("--- 11. 各等级总时间占比（单槽累加） ---");
["I", "II", "III", "IV", "V"].forEach((L, i) => {
  console.log(`  ${L}级: ${(levelTotals[i] / DAY).toFixed(2)}天  ${levelPct[i].toFixed(2)}%`);
});

console.log("\n--- 12. 各领域(rank)总时间占比 ---");
for (const c in catPct) console.log(`  ${c}: ${(catTotals[c] / DAY).toFixed(2)}天  ${catPct[c].toFixed(2)}%`);

console.log("\n--- 13. 六个协议最快解锁时间（单槽，前置累加，天） ---");
for (const p of protocols) console.log(`  ${p.name}: ${(protoUnlock[p.id] / DAY).toFixed(2)} 天`);

console.log("\n--- 14. 四个领域完成到 III 级时间（单槽，天） ---");
for (const c in domainIII) console.log(`  ${c}: ${(domainIII[c] / DAY).toFixed(2)} 天`);

console.log("\n--- 15. 四个领域全 IV 时间（单槽，天） ---");
for (const c in domainIV) console.log(`  ${c}: ${(domainIV[c] / DAY).toFixed(2)} 天`);

console.log("\n--- 16. 全数值节点 V 时间 + 六协议 = 90 天（分区断言） ---");
console.log(`  全数值V(foundation+numeric) = ${numericVDays.toFixed(3)} 天`);
console.log(`  六协议合计 = ${(protocolSum / DAY).toFixed(4)} 天`);
console.log(`  数值V + 协议 = ${((numericVTime + protocolSum) / DAY).toFixed(4)} 天（精确 90 天）`);

console.log("\n--- 17. 最终累计数值表（满级，基础+专精叠加） ---");
const T = (m.tactical || 0);
const rows = [
  ["满采矿效率", (m.allMining || 0) + (m.mining || 0)],
  ["满采气效率(修正)", gasVal],
  ["满冶炼效率", (m.allMfg || 0) + (m.smelt || 0)],
  ["满装备制造效率", mfgVal],
  ["满增强剂制造效率", (m.allMfg || 0) + (m.booster || 0)],
  ["满舰船组件效率", (m.allMfg || 0) + (m.shipComp || 0)],
  ["满舰船总装效率", (m.allMfg || 0) + (m.shipAsm || 0)],
  ["满考古效率", archVal],
  ["满考古成功率", (m.archSuccess || 0) + "pp"],
  ["满反噬减伤", (m.backlash || 0)],
  ["满探针减耗", (m.probe || 0)],
  ["满考古经验", (m.archExp || 0)],
  ["满战斗经验", (m.combatExp || 0)],
  ["单武器完整专精(激光)", weaponVal],
  ["满激光伤害", weaponVal],
  ["满导弹伤害", (m.allWeapon || 0) + (m.weaponDmg || 0) + (m.missileDmg || 0)],
  ["满射弹伤害", (m.allWeapon || 0) + (m.weaponDmg || 0) + (m.projDmg || 0)],
  ["非专精三层生命", (m.tierHp || 0)],
  ["专精护盾层生命", defenseVal],
  ["满护盾容量", defenseVal],
  ["满装甲容量", (m.tierHp || 0) + (m.armor || 0)],
  ["满结构容量", (m.tierHp || 0) + (m.structure || 0)],
  ["满主动维修量", (m.repair || 0)],
  ["满维护燃料减耗", (m.fuel || 0)],
  ["满建设效率", (m.build || 0)],
  ["满自动线效率", (m.autoline || 0)],
  ["满行星维护费减耗", (m.planCost || 0)],
  ["满行星生产效率", (m.planProd || 0)],
];
rows.forEach(([k, v]) => console.log(`  ${k}: ${typeof v === "number" ? (Math.round(v * 1000) / 1000) : v}`));

console.log("\n--- 成就工时池模拟（真实扣除，单节点≤50%） ---");
console.log(`  0h    = ${d0.toFixed(2)} 天`);
console.log(`  120h  = ${d120.toFixed(2)} 天（说明：仅约 81.7-85 天）`);
console.log(`  200h  = ${d200.toFixed(2)} 天`);
console.log(`  240h  = ${d240.toFixed(2)} 天`);
console.log(`  360h  = ${d360.toFixed(2)} 天`);
console.log(`  480h  = ${d480.toFixed(2)} 天`);
console.log(`  600h  = ${d600.toFixed(2)} 天`);
console.log(`  720h  = ${d720.toFixed(2)} 天`);

console.log("\n--- 推荐研究计划（目标闭包优先 · 单槽；总时长恒 90 天） ---");
for (const [name, r] of Object.entries(planReports)) {
  console.log(`\n  [${name}] 步骤=${r.steps} 总时长=${r.totalDays.toFixed(2)}天`);
  console.log(`    领域III(工/探/战/后)=${Math.round(r.domainIII.industry)}/${Math.round(r.domainIII.exploration)}/${Math.round(r.domainIII.combat)}/${Math.round(r.domainIII.logistics)} 天`);
  const protoLine = protocols.map(p => `${p.name}=${r.protoDone[p.id].toFixed(2)}`).join("  ");
  console.log(`    协议实际完成时刻(天): ${protoLine}`);
}
console.log("\n  说明：");
console.log("   · 目标闭包优先——先完成目标协议的全传递前置闭包再研究该协议，之后均衡补全；");
console.log("   · 表中『协议实际完成时刻』为该计划单槽排程下协议步骤完成的真实时刻（非 §13 理论最快值）；");
console.log("   · 无目标协议的计划（均衡发展/最短全满）按 era 优先均衡铺开，协议完成时刻取决于自然进度。");

console.log(`\n================ 断言结果: PASS=${PASS} FAIL=${FAIL} ================\n`);
if (FAIL > 0) { process.exit(1); }
