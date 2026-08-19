// 装备采集等级审计（RC11）：驱逐舰及以下宽松到 +20
import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "js", "data", "equipment.js");
const src = fs.readFileSync(FILE, "utf8");

// 提取 EQUIPMENT_DB = {...}; 之间的对象字面量
const start = src.indexOf("const EQUIPMENT_DB");
const objStart = src.indexOf("{", start);
// 找到配平的大括号（仅 EQUIPMENT_DB 对象）
let depth = 0, i = objStart, end = -1;
for (; i < src.length; i++) {
  const c = src[i];
  if (c === "{") depth++;
  else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
}
const dbText = src.slice(objStart, end + 1); // 仅对象字面量
// 提取 RIG_SERIES 与 RIG_TIER_META 数组字面量（用于本地复刻 buildRigDefinitions）
function extractArray(varName) {
  const s = src.indexOf("const " + varName + " =");
  const b = src.indexOf("[", s);
  let depth = 0, e = -1;
  for (let k = b; k < src.length; k++) {
    if (src[k] === "[") depth++;
    else if (src[k] === "]") { depth--; if (depth === 0) { e = k; break; } }
  }
  return new Function("return " + src.slice(b, e + 1) + ";")();
}
const RIG_SERIES = extractArray("RIG_SERIES");
const RIG_TIER_META = extractArray("RIG_TIER_META");
function buildRigDefinitions() {
  const defs = {};
  for (const series of RIG_SERIES) {
    for (let t = 0; t < RIG_TIER_META.length; t++) {
      const meta = RIG_TIER_META[t];
      const id = series.stackGroup + "_" + meta.suffix;
      const cost = { ...meta.minerals };
      cost["calibration:" + meta.calib] = meta.calibQty;
      defs[id] = {
        id, name: series.label + "改装件 " + meta.roman,
        slot: "rig", level: meta.level, time: meta.time, xp: meta.xp,
        stackGroup: series.stackGroup, rigCategory: series.rigCategory, rigTier: meta.roman,
        cost, bonuses: { [series.bonusKey]: series.values[t] }
      };
    }
  }
  return defs;
}
const EQUIPMENT_DB = new Function("var ARCHAEOLOGY_SHIP_TYPES=[]; return " + dbText + ";")();
// 合并动态生成的 rig 定义（Object.assign(EQUIPMENT_DB, buildRigDefinitions())）
Object.assign(EQUIPMENT_DB, buildRigDefinitions());

// 采集等级映射（来自 base.js / systems/production.js / planets.js，精确键名）
const COLLECT_LEVEL = {
  "三钛合金": 1, "类银超金属": 10, "类晶体胶矿": 20, "同位聚合体": 40,
  "超新星诺克石": 55, "基腹断岩": 70, "超噬矿": 85,
  "镓": 20, "铂": 20, "铪": 40, "锇": 40, "钷": 55, "铷": 70,
  "粗制富勒烯": 1, "氦同位素": 10, "稳定富勒烯": 20, "氢同位素": 40,
  "高纯富勒烯": 55, "聚合气体": 70, "超纯聚合气体": 85,
  "重金属": 1, "稀有气体": 1, "同位素": 20, "等离子体": 40,
  "生物质": 60, "磁场聚合物": 80
};

// 非采集料（掉落/考古/蓝图许可/校准材料，不计入约束）
const NON_COLLECT = /许可|加密数据|密钥|校准|残液|莫尔石|calibration/;

const DESTROYER_MAX_LEVEL = 15; // 护卫舰(1)/驱逐舰(15) 及以下
const RELAXED_GAP = 20;
const STRICT_GAP = 10;

const violations = [];
const unmapped = new Set();

for (const id of Object.keys(EQUIPMENT_DB)) {
  const eq = EQUIPMENT_DB[id];
  if (!eq || !eq.cost) continue;
  const L = eq.level;
  const relaxed = L <= DESTROYER_MAX_LEVEL;
  const allowedGap = relaxed ? RELAXED_GAP : STRICT_GAP;
  for (const mat of Object.keys(eq.cost)) {
    if (NON_COLLECT.test(mat)) continue; // 掉落/许可，排除
    const mLevel = COLLECT_LEVEL[mat];
    if (mLevel === undefined) { unmapped.add(mat); continue; }
    if (mLevel > L + allowedGap) {
      violations.push({
        id, name: eq.name, L, mat, mLevel,
        gap: mLevel - L,
        rule: relaxed ? "relaxed(+20)" : "strict(+10)",
        stillViolates: true,
        newGap: mLevel - L
      });
    } else {
      // 原本在严格规则下可能违规、现被宽松规则豁免
      if (mLevel > L + STRICT_GAP) {
        violations.push({
          id, name: eq.name, L, mat, mLevel,
          gap: mLevel - L,
          rule: relaxed ? "relaxed(+20)-RELIEVED" : "strict(+10)",
          stillViolates: false,
          newGap: mLevel - L
        });
      }
    }
  }
}

// 输出
console.log("===== 驱逐舰及以下(equipment.level<=15) 放宽到 +20，其余 +10 =====\n");

const stillViolating = violations.filter(v => v.stillViolates);
const relieved = violations.filter(v => !v.stillViolates);

console.log("【仍违规（" + stillViolating.length + " 处）】");
// 按材料分组
const byMat = {};
for (const v of stillViolating) (byMat[v.mat] = byMat[v.mat] || []).push(v);
for (const mat of Object.keys(byMat).sort((a,b)=>COLLECT_LEVEL[b]-COLLECT_LEVEL[a])) {
  const list = byMat[mat];
  const ml = COLLECT_LEVEL[mat];
  console.log(`\n${mat}(Lv${ml}) 跨 ${list.length} 件装备:`);
  for (const v of list.sort((a,b)=>a.L-b.L)) {
    console.log(`  - ${v.id} (${v.name}) Lv${v.L} gap=${v.gap} [${v.rule}]`);
  }
}

console.log("\n【被放宽豁免（原严格规则下违规，现合规，" + relieved.length + " 处）】");
for (const v of relieved.sort((a,b)=>a.L-b.L)) {
  console.log(`  - ${v.id} (${v.name}) Lv${v.L} | ${v.mat}(Lv${v.mLevel}) gap=${v.gap} [relaxed +20 豁免]`);
}

console.log("\n【未映射到采集等级的料（需人工确认是否计入）】");
console.log([...unmapped].join(", ") || "(无)");

console.log("\n【统计】仍违规 " + stillViolating.length + " 处 / 豁免 " + relieved.length + " 处");
