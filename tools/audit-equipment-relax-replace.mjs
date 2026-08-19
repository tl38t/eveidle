// 装备采集等级审计（RC11）：违规材料 → 同族低一档材料，数量 ×1.2 向上取整
// 干跑：仅内存变换并重算审计，不写回 equipment.js
import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "js", "data", "equipment.js");
const src = fs.readFileSync(FILE, "utf8");

const start = src.indexOf("const EQUIPMENT_DB");
const objStart = src.indexOf("{", start);
let depth = 0, i = objStart, end = -1;
for (; i < src.length; i++) {
  const c = src[i];
  if (c === "{") depth++;
  else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
}
const dbText = src.slice(objStart, end + 1);
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
Object.assign(EQUIPMENT_DB, buildRigDefinitions());

// 采集等级 + 同族阶梯（按等级升序）
const COLLECT_LEVEL = {
  "三钛合金": 1, "类银超金属": 10, "类晶体胶矿": 20, "同位聚合体": 40,
  "超新星诺克石": 55, "基腹断岩": 70, "超噬矿": 85,
  "镓": 20, "铂": 20, "铪": 40, "锇": 40, "钷": 55, "铷": 70,
  "粗制富勒烯": 1, "氦同位素": 10, "稳定富勒烯": 20, "氢同位素": 40,
  "高纯富勒烯": 55, "聚合气体": 70, "超纯聚合气体": 85,
  "重金属": 1, "稀有气体": 1, "同位素": 20, "等离子体": 40,
  "生物质": 60, "磁场聚合物": 80
};
// 同族阶梯：每种材料 -> 同族中"等级严格更低"的下一个
const FAMILY_LADDER = {
  mineral: ["三钛合金", "类银超金属", "类晶体胶矿", "同位聚合体", "超新星诺克石", "基腹断岩", "超噬矿"],
  moon: ["镓", "铂", "铪", "锇", "钷", "铷"],
  gas: ["粗制富勒烯", "氦同位素", "稳定富勒烯", "氢同位素", "高纯富勒烯", "聚合气体", "超纯聚合气体"],
  planet: ["重金属", "稀有气体", "同位素", "等离子体", "生物质", "磁场聚合物"]
};
const MAT_FAMILY = {};
for (const fam of Object.keys(FAMILY_LADDER))
  for (const m of FAMILY_LADDER[fam]) MAT_FAMILY[m] = fam;

function lowerTierMaterial(mat) {
  const fam = MAT_FAMILY[mat];
  const ladder = FAMILY_LADDER[fam];
  const idx = ladder.indexOf(mat);
  if (idx <= 0) return null; // 已是最低档，无更低
  return ladder[idx - 1];
}

const NON_COLLECT = /许可|加密数据|密钥|校准|残液|莫尔石|calibration/;
const DESTROYER_MAX_LEVEL = 15;
const RELAXED_GAP = 20, STRICT_GAP = 10;

function findViolations(db) {
  const v = [];
  for (const id of Object.keys(db)) {
    const eq = db[id];
    if (!eq || !eq.cost) continue;
    const L = eq.level;
    const allowedGap = (L <= DESTROYER_MAX_LEVEL) ? RELAXED_GAP : STRICT_GAP;
    for (const mat of Object.keys(eq.cost)) {
      if (NON_COLLECT.test(mat)) continue;
      const mLevel = COLLECT_LEVEL[mat];
      if (mLevel === undefined) continue;
      if (mLevel > L + allowedGap) v.push({ id, L, mat, mLevel, qty: eq.cost[mat] });
    }
  }
  return v;
}

// ---------- 1) 原始审计 ----------
const origViolations = findViolations(EQUIPMENT_DB);

// ---------- 2) 应用替换（内存克隆） ----------
const CLONED = JSON.parse(JSON.stringify(EQUIPMENT_DB));
const replacements = []; // {id, L, oldMat, oldQty, newMat, newQty, ceilRaw, toTen}
const mergeLog = [];
for (const v of origViolations) {
  const newMat = lowerTierMaterial(v.mat);
  if (!newMat) { replacements.push({ ...v, newMat: "（无更低档）", newQty: v.qty }); continue; }
  const newQtyFloat = v.qty * 1.2;
  const ceilRaw = Math.ceil(newQtyFloat);          // 向上取整（×1.2）
  const toTen = Math.ceil(ceilRaw / 10) * 10;       // 向上凑到十位
  const toFive = Math.ceil(newQtyFloat / 5) * 5;    // 向上凑到 0 或 5（最近的 5 的倍数）
  const applied = toFive; // 最终实装口径：向上凑零和五
  // 合并到克隆库
  const eq = CLONED[v.id];
  delete eq.cost[v.mat];
  if (eq.cost[newMat] !== undefined) {
    mergeLog.push({ id: v.id, newMat, existing: eq.cost[newMat], added: applied });
    eq.cost[newMat] = eq.cost[newMat] + applied;
  } else {
    eq.cost[newMat] = applied;
  }
  replacements.push({ ...v, newMat, oldQty: v.qty, newQty: applied, ceilRaw, toTen });
}

// ---------- 3) 重算审计 ----------
const afterViolations = findViolations(CLONED);

// ---------- 输出 ----------
console.log("===== 替换方案：违规材料 → 同族低一档，数量 ×1.2 向上取整 =====\n");
console.log(`原始违规：${origViolations.length} 处  →  替换后违规：${afterViolations.length} 处\n`);

console.log("【逐件替换明细】");
const byId = {};
for (const r of replacements) (byId[r.id] = byId[r.id] || []).push(r);
for (const id of Object.keys(byId).sort((a,b)=>{
  const la = byId[a][0].L, lb = byId[b][0].L; return la - lb || a.localeCompare(b);
})) {
  const rows = byId[id];
  const eq = EQUIPMENT_DB[id];
  console.log(`\n${id} (${eq.name}) Lv${rows[0].L}`);
  for (const r of rows) {
    console.log(`   ${r.mat}(Lv${r.mLevel}) ×${r.oldQty}  →  ${r.newMat}(Lv${COLLECT_LEVEL[r.newMat] ?? "?"}) ×${r.newQty}` +
      `   [×1.2=${r.ceilRaw} → 向上凑0/5终值=${r.newQty}]  gap ${r.mLevel - r.L} → ${ (COLLECT_LEVEL[r.newMat] ?? 0) - r.L}`);
  }
}

if (mergeLog.length) {
  console.log("\n【同件内合并提示（新料已存在，已累加）】");
  for (const m of mergeLog) console.log(`   ${m.id} ${m.newMat}: ${m.existing} + ${m.added} = ${EQUIPMENT_DB[m.id].cost[m.newMat] !== undefined ? "(见克隆)" : ""}`);
}

console.log("\n【替换后仍违规（应为 0）】");
if (afterViolations.length === 0) console.log("   （无）✅ 全部合规");
else for (const v of afterViolations) console.log(`   - ${v.id} ${v.mat}(Lv${v.mLevel}) Lv${v.L} qty=${v.qty}`);
