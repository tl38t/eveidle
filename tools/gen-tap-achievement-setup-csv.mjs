// 生成 TAPTAP_ACHIEVEMENT_SETUP.csv —— 从 js/data/achievements.js 提取全部成就，
// 输出“后台配置清单”草稿。首轮候选 G01–G06 标记 firstRound=true；
// 全部 enabled=false（第一阶段交付决定·八：默认不发布，待用户在 TapTap 后台确认 ID）。
//
// 用法：node tools/gen-tap-achievement-setup-csv.mjs
// 该脚本仅用于（重新）生成清单；运行期游戏不读取本 CSV（运行期以 platform-achievement-map.js 为准）。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");
const src = readFileSync(join(repo, "js/data/achievements.js"), "utf8");

const FIRST_ROUND = new Set(["G01", "G02", "G03", "G04", "G05", "G06"]);

const field = (line, key) => {
  const m = line.match(new RegExp(key + ':\\s*"([^"]*)"'));
  return m ? m[1] : "";
};
const boolField = (line, key) => {
  const m = line.match(new RegExp(key + ":\\s*(true|false)"));
  return m ? m[1] : "false";
};

const rows = [];
for (const line of src.split(/\r?\n/)) {
  if (!/id:\s*"/.test(line)) continue;
  const id = field(line, "id");
  if (!id) continue;
  const category = field(line, "category");
  const tier = field(line, "tier");
  const hidden = boolField(line, "hidden");
  const nameStatus = field(line, "nameStatus");
  rows.push({
    id,
    category,
    tier,
    hidden,
    nameStatus,
    firstRound: FIRST_ROUND.has(id) ? "true" : "false",
    enabled: "false", // 第一阶段：默认不发布
    taptapId: ""      // 平台成就 ID：第一阶段全部留空（与 PlatformAchievementMap 全 null 口径一致）
  });
}

// 按 ID 排序，保证清单稳定可读。
rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const header = "internalId,category,tier,hidden,nameStatus,firstRound,enabled,taptapId";
const lines = [header];
for (const r of rows) {
  lines.push([r.id, r.category, r.tier, r.hidden, r.nameStatus, r.firstRound, r.enabled, r.taptapId].join(","));
}
const out = join(repo, "TAPTAP_ACHIEVEMENT_SETUP.csv");
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.log("写入 " + out + " （" + rows.length + " 行成就）");
if (FIRST_ROUND.size !== 6) throw new Error("首轮候选数量异常");
const fr = rows.filter(r => r.firstRound === "true");
if (fr.length !== 6) throw new Error("首轮候选 CSV 行数异常: " + fr.length);
const en = rows.filter(r => r.enabled === "true");
if (en.length !== 0) throw new Error("第一阶段不应有任何 enabled=true");
