// 机器断言：成就计数对账 + 平台映射 / CSV 一致性。
//
// 覆盖第一阶段交付决定·七 / ·八 的机器保证：
// - ACHIEVEMENTS.length 权威值 = 193（旧静态占位曾误写 197）。
// - ACHIEVEMENTS / ACHIEVEMENTS_BY_ID / PlatformAchievementMap / CSV 四套“内部 ID 集合”必须互相等价。
// - 首轮候选 G01–G06 在 CSV 标记 firstRound=true；第一阶段全部 enabled=false（不发布）。
// - 第一阶段 OVERRIDES 为空 → 全部 isConfigured=false（运行期不同步任何未确认成就）。
//
// 用法：node tools/audit-achievement-platform-map.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");

let failures = 0;
function ok(cond, label) {
  if (cond) { console.log("  PASS  " + label); }
  else { console.log("  FAIL  " + label); failures++; }
}

// 在独立 vm 上下文加载数据模块（成就数据经 window.AchievementData 暴露）。
function loadInContext(files) {
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.console = console;
  vm.createContext(ctx);
  for (const f of files) {
    const code = readFileSync(join(repo, f), "utf8");
    vm.runInContext(code, ctx, { filename: f });
  }
  return ctx;
}

const ctx = loadInContext([
  "js/data/achievements.js",
  "js/data/platform-achievement-map.js"
]);

const ACH = ctx.ACHIEVEMENTS || (ctx.AchievementData && ctx.AchievementData.ACHIEVEMENTS) || [];
const BY_ID = ctx.ACHIEVEMENTS_BY_ID || (ctx.AchievementData && ctx.AchievementData.ACHIEVEMENTS_BY_ID) || {};
const MAP = ctx.PlatformAchievementMap;

console.log("== 成就计数与映射一致性审计 ==");

// 1) 权威计数 = 193（对账结论：旧 UI 静态占位 197 已废弃）。
ok(ACH.length === 193, "ACHIEVEMENTS.length === 193 (权威值，旧占位 197 已废弃) [" + ACH.length + "]");
ok(ACH.length === Object.keys(BY_ID).length, "ACHIEVEMENTS.length === ACHIEVEMENTS_BY_ID 键数 (无重复/无丢失) [" + Object.keys(BY_ID).length + "]");

// 2) 映射键集 == 成就集合（构造上由 ACHIEVEMENTS 生成，这里做运行时验证）。
ok(MAP && typeof MAP.count === "function", "PlatformAchievementMap 已加载");
ok(MAP.count() === ACH.length, "PlatformAchievementMap 键数 === ACHIEVEMENTS.length [" + MAP.count() + "]");
const achIds = new Set(ACH.map(a => a.id));
const mapIds = new Set(MAP.ids());
let mapSubset = true, mapSuperset = true;
achIds.forEach(id => { if (!mapIds.has(id)) mapSuperset = false; });
mapIds.forEach(id => { if (!achIds.has(id)) mapSubset = false; });
ok(mapSubset, "映射键集 ⊂ 成就集合（无孤儿键）");
ok(mapSuperset, "映射键集 ⊃ 成就集合（无缺漏键）");

// 3) CSV 行数 == 成就数，且 ID 集合一致。
const csvText = readFileSync(join(repo, "TAPTAP_ACHIEVEMENT_SETUP.csv"), "utf8");
const csvLines = csvText.split(/\r?\n/).filter(l => l.length > 0);
const csvHeader = csvLines[0];
const csvRows = csvLines.slice(1).map(l => l.split(","));
ok(csvHeader === "internalId,category,tier,hidden,nameStatus,firstRound,enabled,taptapId", "CSV 表头正确（含 taptapId 空列）");
ok(csvRows.length === ACH.length, "CSV 数据行数 === ACHIEVEMENTS.length [" + csvRows.length + "]");
const csvIds = new Set(csvRows.map(r => r[0]));
let csvSubset = true, csvSuperset = true;
achIds.forEach(id => { if (!csvIds.has(id)) csvSuperset = false; });
csvIds.forEach(id => { if (!achIds.has(id)) csvSubset = false; });
ok(csvSubset, "CSV 内部 ID ⊂ 成就集合（无孤儿行）");
ok(csvSuperset, "CSV 内部 ID ⊃ 成就集合（无缺漏行）");

// 4) 首轮候选 G01–G06：firstRound=true 且 enabled=false。
const byIdCsv = {};
csvRows.forEach(r => { byIdCsv[r[0]] = r; });
const FR = ["G01", "G02", "G03", "G04", "G05", "G06"];
let frOk = true;
FR.forEach(id => {
  const row = byIdCsv[id];
  if (!row || row[5] !== "true" || row[6] !== "false") frOk = false;
});
ok(frOk, "首轮候选 G01–G06 在 CSV 中 firstRound=true 且 enabled=false");

// 5) 第一阶段：不应有任何 enabled=true（不发布任何成就）。
const enabledCount = csvRows.filter(r => r[6] === "true").length;
ok(enabledCount === 0, "第一阶段 CSV 无 enabled=true 行 [" + enabledCount + "]");

// 6) 第一阶段：OVERRIDES 空 → 全部 isConfigured=false（运行期不同步未确认成就）。
const configured = ACH.filter(a => MAP.isConfigured(a.id)).length;
ok(configured === 0, "第一阶段 PlatformAchievementMap 无已配置平台 ID（isConfigured=false）[" + configured + "]");

// 7) nameStatus 统计（对账报告用）。
const stat = {};
ACH.forEach(a => { const k = a.nameStatus || "unknown"; stat[k] = (stat[k] || 0) + 1; });
console.log("  统计 nameStatus = " + JSON.stringify(stat));
ok((stat.placeholder || 0) + (stat.provisional || 0) === ACH.length, "全部成就 nameStatus 仅含 placeholder/provisional（无正式命名）");

console.log(failures === 0 ? "\n审计通过 (0 失败)" : "\n审计失败 (" + failures + " 项)");
process.exit(failures === 0 ? 0 : 1);
