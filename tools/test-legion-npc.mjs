// ================================================================
// 军团 DLC —— NPC 名字库 / 性格库 / 文案库 验收测试
// ----------------------------------------------------------------
// 直接 require 逻辑文件（其 UMD 会自动加载 4 个数据文件），
// 不依赖浏览器 / index.html / 游戏存档。
// 运行：node tools/test-legion-npc.mjs
// ================================================================
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// 研究数据层 + 状态层：set globalThis.ResearchData / globalThis.ResearchState
// 顺序敏感：research-state.js 在 IIFE 加载时读取 globalThis.ResearchData。
require(join(ROOT, "js/data/research.js"));       // globalThis.ResearchData
require(join(ROOT, "js/core/research-state.js")); // globalThis.ResearchState（依赖 ResearchData）
const NPC = require(join(ROOT, "js/systems/legion-npc.js"));

// 读取已挂载的研究数据（用于 §13 数据层断言：双人/三人小队节点）
function getResearchNode(id) {
  const RD = (typeof globalThis !== "undefined" && globalThis.ResearchData) || null;
  if (!RD || !Array.isArray(RD.NODES)) return null;
  return RD.NODES.find(function (n) { return n.id === id; }) || null;
}

// —— 确定性 RNG（mulberry32），用于可复现测试 ——
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; failures.push(msg); console.log("  ✗ " + msg); }
}
function section(title) { console.log("\n== " + title + " =="); }

// 深拷贝（用于「不改存档」断言）
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ---------------------------------------------------------------
section("1. 名字库：无重复、数量达标");
ok(Array.isArray(NPC.NAMES), "NAMES 是数组");
ok(NPC.NAMES.length >= 100, "名字数量 >= 100（实际 " + NPC.NAMES.length + "）");
const uniq = new Set(NPC.NAMES);
ok(uniq.size === NPC.NAMES.length, "名字库无重复项（" + uniq.size + "/" + NPC.NAMES.length + "）");
ok(NPC.NAMES.every(function (n) { return typeof n === "string" && n.length > 0; }), "所有名字均为非空字符串");

// ---------------------------------------------------------------
section("2. 性格库：结构完整");
ok(Array.isArray(NPC.PERSONALITIES), "PERSONALITIES 是数组");
ok(NPC.PERSONALITIES.length >= 10, "性格数量 >= 10（实际 " + NPC.PERSONALITIES.length + "）");
const reqFields = ["personalityId", "name", "desc", "tone", "style"];
let persStructOk = true;
NPC.PERSONALITIES.forEach(function (p) {
  reqFields.forEach(function (f) { if (!(f in p)) persStructOk = false; });
});
ok(persStructOk, "每种性格都包含 personalityId/name/desc/tone/style");
const persIds = new Set(NPC.PERSONALITIES.map(function (p) { return p.personalityId; }));
ok(persIds.size === NPC.PERSONALITIES.length, "性格 personalityId 唯一");

// ---------------------------------------------------------------
section("3. 技能库：21 种 + 数值沿用设计");
ok(Array.isArray(NPC.SKILLS), "SKILLS 是数组");
ok(NPC.SKILLS.length === 21, "技能数量 == 21（实际 " + NPC.SKILLS.length + "）");
const skillIds = new Set(NPC.SKILLS.map(function (s) { return s.id; }));
ok(skillIds.size === 21, "技能 id 唯一");
let gradesOk = true;
NPC.SKILLS.forEach(function (s) {
  if (!s.grades || !s.grades.A || !s.grades.B || !s.grades.C || !s.grades.D) gradesOk = false;
  ["A", "B", "C", "D"].forEach(function (g) {
    if (typeof s.grades[g].base !== "number" || typeof s.grades[g].per !== "number") gradesOk = false;
  });
  if (!s.category || !s.name || !s.type) gradesOk = false;
});
ok(gradesOk, "每个技能含 type/name/category 与 A/B/C/D 的 base/per 数值");
// 抽样核对既有数值（高数值组 mining / 低数值组 capacitor / 管理 wageReduce）
const mining = NPC.getSkillById("mining");
ok(mining && mining.grades.A.base === 2.0 && mining.grades.A.per === 0.30 && mining.grades.D.base === 1.0, "采矿(矿脉勘探) A=2.0/+0.30、D=1.0 数值正确");
const cap = NPC.getSkillById("capacitorManagement");
ok(cap && cap.grades.A.base === 1.2 && cap.grades.D.base === 0.5 && cap.grades.D.per === 0.10, "电容管理(电容节流) 低数值组 A=1.2/D=0.5 正确");
const wage = NPC.getSkillById("wageReduce");
ok(wage && wage.grades.A.base === 2.0 && wage.category === "management", "薪资统筹 高数值组 A=2.0、归类 management 正确");
// 等级权重
ok(NPC.GRADE_WEIGHTS.A === 5 && NPC.GRADE_WEIGHTS.B === 15 && NPC.GRADE_WEIGHTS.C === 30 && NPC.GRADE_WEIGHTS.D === 50,
  "等级权重 A5/B15/C30/D50 正确");

// ---------------------------------------------------------------
section("4. 每种事件都有默认（通用）文案");
NPC.EVENTS.forEach(function (ev) {
  const g = NPC.DIALOGUE.generic[ev];
  ok(Array.isArray(g) && g.length >= 3, "事件 " + ev + " 通用文案 >= 3 条");
});

// ---------------------------------------------------------------
section("5. 每种性格 × 每种事件都有文案（含兜底）");
let allHave = true;
NPC.PERSONALITIES.forEach(function (p) {
  NPC.EVENTS.forEach(function (ev) {
    const r = NPC.getNpcDialogue({ personalityId: p.personalityId, skillId: "mining", dialogueHistory: [] }, ev, { rng: mulberry32(1) });
    if (!r || typeof r.text !== "string" || r.text.length === 0) { allHave = false; }
  });
});
ok(allHave, "12 性格 × 12 事件 均能得到非空文案");

// ---------------------------------------------------------------
section("6. 缺失文案时正常兜底");
// 6a 性格不存在 → 回退 generic
const rGhost = NPC.getNpcDialogue({ personalityId: "ghost_xyz", skillId: "mining", dialogueHistory: [] }, "recruit", { rng: mulberry32(2) });
ok(rGhost.text.length > 0, "未知性格仍能返回通用文案");
// 6b 技能不存在 → 回退 generic
const rNoSkill = NPC.getNpcDialogue({ personalityId: "calm", skillId: "nope", dialogueHistory: [] }, "salaryPaid", { rng: mulberry32(3) });
ok(rNoSkill.text.length > 0, "未知技能仍能返回通用文案");
// 6c 性格缺位但技能类别存在 → 回退技能类别文案
const rCat = NPC.getNpcDialogue({ personalityId: "ghost_xyz", skillId: "mining", dialogueHistory: [] }, "shipAssigned", { rng: mulberry32(4) });
ok(rCat.text.length > 0, "性格缺位时回退到技能类别文案（production）");

// ---------------------------------------------------------------
section("7. 台词不会连续重复");
const hist = [];
const npc7 = { personalityId: "warm", skillId: "laserOps", dialogueHistory: [] };
let consecutiveRepeat = false;
let prev = null;
for (let i = 0; i < 80; i++) {
  const r = NPC.getNpcDialogue(npc7, "dailyGreeting", { rng: mulberry32(100 + i) });
  if (prev !== null && r.text === prev) consecutiveRepeat = true;
  prev = r.text;
}
ok(!consecutiveRepeat, "同一 NPC 同一事件连续 80 次调用无连续重复");
ok(npc7.dialogueHistory.length > 0, "dialogueHistory 已记录（仅作用于该 NPC）");

// ---------------------------------------------------------------
section("8. 生成候选人：字段完整且不改存档");
const state8 = { legion: { npcs: [{ name: "林澜" }], candidates: [] } };
const before8 = clone(state8);
const cand = NPC.generateLegionNpcCandidate(state8, { rng: mulberry32(7) });
ok(clone(state8).legion.npcs[0].name === "林澜", "生成未改动已有 NPC");
ok(state8.legion.candidates.length === 0, "生成未向 state.legion.candidates 写入");
ok(JSON.stringify(state8) === JSON.stringify(before8), "generateLegionNpcCandidate 未修改 state");
const needFields = ["npcId", "name", "personalityId", "skillId", "skillGrade", "level", "xp", "boundShipInstanceId", "dialogueHistory"];
ok(needFields.every(function (f) { return f in cand; }), "候选人含全部必填字段");
ok(cand.level === 1, "level 初始为 1");
ok(cand.xp === 0, "xp 初始为 0");
ok(cand.boundShipInstanceId === null, "boundShipInstanceId 初始为 null");
ok(cand.dialogueHistory.length === 0, "dialogueHistory 初始为空");
ok(NPC.GRADES.indexOf(cand.skillGrade) >= 0, "skillGrade 为 A/B/C/D 之一");
ok(!!NPC.getSkillById(cand.skillId), "skillId 指向合法技能");
ok(!!NPC.getPersonalityById(cand.personalityId), "personalityId 指向合法性格");

// ---------------------------------------------------------------
section("9. 21 种技能均可被生成 + 等级概率符合权重");
const seenSkills = new Set();
const seenGrades = new Set();
const gradeCount = { A: 0, B: 0, C: 0, D: 0 };
const N = 4000;
for (let i = 0; i < N; i++) {
  const c = NPC.generateLegionNpcCandidate({ legion: { npcs: [], candidates: [] } }, { rng: mulberry32(1000 + i) });
  seenSkills.add(c.skillId);
  seenGrades.add(c.skillGrade);
  gradeCount[c.skillGrade]++;
}
ok(seenSkills.size === 21, "4000 次生成覆盖全部 21 种技能（实际 " + seenSkills.size + "）");
ok(seenGrades.size === 4, "A/B/C/D 四种等级均出现");
const pct = function (k) { return (gradeCount[k] / N * 100); };
ok(pct("A") > 3 && pct("A") < 7, "A 级占比约 5%（实际 " + pct("A").toFixed(2) + "%）");
ok(pct("B") > 12 && pct("B") < 18, "B 级占比约 15%（实际 " + pct("B").toFixed(2) + "%）");
ok(pct("C") > 27 && pct("C") < 33, "C 级占比约 30%（实际 " + pct("C").toFixed(2) + "%）");
ok(pct("D") > 47 && pct("D") < 53, "D 级占比约 50%（实际 " + pct("D").toFixed(2) + "%）");

// ---------------------------------------------------------------
section("10. 名字去重：军团内 / 同批不重名");
const state10 = { legion: { npcs: [{ name: "林澜" }, { name: "苏野" }], candidates: [{ name: "赫尔曼·维克" }] } };
let dupWithLegion = false;
for (let i = 0; i < 50; i++) {
  const c = NPC.generateLegionNpcCandidate(state10, { rng: mulberry32(2000 + i) });
  if (c.name === "林澜" || c.name === "苏野" || c.name === "赫尔曼·维克") dupWithLegion = true;
}
ok(!dupWithLegion, "生成的名字不与军团内已有名字重复");
const batch = NPC.generateLegionNpcCandidates({ legion: { npcs: [], candidates: [] } }, 3, { rng: mulberry32(55) });
const batchNames = new Set(batch.map(function (b) { return b.name; }));
ok(batchNames.size === batch.length, "同一批 " + batch.length + " 名候选人名字互不重复");

// ---------------------------------------------------------------
section("11. 舰船类型兼容判定（纯函数，不影响数值）");
ok(NPC.isShipClassCompatible("mining", "industrial") === true, "采矿 + 工业舰 兼容");
ok(NPC.isShipClassCompatible("mining", "combat") === false, "采矿 + 战斗舰 不兼容");
ok(NPC.isShipClassCompatible("laserOps", "combat") === true, "激光操作 + 战斗舰 兼容");
ok(NPC.isShipClassCompatible("archaeologySpeed", "archaeology") === true, "考古速度 + 考古舰 兼容");
ok(NPC.isShipClassCompatible("autolineSpeed", null) === true, "管理类(无舰)恒兼容");
ok(NPC.isShipClassCompatible("wageReduce", "combat") === true, "管理类(任意舰)恒兼容");
ok(NPC.isShipClassCompatible("mining", null) === false, "有舰种要求但无船 → 不兼容");

// ---------------------------------------------------------------
section("12. 文案系统不改动存档、不产生额外奖励");
const state12 = { legion: { npcs: [], candidates: [] }, resources: { isk: 999 }, skills: { mining: 5 } };
const before12 = clone(state12);
const npc12 = { personalityId: "calm", skillId: "mining", dialogueHistory: [] };
// 模拟「按需显示一条最近事件文案」（离线结算不应调用此接口）
const disp = NPC.getNpcDialogue(npc12, "dailyGreeting", { rng: mulberry32(9) });
ok(JSON.stringify(state12) === JSON.stringify(before12), "getNpcDialogue 未改动 state");
ok(typeof disp.text === "string" && disp.text.length > 0, "显示用文案非空");
ok(Object.keys(disp).join(",") === "text,eventType,personalityId,skillId", "返回对象仅含展示字段，无奖励/数值");
// 模拟离线结算：只调用生成接口，不调用 getNpcDialogue → 不应产生台词
const offlineCand = NPC.generateLegionNpcCandidate(state12, { rng: mulberry32(10) });
ok(offlineCand.dialogueHistory.length === 0, "离线式生成不产生 dialogueHistory 条目");
ok(JSON.stringify(state12) === JSON.stringify(before12), "离线式生成未改动 state");

// ---------------------------------------------------------------
section("13. 军团研究效果接入（NPC 容量 / 等级上限 / 经验乘子）");
// 构造存档：本体 Lv.3 + 军团大厅；通过 state.research.completedLevels 反映研究完成度。
function rsLegion(opts) {
  opts = opts || {};
  return {
    station: { bodyLevel: opts.bodyLevel != null ? opts.bodyLevel : 3, buildings: opts.buildings || { legion_hall: opts.hall != null ? opts.hall : 1 } },
    research: { completedLevels: opts.completed || {} },
    legion: { technologyLevel: opts.technologyLevel != null ? opts.technologyLevel : 0 },
    resources: { isk: 0, lp: 0 }
  };
}

// 13a 无研究 → 仅大厅基数 / 等级上限 20 / 经验乘子 1
ok(NPC.getLegionNpcCapacity(rsLegion({ hall: 1 })) === 6, "无研究·大厅1 → 总人数上限 6（6+(1-1)+0）");
ok(NPC.getLegionNpcCapacity(rsLegion({ hall: 3 })) === 8, "无研究·大厅3 → 总人数上限 8（6+(3-1)）");
ok(NPC.getLegionNpcLevelCap(rsLegion({})) === 20, "无研究 → NPC 等级上限 20");
ok(NPC.getLegionNpcResearchXpMultiplier(rsLegion({})) === 1, "无研究 → NPC 经验乘子 1");

// 13b 征募编制 I / V 级 → 容量 +1 / +5
ok(NPC.getLegionNpcCapacity(rsLegion({ hall: 1, completed: { legion_staffing: 1 } })) === 7, "征募编制@1 → 容量 7（+1）");
ok(NPC.getLegionNpcCapacity(rsLegion({ hall: 1, completed: { legion_staffing: 5 } })) === 11, "征募编制@5 → 容量 11（+5）");

// 13c 容量封顶 15
ok(NPC.getLegionNpcCapacity(rsLegion({ hall: 10, completed: { legion_staffing: 5 } })) === 15, "大厅10+征募@5 → 容量封顶 15（6+9+5=20→15）");
ok(NPC.getLegionNpcCapacity(rsLegion({ hall: 30 })) === 15, "大厅30 无研究 → 容量封顶 15（6+29→15）");

// 13d 训练条令 I / V 级 → 等级上限 +10 / +50
ok(NPC.getLegionNpcLevelCap(rsLegion({ completed: { legion_training: 1 } })) === 30, "训练条令@1 → 等级上限 30（+10）");
ok(NPC.getLegionNpcLevelCap(rsLegion({ completed: { legion_training: 5 } })) === 70, "训练条令@5 → 等级上限 70（+50）");

// 13e 等级上限封顶 70（超量 completed 仅作防御性钳制验证）
ok(NPC.getLegionNpcLevelCap(rsLegion({ completed: { legion_training: 99 } })) === 70, "训练条令 超量 → 等级上限封顶 70");

// 13f 作战学说 I / V 级 → 经验乘子 1.02 / 1.10
ok(Math.abs(NPC.getLegionNpcResearchXpMultiplier(rsLegion({ completed: { legion_doctrine: 1 } })) - 1.02) < 1e-9, "作战学说@1 → 经验乘子 1.02");
ok(Math.abs(NPC.getLegionNpcResearchXpMultiplier(rsLegion({ completed: { legion_doctrine: 5 } })) - 1.10) < 1e-9, "作战学说@5 → 经验乘子 1.10");

// 13g 欠薪 / 系统未激活 → 不产生经验
const npcPaid = { skillId: "wageReduce", salaryState: "paid", level: 1, xp: 0, boundShipInstanceId: null, dialogueHistory: [] };
const npcOverdue = { skillId: "wageReduce", salaryState: "overdue", level: 1, xp: 0, boundShipInstanceId: null, dialogueHistory: [] };
const stActiveDoctrine5 = rsLegion({ completed: { legion_doctrine: 5 }, buildings: { legion_hall: 1, combat_command: 5, shipyard: 5 } });
ok(NPC.calculateLegionNpcXp(stActiveDoctrine5, npcOverdue, 10, {}) === 0, "欠薪 NPC → 经验 0");
ok(NPC.calculateLegionNpcXp(rsLegion({ bodyLevel: 1 }), npcPaid, 10, {}) === 0, "系统未激活（本体<2）→ 经验 0");

// 13h 管理建筑倍率 × 研究经验倍率 叠加（管理类 NPC 无舰船倍率）
const mgmtMult = NPC.getLegionNpcManagementXpMultiplier(stActiveDoctrine5); // 建筑等级和=1+5+5=11 → tier≤17 → 1.0
ok(Math.abs(mgmtMult - 1.0) < 1e-9, "管理建筑倍率：和=11 → 1.0");
const researchMult = NPC.getLegionNpcResearchXpMultiplier(stActiveDoctrine5); // 学说@5 → 1.10
ok(Math.abs(researchMult - 1.10) < 1e-9, "研究经验倍率：学说@5 → 1.10");
const expectedStacked = 100 * 10 * mgmtMult * researchMult; // BASE_XP_PER_HOUR=100
ok(Math.abs(NPC.calculateLegionNpcXp(stActiveDoctrine5, npcPaid, 10, {}) - expectedStacked) < 1e-6,
  "管理倍率×研究倍率 叠加正确（预期 " + expectedStacked + " XP）");
// 对照：无研究时仅管理倍率
const stNoDoctrine = rsLegion({ buildings: { legion_hall: 1, combat_command: 5, shipyard: 5 } });
ok(Math.abs(NPC.calculateLegionNpcXp(stNoDoctrine, npcPaid, 10, {}) - 100 * 10 * 1.0 * 1.0) < 1e-6, "无研究 → 仅管理倍率（预期 1000 XP）");

// 13i 舰船尺寸 XP 倍率档位（含 2026-09-01 新增 support 档：驮星级 industrial_support 曾兜底 0.5 与未绑定同值）
{
  const stShip = rsLegion({ bodyLevel: 5, buildings: { legion_hall: 1 } });
  const mkNpc = (shipInstanceId) => ({ skillId: "mining", salaryState: "paid", level: 1, xp: 0, boundShipInstanceId: shipInstanceId });
  stShip.inventory = stShip.inventory || {}; stShip.inventory.ships = [
    { instanceId: "i-dolphin", shipId: "dolphin" },   // industrial_support → support 档
    { instanceId: "i-orca", shipId: "orca" },          // industrial_capital → capital 档
    { instanceId: "i-combat", shipId: "atron" }        // 战斗舰（不匹配 industrial → 惩罚）
  ];
  ok(Math.abs(NPC.getNpcXpMultiplier(stShip, mkNpc("i-dolphin")) - 1.6) < 1e-9, "支援舰档：驮星级(industrial_support) → 1.6（对齐 support≈cruiser）");
  ok(Math.abs(NPC.getNpcXpMultiplier(stShip, mkNpc("i-orca")) - 2.5) < 1e-9, "旗舰档：山海级(industrial_capital) → 2.5");
  // atron=frigate（tier 1.0）× 不匹配惩罚 0.5 = 0.5（getShipTierMult 未导出，tier 值取自 SHIP_TIER_MULT 表）
  ok(Math.abs(NPC.getNpcXpMultiplier(stShip, mkNpc("i-combat")) - 0.5) < 1e-9, "不匹配舰船（闪刃级 frigate）→ tier×0.5 惩罚");
  ok(Math.abs(NPC.getNpcXpMultiplier(stShip, mkNpc(null)) - 0.5) < 1e-9, "未绑定 → 兜底 0.5（≠支援舰 1.6，修复同值问题）");
}

// 13i 旧档 technologyLevel 字段不再提供数值效果
ok(NPC.getLegionNpcCapacity(rsLegion({ hall: 1, technologyLevel: 99 })) === 6,
  "旧 technologyLevel=99 不影响容量（仍为 6）");
ok(NPC.getLegionNpcLevelCap(rsLegion({ technologyLevel: 99 })) === 20,
  "旧 technologyLevel=99 不影响等级上限（仍为 20）");

// 13j 研究系统缺失 → 安全回退到基数（加成=0）
const savedRS = globalThis.ResearchState;
delete globalThis.ResearchState;
const capFallback = NPC.getLegionNpcCapacity(rsLegion({ hall: 1, completed: { legion_staffing: 5 } }));
const lvlFallback = NPC.getLegionNpcLevelCap(rsLegion({ completed: { legion_training: 5 } }));
const xpFallback = NPC.getLegionNpcResearchXpMultiplier(rsLegion({ completed: { legion_doctrine: 5 } }));
ok(capFallback === 6, "研究系统缺失 → 容量回退 6（忽略未读取的 staffing@5）");
ok(lvlFallback === 20, "研究系统缺失 → 等级上限回退 20");
ok(xpFallback === 1, "研究系统缺失 → 经验乘子回退 1");
globalThis.ResearchState = savedRS; // 还原

// 13k 双人 / 三人小队：仅作「解锁」节点（bonus=null，不提供数值加成，受数值分支前置门控）
const dual = getResearchNode("legion_dual_squad");
const triple = getResearchNode("legion_triple_squad");
ok(dual && dual.type === "protocol" && dual.bonus === null, "双人小队：协议节点且 bonus=null（仅解锁）");
ok(triple && triple.type === "protocol" && triple.bonus === null, "三人小队：协议节点且 bonus=null（仅解锁）");
ok(dual && Array.isArray(dual.prerequisites) && dual.prerequisites.some(function (p) { return p.id === "legion_staffing"; }) &&
  dual.prerequisites.some(function (p) { return p.id === "legion_training"; }) && dual.prerequisites.some(function (p) { return p.id === "legion_doctrine"; }),
  "双人小队 前置门控依赖于 征募/训练/学说 数值分支");
ok(triple && Array.isArray(triple.prerequisites) && triple.prerequisites.some(function (p) { return p.id === "legion_dual_squad"; }),
  "三人小队 前置门控依赖于 双人小队（逐层解锁）");
// 三个消费组（legionNpcCapacity / legionNpcLevelCap / legionNpcXp）均不应引用 dual/triple
const RSapi = globalThis.ResearchState;
let squadContributesToNpc = false;
if (RSapi && RSapi.getResearchBonusRaw) {
  const groups = ["legionNpcCapacity", "legionNpcLevelCap", "legionNpcXp"];
  const probe = rsLegion({ completed: { legion_dual_squad: 1, legion_triple_squad: 1, legion_staffing: 5, legion_training: 5, legion_doctrine: 5 } });
  groups.forEach(function (g) {
    const withSquad = RSapi.getResearchBonusRaw(probe, g);
    const without = RSapi.getResearchBonusRaw(rsLegion({ completed: { legion_staffing: 5, legion_training: 5, legion_doctrine: 5 } }), g);
    if (withSquad !== without) squadContributesToNpc = true;
  });
}
ok(!squadContributesToNpc, "双人/三人小队 完成不向 NPC 数值组（容量/等级/经验）贡献任何加成");

// ---------------------------------------------------------------
console.log("\n=====================================");
console.log("结果：通过 " + pass + " / 失败 " + fail);
if (fail > 0) {
  console.log("失败项：");
  failures.forEach(function (m) { console.log("  - " + m); });
  process.exit(1);
} else {
  console.log("全部验收通过 ✅");
  process.exit(0);
}
