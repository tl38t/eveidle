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
const NPC = require(join(ROOT, "js/systems/legion-npc.js"));

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
