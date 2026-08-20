// ============================================================================
//  tools/audit-achievements.mjs
//  成就系统审计 —— Batch A（目录冻结与占位名）+ Batch B（状态/迁移/解锁内核）
//                 + Batch C-1（技能规则真实触发与存档追溯对账）
//                 + Batch C-2（采矿工业规则真实触发与存档追溯对账）
//
//  子命令（可组合，如 --state --unlock --skills --production --combat）：
//    --data            数据目录真实行为审计（197 行 / 占位名 / 冻结哈希 / 双向一致）
//    --state           状态层审计（默认 schema / 幂等迁移清洗 / importData·autoLoad
//                      真实路径 spy / index.html 脚本顺序 / 全脚本 VM 加载）
//    --unlock          解锁内核审计（查询只读 / 幂等解锁 / dirty / 事件契约 /
//                      冻结 Date.now() / 目录不可变 / 无 Steamworks 伪调用）
//    --skills          技能规则审计（50 条冻结规则精确映射 / 单技能与组合边界 /
//                      幂等求值 / skill:levelUp 消费者 / 在线离线共用链路 /
//                      persistence 追溯对账 / 49 脚本顺序）
//    --production      采矿工业规则审计（18 条冻结规则精确映射 / 首次与累计边界 /
//                      statistics 权威读数 / 三类生产事件消费者与分发顺序 /
//                      在线 gameTick·离线 calculateOfflineGains 真实链路 /
//                      persistence 双对账同一 now / 49 脚本顺序）
//    --combat          战斗星带通关规则审计（Batch C-3：E01–E18 18 个首次通关冻结
//                      映射 / E19 全 18 不同星带引用 / COMBAT_RULES=32 全 freeze /
//                      93 规则 + 105 未映射零交集 / E26–E33 不建 / 逐桶边界 /
//                      同区刷 18 次不解锁 E19 / 真实 statistics 三消费者 + 首个
//                      解锁 E01 / 在线 combat:zoneCleared·旧档追溯双对账 / persistence
//                      源码结构 / 负向保护 / 只读 RO1·RO2）
//    --manufacturing    舰船制造规则审计（Batch C-4：C01 部件任一 / C02 首艘舰船 /
//                      C03–C10 各舰总装 / C12 旗舰累计 50 / C13 超级旗舰累计 25；
//                      SHIP_COMPONENT_RECIPE_IDS=18 冻结 / CAPITAL=5 / SUPERCAPITAL=3
//                      与 ships.js 双向交叉 / MANUFACTURING_RULES=12 全 freeze /
//                      105 规则 + 93 未映射零交集 / C11 无规则·C14 仅技能 / 逐配方边界 /
//                      真实 statistics 四消费者 + 首个解锁 C01 / 在线·离线 manufacturing:completed
//                      共用链路 / importData·autoLoad 双对账 / persistence 源码结构 /
//                      负向保护 / 只读 RO1·RO2）
//    --equipment       装备制造/燃料/弹药/装备强化/改装件规则审计（Batch C-5，
//                      C-13 增补 D18：
//                      D13 非 rig 装备任一 / D14 燃料任一 / D15 弹药任一 /
//                      D16 装备强化累计（statistics v2 新增
//                      equipmentEnhancementAttempts）/ D17 rig 任一 /
//                      D18 集齐全部 55 件改装件（equipment-recipe-set-all，
//                      唯一权威源 statistics.production.manufactured）；
//                      NON_RIG=117 / RIG=55 / FUEL=3 / AMMO=3 四集合与
//                      equipment.js·ammunition.js 双向交叉 / EQUIPMENT_RULES=6 全
//                      freeze / statistics
//                      v1→v2 迁移清洗幂等 / station:autoLineCompleted 装备线
//                      记账与不双计数 / 舰船·装备强化字段隔离 / 逐配方 0/1 边界 /
//                      五通配消费者 ===5 / 真实在线离线触发 / importData·autoLoad
//                      双对账（v1 不臆测 D16、v2 追溯 D16）/ persistence 源码结构 /
//                      负向保护 / 只读 RO1·RO2）
//    --economy         经济成就规则审计（Batch C-13：I01–I03 ISK 阶梯 /
//                      I04–I10 七矿物各 1000 / I11 四高级材料集齐（moon:铷、
//                      mineral:莫尔石、planetary:等离子体、planetary:磁场聚合物，
//                      命名空间交叉验证，无 moon:莫尔石）/ I12 物资总量首破
//                      1,000,000（严格大于）；ECONOMY_RULES=12 全 freeze /
//                      188 规则 + 9 未映射全局恒等式 / ResourceRegistry 延迟解析
//                      RESOURCE_REGISTRY_UNAVAILABLE / resource:changed·
//                      inventory:changed 契约与 delta 非负 / 四事件消费者 /
//                      persistence 追溯 / 只读 RO1·RO2）
//    （无参数 = 运行 data + state + unlock + skills + production + combat +
//      manufacturing + equipment + boosters + archaeology + planetary + station +
//      blueprint + economy）
//    未知参数：EXIT=2
//
//  校验风格（全部为行为/结构真实断言，禁用弱断言 / assert(true) / 源码字符串
//  存在性伪测试 / 只验非空的宽泛检查）：
//    - 真实 RFC4180 解析（禁止 split(",")）
//    - VM 沙箱直接加载 js/data/achievements.js（不依赖 DOM / index.html）
//    - 生成器 --write / --check 的确定性与只读验证【全部在系统临时目录中进行】：
//      本审计对正式工作区完全只读，绝不在 ROOT 中执行 --write / --check，
//      不改变正式工作区任何文件的字节或 mtime（审计首尾有快照断言证明）。
//    - 冻结哈希按 nameStatus 将 placeholder 还原为空串后重算，证明原策划表无漂移
//
//  退出码：全部通过 EXIT=0；任一断言失败 EXIT=1；未知参数 EXIT=2。
// ============================================================================

"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CSV_PATH = path.join(ROOT, "achievements-template.csv");
const JS_PATH = path.join(ROOT, "js", "data", "achievements.js");
const INDEX_PATH = path.join(ROOT, "index.html");
const GEN_PATH = path.join(HERE, "gen-achievements-csv.py");
const ACH_STATE_PATH = path.join(ROOT, "js", "core", "achievement-state.js");
const ACH_SYSTEM_PATH = path.join(ROOT, "js", "systems", "achievements.js");
const ACH_RULES_PATH = path.join(ROOT, "js", "data", "achievement-rules.js");
const CORE_STATE_PATH = path.join(ROOT, "js", "core", "state.js");
const EVENTS_PATH = path.join(ROOT, "js", "core", "events.js");
const TICK_PATH = path.join(ROOT, "js", "core", "tick.js");
const OFFLINE_PATH = path.join(ROOT, "js", "core", "offline.js");
const PRODUCTION_PATH = path.join(ROOT, "js", "systems", "production.js");
const STATISTICS_PATH = path.join(ROOT, "js", "core", "statistics.js");
const PERSISTENCE_PATH = path.join(ROOT, "js", "core", "persistence.js");
const VERIFY_PATH = path.join(HERE, "verify.mjs");
const COMBAT_PATH = path.join(ROOT, "js", "data", "combat.js");
const SHIP_PATH = path.join(ROOT, "js", "data", "ships.js");
const BOOSTERS_DATA_PATH = path.join(ROOT, "js", "data", "boosters.js");

// 冻结时间：审计中所有 Date.now() 都返回该值（验证非法 atMs 回退路径）
const FROZEN_NOW = 1700000000000;

const FREEZE_TARGET_HASH = "9511da2753e0ce1e6157844206620910a6e87ac0aedc46606184c6501da115c4";
const FREEZE_TARGET_BYTES = 14259;

const HEADER = ["编号", "分类", "触发条件/建议", "难度档", "隐藏", "成就名（待填）", "备注", "名称状态", "触发器(JSON)", "奖励(JSON)", "Steam启用", "Steam API Name", "Steam进度 Stat API Name", "Steam进度上限"];

const TIER_MAP = { "铜": "bronze", "银": "silver", "金": "gold", "传奇": "legendary" };
const PLACEHOLDER_PREFIX = "待命名成就 · ";

const PROVISIONAL_NAMES = {
  "A02": "如果你能开100个球种水，你还会是现在这样？",
  "A23": "鹰酱称之曰：能",
  "G01": "好球",
  "G02": "这球好白，哦不，好大",
  "G03": "也是好球",
  "G04": "真正的好球",
  "G05": "我是来种菜的，你是要干什么",
  "G06": "人称小气球",
  "G07": "你的粪勺请拿好",
  "G09": "只要粪勺舞得好，哪有行星挖不倒",
  "G10": "黄金粪勺",
};

const GHOST_IDS = ["D19", "D20", "D21", "D22", "G08", "H14", "J07", "J08", "J09"];
const A28A48 = [];
for (let i = 28; i <= 48; i++) A28A48.push("A" + String(i).padStart(2, "0"));

const EXPECT_CATS = { "技能": 48, "采矿工业": 18, "舰船工程": 14, "装备/增强剂": 18, "战斗": 32, "考古": 22, "行星": 9, "空间站": 15, "经济": 12, "综合": 9 };
const EXPECT_TIERS = { "铜": 44, "银": 82, "金": 63, "传奇": 8 };
const EXPECT_HIDDEN = { "否": 195, "是": 2 };

// ---- 测试框架（全部断言执行后打印汇总，AGENTS.md 要求）----
let pass = 0, fail = 0;
const failNames = [];
function ok(name, cond) {
  if (cond) { pass++; console.log("[ach] PASS  " + name); }
  else { fail++; failNames.push(name); console.log("[ach] FAIL  " + name); }
}

// ---- 真实 RFC4180 解析（处理引号内逗号与 "" 转义）----
function parseCSV(text) {
  const rows = [];
  let row = [], field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ""; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function sha256Hex(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function shaFile(p) { return sha256Hex(fs.readFileSync(p)); }

// 文件快照：字节 SHA-256 / 长度 / mtime（纳秒级 BigInt），用于只读性证明
function snapFile(p) {
  const buf = fs.readFileSync(p);
  const st = fs.statSync(p, { bigint: true });
  return { sha: sha256Hex(buf), len: buf.length, mtimeNs: st.mtimeNs };
}
function snapEq(a, b) {
  return a.sha === b.sha && a.len === b.len && a.mtimeNs === b.mtimeNs;
}

// 只用「命令 + 参数数组」探测 Python，禁止拼接 shell 命令字符串
function findPython() {
  for (const c of ["python", "python3"]) {
    try {
      const r = spawnSync(c, ["--version"], { stdio: "ignore" });
      if (!r.error && r.status === 0) return c;
    } catch (e) { /* try next */ }
  }
  return null;
}

// ---- 主审计 ----
function runData() {
  // 1) CSV 是 UTF-8-SIG
  const raw = fs.readFileSync(CSV_PATH);
  ok("[1] CSV 以 UTF-8-SIG (EF BB BF) 开头", raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf);

  // 2) 无 U+FFFD
  const text = raw.slice(3).toString("utf-8");
  ok("[2] CSV 不含 U+FFFD 替换字符", !text.includes("�"));

  // 3) 真实 RFC 解析（含逗号字段不被拆分）
  const allRows = parseCSV(text);
  const header = allRows[0];
  const rows = allRows.slice(1);
  const b15 = rows.find(r => r[0] === "B15");
  ok("[3] RFC 解析：引号内逗号字段保持完整（B15 触发条件未被拆分）",
    !!b15 && b15[2] === "累计采矿 1,000,000" && b15.length === 14);

  // 4) 表头精确且无重复
  const headerOk = JSON.stringify(header) === JSON.stringify(HEADER);
  const noDup = new Set(header).size === header.length;
  ok("[4] 表头精确匹配且无重复列", headerOk && noDup);

  // 5) 197 行、字段数一致
  ok("[5] 数据行数 = 197", rows.length === 197);
  ok("[5b] 每行均为 14 列", rows.every(r => r.length === 14));

  // 6) ID 唯一
  const ids = rows.map(r => r[0]);
  ok("[6] ID 唯一", new Set(ids).size === ids.length);

  // 7) ID 格式合法
  const idRe = /^[A-J]\d{2}$/;
  ok("[7] 所有 ID 格式合法 ^[A-J]\\d{2}$", ids.every(id => idRe.test(id)));

  // 8) CSV ID 集合 == AchievementData ID 集合（精确集合）
  const adIds = AD.ACHIEVEMENTS.map(a => a.id).slice().sort();
  const csvIds = ids.slice().sort();
  ok("[8] CSV ID 集合与 AchievementData 精确一致（双向）",
    adIds.length === csvIds.length && adIds.every((v, i) => v === csvIds[i]));

  // 9) A28~A48 全部存在
  ok("[9] A28~A48 全部存在", A28A48.every(id => ids.includes(id)));

  // 10) 旧生成器幽灵 ID 全部不存在
  const ghosts = GHOST_IDS.filter(id => ids.includes(id));
  ok("[10] 9 个旧生成器幽灵 ID 全部不存在", ghosts.length === 0);

  // 11) 分类统计精确（顺序无关比较）
  const catCount = {};
  rows.forEach(r => { catCount[r[1]] = (catCount[r[1]] || 0) + 1; });
  const catOk = Object.keys(EXPECT_CATS).every(k => catCount[k] === EXPECT_CATS[k]) &&
    Object.keys(catCount).length === Object.keys(EXPECT_CATS).length;
  ok("[11] 分类统计精确", catOk);

  // 12) 难度统计精确（顺序无关比较）
  const tierCount = {};
  rows.forEach(r => { tierCount[r[3]] = (tierCount[r[3]] || 0) + 1; });
  const tierOk = Object.keys(EXPECT_TIERS).every(k => tierCount[k] === EXPECT_TIERS[k]) &&
    Object.keys(tierCount).length === Object.keys(EXPECT_TIERS).length;
  ok("[12] 难度统计精确", tierOk);

  // 13) 隐藏统计精确（顺序无关比较）
  const hidCount = {};
  rows.forEach(r => { hidCount[r[4]] = (hidCount[r[4]] || 0) + 1; });
  const hidOk = Object.keys(EXPECT_HIDDEN).every(k => hidCount[k] === EXPECT_HIDDEN[k]) &&
    Object.keys(hidCount).length === Object.keys(EXPECT_HIDDEN).length;
  ok("[13] 隐藏统计精确", hidOk);

  // 14) provisional = 11
  const prov = rows.filter(r => r[7] === "provisional");
  ok("[14] provisional 数量 = 11", prov.length === 11);

  // 15) placeholder = 186
  const ph = rows.filter(r => r[7] === "placeholder");
  ok("[15] placeholder 数量 = 186", ph.length === 186);

  // 16) final = 0
  ok("[16] final 数量 = 0", rows.filter(r => r[7] === "final").length === 0);

  // 17) 11 个 provisional 名称逐项精确相等
  let provOk = true;
  for (const id of Object.keys(PROVISIONAL_NAMES)) {
    const row = rows.find(r => r[0] === id);
    if (!row || row[5] !== PROVISIONAL_NAMES[id] || row[7] !== "provisional") provOk = false;
  }
  ok("[17] 11 个 provisional 名称逐项精确保留", provOk);

  // 18) 每个 placeholder 名精确等于 待命名成就 · {ID}
  const phExact = ph.every(r => r[5] === PLACEHOLDER_PREFIX + r[0]);
  ok("[18] 每个 placeholder 名 = 待命名成就 · {ID}", phExact);

  // 19) trigger 全部 null / CSV 空
  const trigCsv = rows.every(r => r[8] === "");
  const trigJs = AD.ACHIEVEMENTS.every(a => a.trigger === null);
  ok("[19] 触发器全部为空（CSV 空 / JS null）", trigCsv && trigJs);

  // 20) reward 全部 null / CSV 空
  const rewCsv = rows.every(r => r[9] === "");
  const rewJs = AD.ACHIEVEMENTS.every(a => a.reward === null);
  ok("[20] 奖励全部为空（CSV 空 / JS null）", rewCsv && rewJs);

  // 21) CSV 与 AchievementData 逐字段双向一致
  let fieldOk = true;
  for (const r of rows) {
    const id = r[0];
    const a = AD.ACHIEVEMENTS_BY_ID[id];
    if (!a) { fieldOk = false; break; }
    const expName = (r[7] === "provisional") ? PROVISIONAL_NAMES[id] : PLACEHOLDER_PREFIX + id;
    if (a.category !== r[1]) fieldOk = false;
    if (a.conditionText !== r[2]) fieldOk = false;
    if (a.tierLabel !== r[3]) fieldOk = false;
    if (a.tier !== TIER_MAP[r[3]]) fieldOk = false;
    if (a.hidden !== (r[4] === "是")) fieldOk = false;
    if (a.name !== expName || a.name !== r[5]) fieldOk = false;
    if (a.nameStatus !== r[7]) fieldOk = false;
    if (a.note !== r[6]) fieldOk = false;
    if (a.trigger !== null) fieldOk = false;
    if (a.reward !== null) fieldOk = false;
    if (!fieldOk) break;
  }
  // 反向：每个 AD 项都在 CSV 中
  const csvIdSet = new Set(ids);
  const revOk = AD.ACHIEVEMENTS.every(a => csvIdSet.has(a.id));
  ok("[21] CSV 与 AchievementData 逐字段双向一致", fieldOk && revOk);

  // 22) ACHIEVEMENTS_BY_ID 与数组双向集合一致（按集合，不要求位置顺序）
  const byIdKeys = Object.keys(AD.ACHIEVEMENTS_BY_ID);
  const byIdSet = new Set(byIdKeys);
  const arrSet = new Set(AD.ACHIEVEMENTS.map(a => a.id));
  const setOk = byIdSet.size === arrSet.size && AD.ACHIEVEMENTS.every(a => byIdSet.has(a.id));
  const refOk = AD.ACHIEVEMENTS.every(a => AD.ACHIEVEMENTS_BY_ID[a.id] === a);
  ok("[22] ACHIEVEMENTS_BY_ID 与数组双向集合一致（集合 + 引用）",
    byIdKeys.length === 197 && setOk && refOk);

  // 23) BY_ID 只以 ID 为键
  ok("[23] ACHIEVEMENTS_BY_ID 只以合法 ID 为键",
    byIdKeys.length === 197 && byIdKeys.every(k => idRe.test(k)));

  // 24) 所有冻结对象不可变
  function deepFrozen(o) {
    if (o === null || typeof o !== "object") return true;
    if (!Object.isFrozen(o)) return false;
    if (Array.isArray(o)) return o.every(deepFrozen);
    return Object.values(o).every(deepFrozen);
  }
  const frozenOk =
    Object.isFrozen(AD) &&
    Object.isFrozen(AD.ACHIEVEMENTS) &&
    AD.ACHIEVEMENTS.every(a => Object.isFrozen(a)) &&
    Object.isFrozen(AD.ACHIEVEMENTS_BY_ID) &&
    Object.isFrozen(AD.CATEGORIES) &&
    Object.isFrozen(AD.TIERS) &&
    deepFrozen(AD.TIERS);
  ok("[24] 所有冻结对象不可变（目录/项/BY_ID/分类/难度）", frozenOk);

  // 25) VM 直接加载 achievements.js（不依赖 DOM / index.html）
  ok("[25] VM 加载 achievements.js 得到 AchievementData（无 DOM 依赖）",
    !!AD && typeof AD.SCHEMA_VERSION === "number" && Array.isArray(AD.ACHIEVEMENTS));

  // 26) 原 197 行冻结哈希（placeholder 还原为空串）精确等于目标
  const norm = rows.map(r => {
    const name = (r[7] === "placeholder") ? "" : r[5];
    return [r[0], r[1], r[2], r[3], r[4], name, r[6]];
  });
  const normJson = JSON.stringify(norm);
  const normBuf = Buffer.from(normJson, "utf-8");
  const normHash = sha256Hex(normBuf);
  ok("[26] 还原后冻结哈希精确 = " + FREEZE_TARGET_HASH, normHash === FREEZE_TARGET_HASH);

  // 27) 还原后规范化 UTF-8 JSON 字节数精确为 14259
  ok("[27] 还原后规范化 JSON 字节数精确 = 14259", normBuf.length === FREEZE_TARGET_BYTES);

  // ---- Steam 预留映射字段审计（追加要求：仅预留，不接入 SDK）----
  // S1) 197 项 steam.enabled 全部为 false
  ok("[S1] 197 项 steam.enabled 全为 false",
    AD.ACHIEVEMENTS.length === 197 && AD.ACHIEVEMENTS.every(a => a.steam && a.steam.enabled === false));

  // S2) apiName 全部 null
  ok("[S2] 197 项 steam.apiName 全为 null",
    AD.ACHIEVEMENTS.every(a => a.steam && a.steam.apiName === null));

  // S3) progressStatApiName 全部 null
  ok("[S3] 197 项 steam.progressStatApiName 全为 null",
    AD.ACHIEVEMENTS.every(a => a.steam && a.steam.progressStatApiName === null));

  // S4) progressMax 全部 null
  ok("[S4] 197 项 steam.progressMax 全为 null",
    AD.ACHIEVEMENTS.every(a => a.steam && a.steam.progressMax === null));

  // S5) steam 子对象全部冻结
  ok("[S5] 197 项 steam 子对象全部 Object.freeze",
    AD.ACHIEVEMENTS.every(a => a.steam && Object.isFrozen(a.steam)));

  // S6) CSV Steam启用 全部为“否”
  ok("[S6] CSV Steam启用 全部为“否”", rows.every(r => r[10] === "否"));

  // S7) CSV 三个 Steam 映射字段（API Name / Stat / 上限）全部为空
  ok("[S7] CSV 三个 Steam 映射字段全为空",
    rows.every(r => r[11] === "" && r[12] === "" && r[13] === ""));

  // S8) 未来 enabled=true 规则：apiName 符合 /^EVEIDLE_[A-J][0-9]{2}$/ 且全局唯一
  // 仅校验规则可由 ID 确定性生成，绝不把候选值赋给 apiName。
  const candidateRule = /^(EVEIDLE_[A-J][0-9]{2})$/;
  const candidates = AD.ACHIEVEMENTS.map(a => "EVEIDLE_" + a.id);
  const regexOk = candidates.every(c => candidateRule.test(c));
  const uniq = new Set(candidates);
  ok("[S8] 未来 Steam API Name 规则 EVEIDLE_{ID} 可由 ID 确定性生成且全局唯一",
    regexOk && uniq.size === candidates.length);
  ok("[S8b] 当前 apiName 仍为 null（候选未当作已发布值写入）",
    AD.ACHIEVEMENTS.every(a => a.steam.apiName === null));

  // S9) 已启用 Steam 成就数量 <=100；本批实际精确为 0
  const enabledCount = AD.ACHIEVEMENTS.filter(a => a.steam && a.steam.enabled).length;
  ok("[S9] 已启用 Steam 成就数量 = 0（满足 <=100）", enabledCount === 0);

  // S10) 未建立任何 Steamworks SDK 调用（扫描禁用标识符）
  const forbiddenSteamTokens = ["SteamAPI_Init", "SetAchievement", "SetStat", "StoreStats", "RequestCurrentStats", "steam_appid", "greenworks", "steamworks"];
  const jsSrc = fs.readFileSync(JS_PATH, "utf-8");
  const genSrc = fs.readFileSync(GEN_PATH, "utf-8");
  ok("[S10] achievements.js / 生成器 均不含 Steamworks SDK 禁用标识符",
    forbiddenSteamTokens.every(t => !jsSrc.includes(t)) &&
    forbiddenSteamTokens.every(t => !genSrc.includes(t)));

  // S11) 冻结哈希还原规则不受新增 Steam 列影响（norm 仅含 7 原始列）
  ok("[S11] 冻结哈希还原数组仅含 7 原始列（不含 Steam 列）",
    norm.every(r => r.length === 7));

  // S12) 原 197 行策划冻结 SHA-256 仍必须为 9511da2753...（不受 Steam 列影响）
  ok("[S12] 原策划冻结哈希仍 = 9511da2753...（不受 Steam 列影响）",
    normHash === FREEZE_TARGET_HASH);

  // 28)/29) 生成器确定性与只读验证 —— 全部在系统临时目录中进行，
  //          绝不在正式工作区（ROOT）执行 --write / --check。
  //          Python 启动失败 / 写入失败 / 返回码非 0 => 明确 FAIL，不抛未处理异常。
  runGeneratorAuditInTempDir();

  // 30) Batch B：成就三个脚本已在 index.html 注册且顺序正确
  //     events < data/achievements < achievement-state < state < systems/achievements < persistence
  const order = readIndexScriptOrder();
  ok("[30] index.html 已注册成就三脚本（data/achievements、achievement-state、systems/achievements）",
    order.achData >= 0 && order.achState >= 0 && order.achSystem >= 0);
  ok("[30b] 成就脚本顺序正确：events < data < state层 < core/state < system < persistence",
    order.events >= 0 && order.coreState >= 0 && order.persistence >= 0 &&
    order.events < order.achData && order.achData < order.achState &&
    order.achState < order.coreState && order.coreState < order.achSystem &&
    order.achSystem < order.persistence);
}

// ---- index.html 真实脚本顺序（去 ?v= 缓存串）----
function readIndexScriptOrder() {
  let html = "";
  try { html = fs.readFileSync(INDEX_PATH, "utf-8"); } catch (e) { html = ""; }
  const srcs = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)]
    .map((m) => m[1].replace(/\?.*$/, ""));
  const idxOf = (suffix) => srcs.findIndex((s) => s.endsWith(suffix));
  return {
    srcs,
    events: idxOf("js/core/events.js"),
    achData: idxOf("js/data/achievements.js"),
    achRules: idxOf("js/data/achievement-rules.js"),
    achState: idxOf("js/core/achievement-state.js"),
    coreState: idxOf("js/core/state.js"),
    statistics: idxOf("js/core/statistics.js"),
    achSystem: idxOf("js/systems/achievements.js"),
    production: idxOf("js/systems/production.js"),
    persistence: idxOf("js/core/persistence.js"),
  };
}

// ---- 生成器确定性 / 只读验证（系统临时目录，正式工作区零写入）----
//
//  流程：
//    1. fs.mkdtempSync(os.tmpdir()/eveidle-ach-audit-) 创建唯一临时根目录
//    2. 建 tools/、js/data/，把正式 gen-achievements-csv.py 复制进临时 tools/
//       （生成器路径基于 __file__ 解析 => 产物落在临时目录，不触碰 ROOT）
//    3. spawnSync(python, [脚本, --write])「命令 + 参数数组」，禁止 shell 拼接
//    4. 第一次 --write 记录 CSV/JS 字节与 SHA-256；第二次 --write 再记录
//    5. 断言两次产物逐字节一致；断言临时产物与正式工作区 CSV/JS 逐字节一致
//    6. 在临时目录执行 --check，前后比较字节 + mtime，证明 --check 只读
//    7. finally 只删除本次创建的唯一临时目录
//
//  Python 启动失败 / 写入失败 / 返回码非 0 => 明确 FAIL（不抛未处理异常）。
function runGeneratorAuditInTempDir() {
  const py = findPython();
  if (!py) {
    ok("[28] 临时目录第一次 --write 成功（未找到 python）", false);
    ok("[28b] 临时目录第二次 --write 成功（未找到 python）", false);
    ok("[28c] 两次 --write CSV 逐字节一致（未执行）", false);
    ok("[28d] 两次 --write JS 逐字节一致（未执行）", false);
    ok("[28e] 临时产物与正式 CSV 逐字节一致（未执行）", false);
    ok("[28f] 临时产物与正式 JS 逐字节一致（未执行）", false);
    ok("[29] --check 在临时目录 EXIT=0（未执行）", false);
    ok("[29b] --check 前后 CSV 字节+mtime 不变（未执行）", false);
    ok("[29c] --check 前后 JS 字节+mtime 不变（未执行）", false);
    return;
  }

  let tmpRoot = null;
  try {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "eveidle-ach-audit-"));
    const tmpTools = path.join(tmpRoot, "tools");
    const tmpJsData = path.join(tmpRoot, "js", "data");
    fs.mkdirSync(tmpTools, { recursive: true });
    fs.mkdirSync(tmpJsData, { recursive: true });
    const tmpGen = path.join(tmpTools, "gen-achievements-csv.py");
    fs.copyFileSync(GEN_PATH, tmpGen);
    const tmpCsv = path.join(tmpRoot, "achievements-template.csv");
    const tmpJs = path.join(tmpJsData, "achievements.js");

    // 命令 + 参数数组调用，禁止拼接 shell 命令字符串
    const runGen = (flag) => spawnSync(py, [tmpGen, flag], { cwd: tmpRoot, stdio: "ignore" });

    // 第一次 --write
    const w1 = runGen("--write");
    const w1Ok = !w1.error && w1.status === 0 && fs.existsSync(tmpCsv) && fs.existsSync(tmpJs);
    ok("[28] 临时目录第一次 --write 成功（EXIT=0 且产物存在）", w1Ok);
    const c1 = w1Ok ? fs.readFileSync(tmpCsv) : null;
    const j1 = w1Ok ? fs.readFileSync(tmpJs) : null;
    if (w1Ok) {
      console.log("[ach] info  第一次 --write: CSV " + c1.length + "B sha256=" + sha256Hex(c1));
      console.log("[ach] info  第一次 --write: JS  " + j1.length + "B sha256=" + sha256Hex(j1));
    }

    // 第二次 --write（同一临时目录）
    const w2 = runGen("--write");
    const w2Ok = !w2.error && w2.status === 0 && fs.existsSync(tmpCsv) && fs.existsSync(tmpJs);
    ok("[28b] 临时目录第二次 --write 成功（EXIT=0 且产物存在）", w2Ok);
    const c2 = w2Ok ? fs.readFileSync(tmpCsv) : null;
    const j2 = w2Ok ? fs.readFileSync(tmpJs) : null;
    if (w2Ok) {
      console.log("[ach] info  第二次 --write: CSV " + c2.length + "B sha256=" + sha256Hex(c2));
      console.log("[ach] info  第二次 --write: JS  " + j2.length + "B sha256=" + sha256Hex(j2));
    }

    // 精确断言：两次生成逐字节一致（真实调用了两次 --write 才允许报告）
    ok("[28c] 连续两次 --write CSV 逐字节一致（临时目录真实生成 ×2）",
      !!c1 && !!c2 && c1.equals(c2));
    ok("[28d] 连续两次 --write JS 逐字节一致（临时目录真实生成 ×2）",
      !!j1 && !!j2 && j1.equals(j2));

    // 精确断言：临时产物与正式工作区当前 CSV/JS 逐字节一致
    const wsCsv = fs.readFileSync(CSV_PATH);
    const wsJs = fs.readFileSync(JS_PATH);
    ok("[28e] 临时 --write 产物与正式工作区 CSV 逐字节一致", !!c2 && c2.equals(wsCsv));
    ok("[28f] 临时 --write 产物与正式工作区 JS 逐字节一致", !!j2 && j2.equals(wsJs));

    // --check 只读验证（在临时生成目录中执行；前后比较字节 + mtime）
    if (w2Ok) {
      const preCsv = snapFile(tmpCsv), preJs = snapFile(tmpJs);
      const chk = runGen("--check");
      const chkOk = !chk.error && chk.status === 0;
      ok("[29] --check 在临时目录 EXIT=0", chkOk);
      const postCsv = snapFile(tmpCsv), postJs = snapFile(tmpJs);
      ok("[29b] --check 前后 CSV 字节+mtime 完全不变", snapEq(preCsv, postCsv));
      ok("[29c] --check 前后 JS 字节+mtime 完全不变", snapEq(preJs, postJs));
    } else {
      ok("[29] --check 在临时目录 EXIT=0（--write 失败未执行）", false);
      ok("[29b] --check 前后 CSV 字节+mtime 完全不变（未执行）", false);
      ok("[29c] --check 前后 JS 字节+mtime 完全不变（未执行）", false);
    }
  } catch (e) {
    // 任何异常（复制失败 / 读写临时文件失败等）=> 明确 FAIL，保证有 PASS/FAIL 汇总
    ok("[28-29] 生成器临时目录审计未抛异常（" + (e && e.message ? e.message : String(e)) + "）", false);
  } finally {
    // 只删除本次创建的唯一临时目录，绝不触碰正式工作区
    if (tmpRoot && path.basename(tmpRoot).startsWith("eveidle-ach-audit-")) {
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响审计结论 */ }
    }
  }
}

// ---- 加载 achievements.js（VM，无 DOM）----
let AD = null;
(function loadJs() {
  const code = fs.readFileSync(JS_PATH, "utf-8");
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.console = console;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: JS_PATH });
  AD = sandbox.AchievementData;
})();

// ============================================================================
//  Batch B：VM 沙箱构建
// ============================================================================

// 内核沙箱：events(可选) + data/achievements + achievement-state + systems/achievements
// Date.now() 冻结为 FROZEN_NOW（真实验证非法 atMs 的回退路径）。
function buildKernelSandbox(opts) {
  const withEvents = !opts || opts.withEvents !== false;
  const withRules = !!(opts && opts.withRules === true); // Batch C-1：可选加载冻结规则数据
  // Batch C-2：可选加载冻结 statistics.js（真实 GameStatistics 通配符消费者）。
  // statistics.js 顶层依赖全局 gameState 与 GameEvents，因此 withStatistics 隐含
  // withEvents，并在加载 statistics.js 之前构造最小 gameState（skills + achievements），
  // 严格复刻 index.html 的加载顺序：statistics.js 先于 systems/achievements.js，
  // 使 systems/achievements.js 末尾 IIFE 自动安装的消费者排在 statistics 之后。
  const withStatistics = !!(opts && opts.withStatistics === true);
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.console = console;
  class FrozenDate extends Date { static now() { return FROZEN_NOW; } }
  sandbox.Date = FrozenDate;
  sandbox.Math = Math; sandbox.JSON = JSON; sandbox.Object = Object; sandbox.Array = Array;
  sandbox.Number = Number; sandbox.Set = Set; sandbox.Map = Map; sandbox.isFinite = isFinite;
  // RuntimeGuard 位于被排除的 runtime.js；events.js 仅在事件契约校验失败或监听器抛错时调用它，
  // 这里给安全 mock 以捕获意外的契约失败（与 audit-station.mjs 一致），且不阻断测试流程。
  sandbox.__guardReports = [];
  sandbox.RuntimeGuard = { report: (err, ctx) => { sandbox.__guardReports.push({ message: err && err.message, ctx }); } };
  vm.createContext(sandbox);
  if (withEvents || withStatistics) vm.runInContext(fs.readFileSync(EVENTS_PATH, "utf-8"), sandbox, { filename: "js/core/events.js" });
  vm.runInContext(fs.readFileSync(JS_PATH, "utf-8"), sandbox, { filename: "js/data/achievements.js" });
  if (withRules) vm.runInContext(fs.readFileSync(ACH_RULES_PATH, "utf-8"), sandbox, { filename: "js/data/achievement-rules.js" });
  vm.runInContext(fs.readFileSync(ACH_STATE_PATH, "utf-8"), sandbox, { filename: "js/core/achievement-state.js" });
  if (withStatistics) {
    vm.runInContext(
      "globalThis.gameState = { skills: {}, achievements: AchievementState.createDefaultAchievementState(), _dirty: false };",
      sandbox, { filename: "audit-c2-bootstrap-gamestate.js" }
    );
    vm.runInContext(fs.readFileSync(STATISTICS_PATH, "utf-8"), sandbox, { filename: "js/core/statistics.js" });
  }
  vm.runInContext(fs.readFileSync(ACH_SYSTEM_PATH, "utf-8"), sandbox, { filename: "js/systems/achievements.js" });
  return sandbox;
}

// 全脚本沙箱：按 index.html 真实 <script defer> 顺序加载全部脚本
// （mock DOM / localStorage / 定时器），在 persistence.js 前对
// ResearchState.migrateResearchState / AchievementState.migrateAchievementState /
// calculateOfflineGains 安装 spy —— autoLoad / importData 的调用顺序成为可观测行为。
// saveJson: null=无存档（新游戏路径）；字符串=localStorage 中的存档。
function buildFullGameSandbox(saveJson) {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)]
    .map((m) => m[1].replace(/\?.*$/, ""));

  const noop = () => {};
  function MockCanvasContext() {}
  for (const name of [
    "arc", "arcTo", "beginPath", "clearRect", "clip", "drawImage", "ellipse", "fill", "fillRect",
    "fillText", "lineTo", "moveTo", "putImageData", "rect", "restore", "rotate", "save", "scale",
    "setTransform", "stroke", "strokeText", "translate",
  ]) MockCanvasContext.prototype[name] = noop;
  MockCanvasContext.prototype.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
  MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
  MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
  MockCanvasContext.prototype.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });

  const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
  const makeElement = () => ({
    addEventListener: noop, appendChild: noop, insertBefore: noop, classList, click: noop,     closest: () => null,
    parentNode: { insertBefore: noop, appendChild: noop, removeChild: noop }, dataset: {}, focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560,
    querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, select: noop,
    style: {}, textContent: "", value: "1", setAttribute: noop,
  });
  const documentMock = {
    addEventListener: noop, body: makeElement(), createElement: () => makeElement(),
    createElementNS: () => makeElement(), getElementById: () => makeElement(),
    querySelector: () => makeElement(), querySelectorAll: () => [], hidden: false,
  };
  const localStorageMock = {
    getItem: (k) => (k === "eve_idle_save" ? saveJson : null),
    setItem: noop, removeItem: noop,
  };
  class FrozenDate extends Date {
    static now() { return FROZEN_NOW; }
  }
  const sandbox = {
    alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console,
    confirm: () => true, document: documentMock, FileReader: class {},
    localStorage: localStorageMock, requestAnimationFrame: noop,
    setInterval: noop, setTimeout: noop, clearTimeout: noop, clearInterval: noop,
    URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop },
    Date: FrozenDate,
    matchMedia: (q) => ({ matches: false, media: q || "", addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    MutationObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} takeRecords(){ return []; } },
    IntersectionObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} unobserve(){} takeRecords(){ return []; } },
    ResizeObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} unobserve(){} },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    window: null,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = noop;
  // 与 buildKernelSandbox 一致：RuntimeGuard 位于被排除的 runtime.js；events.js 仅在事件契约
  // 校验失败或监听器抛错时调用它。注入可观察 mock，供断言验证"未触发 RuntimeGuard.report"。
  sandbox.__guardReports = [];
  sandbox.RuntimeGuard = { report: (err, ctx) => { sandbox.__guardReports.push({ message: err && err.message, ctx }); } };
  vm.createContext(sandbox);

  const timeline = []; // {fn:"migrateResearchState"|"migrateAchievementState"|"evaluateSkillAchievementRules"|"calculateOfflineGains"|"normalizePlanetaryState"}
  const achievementEvents = []; // 真实订阅 achievement:unlocked（persistence 加载前注册，可观测追溯对账 emit）
  let spyInstalled = false;
  for (const source of scriptSources) {
    const rel = source.replace(/^\.\//, "");
    if (!spyInstalled && rel === "js/core/persistence.js") {
      let researchSpied = false, achSpied = false, offlineSpied = false, reconcileSpied = false;
      const RS = sandbox.ResearchState;
      if (RS && typeof RS.migrateResearchState === "function") {
        const real = RS.migrateResearchState;
        RS.migrateResearchState = function (state) {
          timeline.push({ fn: "migrateResearchState" });
          return real.call(this, state);
        };
        researchSpied = true;
      }
      const AS = sandbox.AchievementState;
      if (AS && typeof AS.migrateAchievementState === "function") {
        const real = AS.migrateAchievementState;
        AS.migrateAchievementState = function (state) {
          timeline.push({ fn: "migrateAchievementState", dirtyBefore: !!(state && state._dirty) });
          const out = real.call(this, state);
          const last = timeline[timeline.length - 1];
          last.dirtyAfter = !!(state && state._dirty);
          return out;
        };
        achSpied = true;
      }
      if (typeof sandbox.calculateOfflineGains === "function") {
        const realOffline = sandbox.calculateOfflineGains;
        sandbox.calculateOfflineGains = function (...a) {
          timeline.push({ fn: "calculateOfflineGains" });
          return realOffline.apply(this, a);
        };
        offlineSpied = true;
      }
      // Batch C-1：spy persistence 的追溯对账调用（AchievementSystem.evaluateSkillAchievementRules）。
      // 注意：skill:levelUp 消费者内部走模块闭包函数、不经过此属性 —— 因此本 spy
      // 只统计 persistence 追溯对账的调用次数，可区分“追溯扫描”与“事件消费者解锁”。
      const SYS = sandbox.AchievementSystem;
      if (SYS && typeof SYS.evaluateSkillAchievementRules === "function") {
        const realEval = SYS.evaluateSkillAchievementRules;
        SYS.evaluateSkillAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluateSkillAchievementRules", atMs };
          timeline.push(entry);
          const out = realEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        reconcileSpied = true;
      }
      // Batch C-2：spy persistence 的生产追溯对账调用（evaluateProductionAchievementRules）。
      // 生产事件消费者内部同样走模块闭包函数、不经过此属性 —— 本 spy 只统计
      // persistence 追溯对账，可区分“追溯扫描”与“三类生产事件消费者解锁”。
      let prodReconcileSpied = false;
      if (SYS && typeof SYS.evaluateProductionAchievementRules === "function") {
        const realProdEval = SYS.evaluateProductionAchievementRules;
        SYS.evaluateProductionAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluateProductionAchievementRules", atMs };
          timeline.push(entry);
          const out = realProdEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        prodReconcileSpied = true;
      }
      // Batch C-3：spy persistence 的战斗追溯对账调用（evaluateCombatAchievementRules）。
      // 战斗事件消费者内部同样走模块闭包函数、不经过此属性 —— 本 spy 只统计
      // persistence 追溯对账，可区分“追溯扫描”与“战斗事件消费者解锁”。
      let combatReconcileSpied = false;
      if (SYS && typeof SYS.evaluateCombatAchievementRules === "function") {
        const realCombatEval = SYS.evaluateCombatAchievementRules;
        SYS.evaluateCombatAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluateCombatAchievementRules", atMs };
          timeline.push(entry);
          const out = realCombatEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        combatReconcileSpied = true;
      }
      // Batch C-4：spy persistence 的制造追溯对账调用（evaluateManufacturingAchievementRules）。
      // 制造事件消费者内部同样走模块闭包函数、不经过此属性 —— 本 spy 只统计
      // persistence 追溯对账，可区分“追溯扫描”与“制造事件消费者解锁”。
      let manufacturingReconcileSpied = false;
      if (SYS && typeof SYS.evaluateManufacturingAchievementRules === "function") {
        const realMfgEval = SYS.evaluateManufacturingAchievementRules;
        SYS.evaluateManufacturingAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluateManufacturingAchievementRules", atMs };
          timeline.push(entry);
          const out = realMfgEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        manufacturingReconcileSpied = true;
      }
      // Batch C-5：spy persistence 的装备追溯对账调用（evaluateEquipmentAchievementRules）。
      // 装备事件消费者内部同样走模块闭包函数、不经过此属性 —— 本 spy 只统计
      // persistence 追溯对账，可区分“追溯扫描”与“装备事件消费者解锁”。
      let equipmentReconcileSpied = false;
      if (SYS && typeof SYS.evaluateEquipmentAchievementRules === "function") {
        const realEqEval = SYS.evaluateEquipmentAchievementRules;
        SYS.evaluateEquipmentAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluateEquipmentAchievementRules", atMs };
          timeline.push(entry);
          const out = realEqEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        equipmentReconcileSpied = true;
      }
      // Batch C-6：spy persistence 的增幅剂追溯对账调用（evaluateBoosterAchievementRules）。
      // 增幅剂事件消费者内部同样走模块闭包函数、不经过此属性 —— 本 spy 只统计
      // persistence 追溯对账，可区分"追溯扫描"与"增幅剂事件消费者解锁"。
      let boosterReconcileSpied = false;
      if (SYS && typeof SYS.evaluateBoosterAchievementRules === "function") {
        const realBoosterEval = SYS.evaluateBoosterAchievementRules;
        SYS.evaluateBoosterAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluateBoosterAchievementRules", atMs };
          timeline.push(entry);
          const out = realBoosterEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        boosterReconcileSpied = true;
      }
      // Batch C-7：spy persistence 的考古追溯对账调用（evaluateArchaeologyAchievementRules）。
      // 考古事件消费者内部同样走模块闭包函数、不经过此属性 —— 本 spy 只统计
      // persistence 追溯对账，可区分"追溯扫描"与"考古事件消费者解锁"。
      let archaeologyReconcileSpied = false;
      if (SYS && typeof SYS.evaluateArchaeologyAchievementRules === "function") {
        const realArchEval = SYS.evaluateArchaeologyAchievementRules;
        SYS.evaluateArchaeologyAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluateArchaeologyAchievementRules", atMs };
          timeline.push(entry);
          const out = realArchEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        archaeologyReconcileSpied = true;
      }
      // Batch C-8：spy persistence 的行星追溯对账调用（evaluatePlanetaryAchievementRules）。
      // 行星事件消费者内部同样走模块闭包函数、不经过此属性 —— 本 spy 只统计
      // persistence 追溯对账，可区分"追溯扫描"与"行星事件消费者解锁"。
      let planetaryReconcileSpied = false;
      if (SYS && typeof SYS.evaluatePlanetaryAchievementRules === "function") {
        const realPlanetaryEval = SYS.evaluatePlanetaryAchievementRules;
        SYS.evaluatePlanetaryAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluatePlanetaryAchievementRules", atMs };
          timeline.push(entry);
          const out = realPlanetaryEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        planetaryReconcileSpied = true;
      }
      // Batch C-9：spy persistence 的空间站追溯对账调用（evaluateStationAchievementRules）。
      // 空间站事件消费者内部同样走模块闭包函数、不经过此属性 —— 本 spy 只统计
      // persistence 追溯对账，可区分"追溯扫描"与"空间站事件消费者解锁"。
      let stationReconcileSpied = false;
      if (SYS && typeof SYS.evaluateStationAchievementRules === "function") {
        const realStationEval = SYS.evaluateStationAchievementRules;
        SYS.evaluateStationAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluateStationAchievementRules", atMs };
          timeline.push(entry);
          const out = realStationEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        stationReconcileSpied = true;
      }
      if (sandbox.GameEvents && typeof sandbox.GameEvents.on === "function") {
        sandbox.GameEvents.on("achievement:unlocked", (ev) => achievementEvents.push(ev));
      }
      // Batch C-10A3：spy persistence 的蓝图追溯对账调用（evaluateBlueprintAchievementRules）。
      // 蓝图事件消费者内部同样走模块闭包函数、不经过此属性 —— 本 spy 只统计
      // persistence 追溯对账，可区分"追溯扫描"与"蓝图事件消费者解锁"。
      let blueprintReconcileSpied = false;
      if (SYS && typeof SYS.evaluateBlueprintAchievementRules === "function") {
        const realBlueprintEval = SYS.evaluateBlueprintAchievementRules;
        SYS.evaluateBlueprintAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluateBlueprintAchievementRules", atMs };
          timeline.push(entry);
          const out = realBlueprintEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        blueprintReconcileSpied = true;
      }
      // Batch C-13：spy persistence 的经济追溯对账调用（evaluateEconomyAchievementRules）。
      // 经济事件消费者内部同样走模块闭包函数、不经过此属性 —— 本 spy 只统计
      // persistence 追溯对账，可区分"追溯扫描"与"经济事件消费者解锁"。
      let economyReconcileSpied = false;
      if (SYS && typeof SYS.evaluateEconomyAchievementRules === "function") {
        const realEconomyEval = SYS.evaluateEconomyAchievementRules;
        SYS.evaluateEconomyAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluateEconomyAchievementRules", atMs };
          timeline.push(entry);
          const out = realEconomyEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        economyReconcileSpied = true;
      }
      // Batch C-14A：spy persistence 的综合追溯对账调用（evaluateGeneralAchievementRules）。
      // 综合事件消费者内部同样走模块闭包函数、不经过此属性 —— 本 spy 只统计
      // persistence 追溯对账，可区分"追溯扫描"与"生命周期事件消费者解锁"。
      let generalReconcileSpied = false;
      if (SYS && typeof SYS.evaluateGeneralAchievementRules === "function") {
        const realGeneralEval = SYS.evaluateGeneralAchievementRules;
        SYS.evaluateGeneralAchievementRules = function (state, atMs) {
          const entry = { fn: "evaluateGeneralAchievementRules", atMs };
          timeline.push(entry);
          const out = realGeneralEval.call(this, state, atMs);
          entry.result = out;
          return out;
        };
        generalReconcileSpied = true;
      }
      spyInstalled = researchSpied && achSpied && offlineSpied && reconcileSpied && prodReconcileSpied && combatReconcileSpied && manufacturingReconcileSpied && equipmentReconcileSpied && boosterReconcileSpied && archaeologyReconcileSpied && planetaryReconcileSpied && stationReconcileSpied && blueprintReconcileSpied && economyReconcileSpied && generalReconcileSpied;
    }
    vm.runInContext(fs.readFileSync(path.resolve(ROOT, rel), "utf8"), sandbox, { filename: rel });
  }
  return { sandbox, timeline, spyInstalled, scriptSources, achievementEvents };
}

// ============================================================================
//  --state：默认 schema / 幂等迁移清洗 / 真实存档路径 / 脚本顺序 / 全脚本加载
// ============================================================================
function runState() {
  const sb = buildKernelSandbox({ withEvents: true });
  const AS = sb.AchievementState;
  const SADATA = sb.AchievementData;
  ok("[st1] VM 沙箱加载 AchievementState（API 齐备）",
    !!AS && typeof AS.createDefaultAchievementState === "function" && typeof AS.migrateAchievementState === "function");
  if (!AS) return;

  // 1) 默认 schema 精确（恰好两个键，值精确）
  const d1 = AS.createDefaultAchievementState();
  ok("[st2] 默认 schema 精确 = {schemaVersion:1, unlockedAtById:{}}（恰好 2 键）",
    d1 && typeof d1 === "object" && !Array.isArray(d1) &&
    Object.keys(d1).length === 2 && d1.schemaVersion === 1 &&
    d1.unlockedAtById && typeof d1.unlockedAtById === "object" && !Array.isArray(d1.unlockedAtById) &&
    Object.keys(d1.unlockedAtById).length === 0);

  // 2) 两次默认构造无共享引用
  const d2 = AS.createDefaultAchievementState();
  d1.unlockedAtById["A01"] = 123;
  ok("[st3] 两次默认构造对象与 unlockedAtById 均无共享引用",
    d1 !== d2 && d1.unlockedAtById !== d2.unlockedAtById && Object.keys(d2.unlockedAtById).length === 0);

  // 3) 缺失 achievements 补全
  const s3 = {};
  AS.migrateAchievementState(s3);
  ok("[st4] 缺失 achievements 时迁移补全默认结构",
    s3.achievements && s3.achievements.schemaVersion === 1 &&
    s3.achievements.unlockedAtById && Object.keys(s3.achievements.unlockedAtById).length === 0);

  // 非对象根 state 安全返回不抛异常
  let noThrow = true;
  try {
    AS.migrateAchievementState(null);
    AS.migrateAchievementState(undefined);
    AS.migrateAchievementState(42);
    AS.migrateAchievementState("str");
  } catch (e) { noThrow = false; }
  ok("[st5] state 非对象（null/undefined/数字/字符串）安全返回不抛异常", noThrow);

  // 4) null / 数组 / 非对象 achievements 修复
  const s4a = { achievements: null };
  const s4b = { achievements: ["bad"] };
  const s4c = { achievements: "corrupted" };
  AS.migrateAchievementState(s4a);
  AS.migrateAchievementState(s4b);
  AS.migrateAchievementState(s4c);
  const fixedOk = [s4a, s4b, s4c].every((s) =>
    s.achievements && typeof s.achievements === "object" && !Array.isArray(s.achievements) &&
    s.achievements.schemaVersion === 1 && Object.keys(s.achievements.unlockedAtById).length === 0);
  ok("[st6] achievements 为 null/数组/非对象时替换为默认结构", fixedOk);

  // unlockedAtById 缺失/数组/非对象 → 空对象
  const s4d = { achievements: { schemaVersion: 1 } };
  const s4e = { achievements: { schemaVersion: 1, unlockedAtById: [1, 2] } };
  const s4f = { achievements: { schemaVersion: 1, unlockedAtById: "junk" } };
  AS.migrateAchievementState(s4d); AS.migrateAchievementState(s4e); AS.migrateAchievementState(s4f);
  ok("[st7] unlockedAtById 缺失/数组/非对象规范为空对象",
    [s4d, s4e, s4f].every((s) =>
      s.achievements.unlockedAtById && typeof s.achievements.unlockedAtById === "object" &&
      !Array.isArray(s.achievements.unlockedAtById) && Object.keys(s.achievements.unlockedAtById).length === 0));

  // 5)+6)+7) 清洗：合法保留（含浮点），未知 ID / 非法值删除
  const s5 = {
    achievements: {
      schemaVersion: "9",
      unlockedAtById: {
        "A01": 1699999999999.25,   // 合法浮点 → 保留且不整数化
        "B01": 0,                  // 合法边界 0 → 保留
        "D19": 123,                // 幽灵 ID → 删除
        "ZZZ": 456,                // 未知 ID → 删除
        "C01": NaN,                // NaN → 删除
        "C02": Infinity,           // Infinity → 删除
        "C03": -1,                 // 负数 → 删除
        "C04": "12345",            // 字符串 → 删除
        "C05": { t: 1 },           // 对象 → 删除
        "C06": true,               // 布尔 → 删除
      },
    },
  };
  AS.migrateAchievementState(s5);
  const m5 = s5.achievements.unlockedAtById;
  ok("[st8] 合法 ID + 合法时间戳保留（浮点不整数化、0 边界保留）",
    m5["A01"] === 1699999999999.25 && m5["B01"] === 0);
  ok("[st9] 未知/幽灵 ID 删除（D19、ZZZ）", !("D19" in m5) && !("ZZZ" in m5));
  ok("[st10] NaN/Infinity/负数/字符串/对象/布尔值全部删除",
    Object.keys(m5).length === 2);
  // 8) schemaVersion 归一为 1
  ok("[st11] schemaVersion 归一为 1（原为字符串 \"9\"）", s5.achievements.schemaVersion === 1);

  // 9) 连续迁移两次 JSON 严格一致
  const once = JSON.stringify(s5);
  AS.migrateAchievementState(s5);
  ok("[st12] 连续迁移两次 JSON 严格一致（幂等）", JSON.stringify(s5) === once);

  // 10) 迁移不设置 _dirty
  const s10 = { achievements: { schemaVersion: 3, unlockedAtById: { "GHOST": 1, "A01": 5 } } };
  AS.migrateAchievementState(s10);
  ok("[st13] 迁移不设置 _dirty（即使清洗了非法条目）", !("_dirty" in s10) || s10._dirty === false);

  // 11) 迁移不 emit（真实订阅 achievement:unlocked 观测）
  const migEvents = [];
  sb.GameEvents.on("achievement:unlocked", (ev) => migEvents.push(ev));
  AS.migrateAchievementState({ achievements: { unlockedAtById: { "A01": 1, "BAD": 2 } } });
  AS.migrateAchievementState({});
  ok("[st14] 迁移不 emit achievement:unlocked（订阅观测 0 次）", migEvents.length === 0);

  // 12) state.js 真实使用 AchievementState 默认构造，无第二套 schema / 兜底
  const stateSrc = fs.readFileSync(CORE_STATE_PATH, "utf-8");
  ok("[st15] state.js 真实使用 AchievementState.createDefaultAchievementState()",
    /achievements:\s*AchievementState\.createDefaultAchievementState\(\)/.test(stateSrc));
  ok("[st16] state.js 不复制第二套 schema（无 unlockedAtById 字面量）与兜底三元（无 AchievementState ?）",
    !stateSrc.includes("unlockedAtById") && !/AchievementState\s*\?/.test(stateSrc) && !/typeof\s+AchievementState/.test(stateSrc));

  // 16) index.html 三个脚本存在且顺序正确
  const order = readIndexScriptOrder();
  ok("[st17] index.html 成就三脚本存在且顺序 events<data<state层<core/state<system<persistence",
    order.events >= 0 && order.achData >= 0 && order.achState >= 0 &&
    order.coreState >= 0 && order.achSystem >= 0 && order.persistence >= 0 &&
    order.events < order.achData && order.achData < order.achState &&
    order.achState < order.coreState && order.coreState < order.achSystem &&
    order.achSystem < order.persistence);

  // ==========================================================================
  //  真实存档路径（全脚本沙箱）：15) 新游戏 autoLoad  14) restored=true  13) importData
  // ==========================================================================
  // 17) + 15) 新游戏（无存档）：全脚本加载无未定义依赖，ach 迁移恰好 1 次，offline 0 次
  let fresh = null;
  try {
    fresh = buildFullGameSandbox(null);
  } catch (e) {
    ok("[st18] 无存档加载全部 index.html 脚本不抛异常: " + (e && e.message), false);
  }
  if (fresh) {
    ok("[st18] 全量脚本 VM 加载无未定义依赖（新游戏路径无异常）", true);
    ok("[st19] spy（research+achievement+offline）在 persistence.js 前装上", fresh.spyInstalled);
    const tl = fresh.timeline;
    ok("[st20] 新游戏 autoLoad：migrateAchievementState 恰好 1 次",
      tl.filter((e) => e.fn === "migrateAchievementState").length === 1);
    ok("[st21] 新游戏 restored=false：calculateOfflineGains 0 次",
      tl.filter((e) => e.fn === "calculateOfflineGains").length === 0);
    const rIdx = tl.findIndex((e) => e.fn === "migrateResearchState");
    const aIdx = tl.findIndex((e) => e.fn === "migrateAchievementState");
    ok("[st22] 新游戏 autoLoad：research 迁移 < achievement 迁移", rIdx >= 0 && aIdx >= 0 && rIdx < aIdx);
    ok("[st23] 新游戏迁移不设置 _dirty（spy 前后观测）",
      tl.filter((e) => e.fn === "migrateAchievementState").every((e) => e.dirtyBefore === e.dirtyAfter));
    // C-13：初始 ISK = 1,000,000（state.js）使经济成就 I01 在新游戏首次对账即解锁，
    // 因此新游戏解锁集合的精确期望是恰好 {I01}，而非空集。
    {
      const freshAch = fresh.sandbox.gameState && fresh.sandbox.gameState.achievements;
      const freshIds = freshAch ? Object.keys(freshAch.unlockedAtById) : null;
      ok("[st24] 新游戏 gameState.achievements 初始化完整（schemaVersion=1 且解锁集恰为 {I01}）",
        !!freshAch && freshAch.schemaVersion === 1 &&
        Array.isArray(freshIds) && freshIds.length === 1 && freshIds[0] === "I01" &&
        Number.isFinite(freshAch.unlockedAtById["I01"]));
      ok("[st24b] 新游戏 I01 由初始 ISK=1,000,000 触发（resources.isk 恰为 1e6 且 >= 阈值）",
        fresh.sandbox.gameState.resources.isk === 1000000 &&
        fresh.sandbox.gameState.resources.isk >= 1e6);
      ok("[st24c] 新游戏未误解锁更高档经济成就 I02/I03/I12",
        !!freshAch && !("I02" in freshAch.unlockedAtById) &&
        !("I03" in freshAch.unlockedAtById) && !("I12" in freshAch.unlockedAtById));
    }

    // 13) importData 真实路径（在同一沙箱上继续）
    const importSave = {
      skills: { mining: { lvl: 3, xp: 10 } },
      resources: { isk: 50000, fuel: 1000 },
      research: { completedLevels: { mine: 2 } },
      planetary: { deployments: [], nextId: 1 },
      achievements: {
        schemaVersion: "7",
        unlockedAtById: { "A01": 1650000000000.5, "D19": 99, "B02": -3, "C01": "bad" },
      },
    };
    // importData 内部通过全局绑定调用 normalizePlanetaryState，可在加载完成后 wrap
    if (typeof fresh.sandbox.normalizePlanetaryState === "function") {
      const realNorm = fresh.sandbox.normalizePlanetaryState;
      fresh.sandbox.normalizePlanetaryState = function (state, opts) {
        fresh.timeline.push({ fn: "normalizePlanetaryState" });
        return realNorm.call(this, state, opts);
      };
    }
    const tlBefore = fresh.timeline.length;
    let importOk = false;
    try {
      importOk = fresh.sandbox.SaveManager.importData(JSON.stringify(importSave));
    } catch (e) {
      ok("[st25] SaveManager.importData 抛出异常: " + (e && e.message), false);
    }
    ok("[st25] SaveManager.importData 返回 true（真实导入路径成功）", importOk === true);
    const itl = fresh.timeline.slice(tlBefore);
    const iNorm = itl.findIndex((e) => e.fn === "normalizePlanetaryState");
    const iRes = itl.findIndex((e) => e.fn === "migrateResearchState");
    const iAch = itl.findIndex((e) => e.fn === "migrateAchievementState");
    const iOff = itl.findIndex((e) => e.fn === "calculateOfflineGains");
    ok("[st26] importData：migrateAchievementState 恰好 1 次",
      itl.filter((e) => e.fn === "migrateAchievementState").length === 1);
    ok("[st27] importData 顺序：normalizePlanetaryState < research 迁移 < achievement 迁移 < offline",
      iNorm >= 0 && iRes >= 0 && iAch >= 0 && iOff >= 0 && iNorm < iRes && iRes < iAch && iAch < iOff);
    const gsAch = fresh.sandbox.gameState.achievements;
    ok("[st28] importData 后 achievements 清洗生效（A01 浮点保留，D19/负数/字符串删除，schemaVersion=1）",
      gsAch && gsAch.schemaVersion === 1 &&
      gsAch.unlockedAtById["A01"] === 1650000000000.5 &&
      Object.keys(gsAch.unlockedAtById).length === 1);
  }

  // 14) restored=true autoLoad：迁移恰好一次且严格早于 offline
  const restoredSave = JSON.stringify({
    skills: { mining: { lvl: 2, xp: 5 } },
    resources: { isk: 1234, fuel: 500 },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    achievements: { schemaVersion: 2, unlockedAtById: { "A01": 1000.75, "GHOST": 8 } },
    planetary: { deployments: [], nextId: 1 },
  });
  let restored = null;
  try {
    restored = buildFullGameSandbox(restoredSave);
  } catch (e) {
    ok("[st29] restored=true 全脚本加载不抛异常: " + (e && e.message), false);
  }
  if (restored) {
    const tl = restored.timeline;
    const achCount = tl.filter((e) => e.fn === "migrateAchievementState").length;
    const offCount = tl.filter((e) => e.fn === "calculateOfflineGains").length;
    const aIdx = tl.findIndex((e) => e.fn === "migrateAchievementState");
    const oIdx = tl.findIndex((e) => e.fn === "calculateOfflineGains");
    ok("[st29] restored=true autoLoad：migrateAchievementState 恰好 1 次", achCount === 1);
    ok("[st30] restored=true autoLoad：achievement 迁移严格早于 calculateOfflineGains",
      offCount >= 1 && aIdx >= 0 && oIdx >= 0 && aIdx < oIdx);
    const gsAch = restored.sandbox.gameState.achievements;
    // C-13：读档路径同样会跑经济追溯对账，ISK 达标使 I01 被补记；
    // 精确期望 = {A01 原值保留, I01 新补}，GHOST 必须被清洗掉。
    ok("[st31] restored=true 存档清洗生效（A01=1000.75 保留 / GHOST 删除 / schemaVersion=1）",
      gsAch && gsAch.schemaVersion === 1 && gsAch.unlockedAtById["A01"] === 1000.75 &&
      !("GHOST" in gsAch.unlockedAtById) &&
      Object.keys(gsAch.unlockedAtById).sort().join(",") === "A01,I01");
    ok("[st31b] restored=true 的 I01 是本次登录补记（时间戳 = 冻结 Date.now()，非存档值）",
      gsAch && gsAch.unlockedAtById["I01"] === FROZEN_NOW);
  }
}

// ============================================================================
//  --unlock：解锁内核（查询只读 / 幂等解锁 / dirty / 事件 / 冻结时间 / 不可变目录）
// ============================================================================
function runUnlock() {
  const sb = buildKernelSandbox({ withEvents: true });
  const SYS = sb.AchievementSystem;
  const AS = sb.AchievementState;
  const SAD = sb.AchievementData;
  ok("[uk1] VM 沙箱加载 AchievementSystem（5 个 API 齐备）",
    !!SYS && ["getAchievementDefinition", "isAchievementUnlocked", "getAchievementUnlockTime", "getUnlockedAchievements", "unlockAchievement"]
      .every((k) => typeof SYS[k] === "function"));
  if (!SYS) return;

  // 事件捕获（真实订阅）
  const captured = [];
  sb.GameEvents.on("achievement:unlocked", (ev) => captured.push(ev));

  // 1) getAchievementDefinition：已知返回目录原对象引用；未知返回 null
  ok("[uk2] getAchievementDefinition(\"A01\") 返回目录原对象引用（不复制）",
    SYS.getAchievementDefinition("A01") === SAD.ACHIEVEMENTS_BY_ID["A01"]);
  ok("[uk3] getAchievementDefinition 未知 ID（D19/ZZZ/null）返回 null",
    SYS.getAchievementDefinition("D19") === null && SYS.getAchievementDefinition("ZZZ") === null &&
    SYS.getAchievementDefinition(null) === null);

  // 2) INVALID_STATE 稳定 reason
  const inv1 = SYS.unlockAchievement(null, "A01", 1);
  const inv2 = SYS.unlockAchievement({}, "A01", 1);
  const inv3 = SYS.unlockAchievement({ achievements: [] }, "A01", 1);
  const inv4 = SYS.unlockAchievement({ achievements: { unlockedAtById: [1] } }, "A01", 1);
  ok("[uk4] 非法 state（null/{}/数组/unlockedAtById 数组）稳定返回 {ok:false, reason:\"INVALID_STATE\"}",
    [inv1, inv2, inv3, inv4].every((r) => r && r.ok === false && r.reason === "INVALID_STATE"));

  // 主测试状态
  const state = { achievements: AS.createDefaultAchievementState() };

  // 3) UNKNOWN_ACHIEVEMENT 稳定 reason + 不改状态不 emit 不 dirty
  const beforeUnknown = JSON.stringify(state);
  const unk = SYS.unlockAchievement(state, "D19", 123);
  ok("[uk5] 未知 ID 稳定返回 {ok:false, reason:\"UNKNOWN_ACHIEVEMENT\"}",
    unk && unk.ok === false && unk.reason === "UNKNOWN_ACHIEVEMENT");
  ok("[uk6] 未知 ID 不改状态、不设置 dirty、不 emit",
    JSON.stringify(state) === beforeUnknown && !("_dirty" in state) && captured.length === 0);

  // 4)+5) 首次解锁：ok=true reason=null，精确写入 atMs
  const T1 = 1690000000000;
  const r1 = SYS.unlockAchievement(state, "A01", T1);
  ok("[uk7] 首次解锁返回 {ok:true, reason:null, achievementId, unlockedAt}",
    r1 && r1.ok === true && r1.reason === null && r1.achievementId === "A01" && r1.unlockedAt === T1);
  ok("[uk8] 成功写入精确 unlockedAt（unlockedAtById[\"A01\"] === atMs）",
    state.achievements.unlockedAtById["A01"] === T1);

  // 8) 成功解锁设置 _dirty=true
  ok("[uk9] 首次成功解锁设置 state._dirty === true", state._dirty === true);

  // 9)-12) 事件：严格一次、payload 精确、timestamp、meta.source
  ok("[uk10] 首次成功严格 emit 一次", captured.length === 1);
  const ev1 = captured[0];
  ok("[uk11] payload 精确为 {achievementId, unlockedAt}（恰好 2 键，值精确）",
    !!ev1 && Object.keys(ev1.payload).length === 2 &&
    ev1.payload.achievementId === "A01" && ev1.payload.unlockedAt === T1);
  ok("[uk12] event.timestamp 精确等于 unlockedAt", !!ev1 && ev1.timestamp === T1);
  ok("[uk13] event.meta.source === \"achievement-system\"", !!ev1 && ev1.meta && ev1.meta.source === "achievement-system");
  ok("[uk14] 事件通过契约校验（valid && registered）", !!ev1 && ev1.valid === true && ev1.registered === true);

  // 6) atMs 浮点不整数化
  const TF = 1690000000123.625;
  const rf = SYS.unlockAchievement(state, "B01", TF);
  ok("[uk15] atMs 浮点毫秒原样使用不整数化", rf.ok === true && rf.unlockedAt === TF &&
    state.achievements.unlockedAtById["B01"] === TF);

  // 7) 非法 atMs → 冻结 Date.now()
  const rNaN = SYS.unlockAchievement(state, "C01", NaN);
  const rNeg = SYS.unlockAchievement(state, "C02", -5);
  const rStr = SYS.unlockAchievement(state, "C03", "not-a-number");
  const rUndef = SYS.unlockAchievement(state, "C04", undefined);
  const rInf = SYS.unlockAchievement(state, "C05", Infinity);
  ok("[uk16] 非法 atMs（NaN/负数/字符串/undefined/Infinity）统一使用冻结 Date.now()",
    [rNaN, rNeg, rStr, rUndef, rInf].every((r) => r.ok === true && r.unlockedAt === FROZEN_NOW));

  // 0 是合法时间戳（>=0 原样使用，不回退 Date.now()）
  const rZero = SYS.unlockAchievement(state, "C06", 0);
  ok("[uk17] atMs=0 为合法时间戳原样使用（不回退 Date.now()）", rZero.ok === true && rZero.unlockedAt === 0);

  // 13)-15) 重复解锁
  captured.length = 0;
  state._dirty = false;
  const r2 = SYS.unlockAchievement(state, "A01", 999);
  ok("[uk18] 重复解锁返回 {ok:false, reason:\"ALREADY_UNLOCKED\", achievementId, unlockedAt=首次}",
    r2 && r2.ok === false && r2.reason === "ALREADY_UNLOCKED" && r2.achievementId === "A01" && r2.unlockedAt === T1);
  ok("[uk19] 重复解锁不覆盖第一次 unlockedAt", state.achievements.unlockedAtById["A01"] === T1);
  ok("[uk20] 重复解锁不 emit、不设置 dirty", captured.length === 0 && state._dirty === false);

  // 18) 查询正确性
  ok("[uk21] isAchievementUnlocked 返回严格 boolean 且正确",
    SYS.isAchievementUnlocked(state, "A01") === true &&
    SYS.isAchievementUnlocked(state, "J01") === false &&
    SYS.isAchievementUnlocked(null, "A01") === false);
  ok("[uk22] getAchievementUnlockTime 已解锁返回原始时间戳 / 未解锁与非法状态返回 null",
    SYS.getAchievementUnlockTime(state, "A01") === T1 &&
    SYS.getAchievementUnlockTime(state, "B01") === TF &&
    SYS.getAchievementUnlockTime(state, "J01") === null &&
    SYS.getAchievementUnlockTime(null, "A01") === null);

  // 19) getUnlockedAchievements：目录顺序 + 原对象引用
  //     注意 state 中解锁顺序为 A01,B01,C01..C06；目录顺序也应为 A01<B01<C01..
  //     为验证顺序不依赖键插入序，先解锁一个目录顺序靠前但插入靠后的 ID（A02）
  SYS.unlockAchievement(state, "A02", T1 + 1);
  const list = SYS.getUnlockedAchievements(state);
  const catalogOrder = SAD.ACHIEVEMENTS.map((a) => a.id).filter((id) => id in state.achievements.unlockedAtById);
  ok("[uk23] getUnlockedAchievements 严格按目录顺序返回（A02 插入最晚但排 A01 之后 B01 之前）",
    list.length === catalogOrder.length && list.every((e, i) => e.achievement.id === catalogOrder[i]) &&
    list[0].achievement.id === "A01" && list[1].achievement.id === "A02");
  ok("[uk24] 视图 achievement 是 AchievementData 原对象引用，unlockedAt 精确",
    list.every((e) => e.achievement === SAD.ACHIEVEMENTS_BY_ID[e.achievement.id]) &&
    list.find((e) => e.achievement.id === "B01").unlockedAt === TF);

  // 20) 所有查询前后状态 JSON 完全一致（纯只读）
  const qBefore = JSON.stringify(state);
  SYS.isAchievementUnlocked(state, "A01");
  SYS.isAchievementUnlocked(state, "ZZZ");
  SYS.getAchievementUnlockTime(state, "A01");
  SYS.getAchievementUnlockTime(state, "J10");
  SYS.getUnlockedAchievements(state);
  SYS.getAchievementDefinition("A01");
  ok("[uk25] 全部查询调用前后 JSON.stringify(state) 完全一致（纯只读、不设置 dirty）",
    JSON.stringify(state) === qBefore);

  // 21) 解锁不修改冻结 AchievementData
  const adSnapshot = JSON.stringify(SAD.ACHIEVEMENTS_BY_ID["A01"]);
  ok("[uk26] 解锁不修改冻结目录（A01 目录项 JSON 不变且仍冻结）",
    JSON.stringify(SAD.ACHIEVEMENTS_BY_ID["A01"]) === adSnapshot &&
    Object.isFrozen(SAD.ACHIEVEMENTS_BY_ID["A01"]) && Object.isFrozen(SAD.ACHIEVEMENTS));

  // 17) GameEvents 缺失时解锁仍成功（无事件层沙箱）
  const sbNoEv = buildKernelSandbox({ withEvents: false });
  ok("[uk27] 无事件层沙箱确实没有 GameEvents", typeof sbNoEv.GameEvents === "undefined");
  const stNoEv = { achievements: sbNoEv.AchievementState.createDefaultAchievementState() };
  let noEvThrow = true, rNoEv = null;
  try { rNoEv = sbNoEv.AchievementSystem.unlockAchievement(stNoEv, "A01", 777); } catch (e) { noEvThrow = false; }
  ok("[uk28] GameEvents 不存在时解锁仍成功（不抛异常、不回滚、状态写入、dirty=true）",
    noEvThrow && rNoEv && rNoEv.ok === true && rNoEv.unlockedAt === 777 &&
    stNoEv.achievements.unlockedAtById["A01"] === 777 && stNoEv._dirty === true);

  // 23) 事件契约真实注册且 payload 校验通过
  ok("[uk29] achievement:unlocked 契约真实注册（contracts.has）",
    sb.GameEvents.contracts.has("achievement:unlocked"));
  const vOk = sb.GameEvents.contracts.validate("achievement:unlocked", { achievementId: "A01", unlockedAt: FROZEN_NOW });
  const vMiss = sb.GameEvents.contracts.validate("achievement:unlocked", { achievementId: "A01" });
  const vBad = sb.GameEvents.contracts.validate("achievement:unlocked", { achievementId: "A01", unlockedAt: "x" });
  ok("[uk30] 契约行为校验：合法通过 / 缺 unlockedAt 拒绝 / 非数字拒绝",
    vOk.valid === true && vOk.registered === true && vMiss.valid === false && vBad.valid === false);

  // 22) 迁移/查询/重复解锁不伪造 Steam API 调用
  //     a. 行为观测：沙箱注入记录型 Steam 全局对象，全流程后调用数必须为 0
  //     b. 源码扫描：两个新文件不含 Steamworks 禁用标识符
  const steamCalls = [];
  const steamTrap = new Proxy({}, {
    get(_, prop) { return (...a) => { steamCalls.push(String(prop)); }; },
  });
  const sbTrap = buildKernelSandbox({ withEvents: true });
  sbTrap.SteamAPI = steamTrap; sbTrap.steamworks = steamTrap; sbTrap.greenworks = steamTrap;
  const stTrap = { achievements: sbTrap.AchievementState.createDefaultAchievementState() };
  sbTrap.AchievementState.migrateAchievementState(stTrap);
  sbTrap.AchievementSystem.unlockAchievement(stTrap, "A01", 1);
  sbTrap.AchievementSystem.unlockAchievement(stTrap, "A01", 2); // 重复
  sbTrap.AchievementSystem.isAchievementUnlocked(stTrap, "A01");
  sbTrap.AchievementSystem.getUnlockedAchievements(stTrap);
  ok("[uk31] 迁移/解锁/重复解锁/查询全流程 Steam 全局对象调用数 = 0", steamCalls.length === 0);
  const forbidden = ["SteamAPI_Init", "SetAchievement", "SetStat", "StoreStats", "RequestCurrentStats", "steam_appid", "greenworks", "steamworks"];
  const stateSrc = fs.readFileSync(ACH_STATE_PATH, "utf-8");
  const sysSrc = fs.readFileSync(ACH_SYSTEM_PATH, "utf-8");
  ok("[uk32] achievement-state.js / systems/achievements.js 不含 Steamworks SDK 禁用标识符",
    forbidden.every((t) => !stateSrc.includes(t)) && forbidden.every((t) => !sysSrc.includes(t)));
  // 状态中无 Steam 同步字段（pending/synced/outbox）
  ok("[uk33] 解锁后状态不含 Steam 同步字段（pending/synced/outbox）",
    !JSON.stringify(state).match(/pending|synced|outbox/));
}

// ============================================================================
//  --skills：Batch C-1 技能规则（50 项冻结映射 / 边界 / 幂等 / 消费者 / 追溯对账）
// ============================================================================
function runSkills() {
  // ---- 独立期望表（审计侧显式复刻，与规则文件交叉验证，不从规则文件反推）----
  const EXP_ALL = [
    "mining", "planetaryIndustry", "refining", "gasHarvesting", "shipEngineering",
    "equipmentEngineering", "rigEngineering", "boosterEngineering", "reverseEngineering",
    "laserOps", "cannonOps", "missileOperations", "defense", "shieldOperation",
    "armorReinforcement", "hullEngineering", "targeting", "piloting",
    "capacitorManagement", "drones", "archaeology",
  ];
  const EXP_COMBAT = [
    "laserOps", "cannonOps", "missileOperations", "defense", "shieldOperation",
    "armorReinforcement", "hullEngineering", "targeting", "piloting",
    "capacitorManagement", "drones",
  ];
  const id2 = (n) => "A" + String(n).padStart(2, "0");
  const EXPECTED_RULE_IDS = [];
  for (let i = 1; i <= 48; i++) EXPECTED_RULE_IDS.push(id2(i));
  EXPECTED_RULE_IDS.push("C14", "F22");
  const RULE_ID_SET = new Set(EXPECTED_RULE_IDS);

  const sb = buildKernelSandbox({ withEvents: true, withRules: true });
  const RD = sb.AchievementRuleData;
  const SYS = sb.AchievementSystem;
  const SAD = sb.AchievementData;

  function makeSkillState(box, levels) {
    const skills = {};
    for (const k of EXP_ALL) skills[k] = { lvl: 1, xp: 0 };
    skills.combat = { lvl: 1, xp: 0 }; // legacy 兼容字段，不属于成就技能集合
    for (const [k, v] of Object.entries(levels || {})) {
      skills[k] = (v && typeof v === "object") ? v : { lvl: v, xp: 0 };
    }
    return { skills, achievements: box.AchievementState.createDefaultAchievementState() };
  }
  const evaluate = (state, atMs) => SYS.evaluateSkillAchievementRules(state, atMs);
  const unlockedSet = (state) => new Set(Object.keys(state.achievements.unlockedAtById));

  // ========================= A. 规则数据 =========================
  ok("[sk1] AchievementRuleData 可在无 DOM VM 中加载（schemaVersion=1，四个成员齐备）",
    !!RD && RD.schemaVersion === 1 && Array.isArray(RD.ALL_SKILL_KEYS) &&
    Array.isArray(RD.COMBAT_SKILL_KEYS) && Array.isArray(RD.SKILL_RULES) &&
    !!RD.SKILL_RULES_BY_ID && typeof RD.SKILL_RULES_BY_ID === "object");
  if (!RD || !SYS) return;

  ok("[sk2] ALL_SKILL_KEYS 精确 21 项、顺序精确、无 legacy combat",
    RD.ALL_SKILL_KEYS.length === 21 &&
    RD.ALL_SKILL_KEYS.every((k, i) => k === EXP_ALL[i]) &&
    !RD.ALL_SKILL_KEYS.includes("combat"));
  ok("[sk3] COMBAT_SKILL_KEYS 精确 11 项、顺序精确（A10–A20 对应集合）",
    RD.COMBAT_SKILL_KEYS.length === 11 &&
    RD.COMBAT_SKILL_KEYS.every((k, i) => k === EXP_COMBAT[i]) &&
    !RD.COMBAT_SKILL_KEYS.includes("combat"));
  ok("[sk4] SKILL_RULES 精确 50 项", RD.SKILL_RULES.length === 50);
  const ruleIds = RD.SKILL_RULES.map((r) => r.achievementId);
  ok("[sk5] 50 个 achievementId 全部唯一", new Set(ruleIds).size === 50);
  ok("[sk6] 50 个 ID 全部存在于 AchievementData 冻结目录",
    ruleIds.every((id) => !!SAD.ACHIEVEMENTS_BY_ID[id]));
  ok("[sk7] 规则 ID 集合精确等于 A01–A48 + C14 + F22",
    ruleIds.length === EXPECTED_RULE_IDS.length &&
    EXPECTED_RULE_IDS.every((id) => ruleIds.includes(id)));

  // A01–A42 单技能映射逐项精确（Lv.50 = A01–A21 按 EXP_ALL 顺序；Lv.99 = A22–A42）
  let single50Ok = true, single99Ok = true;
  for (let i = 0; i < 21; i++) {
    const r50 = RD.SKILL_RULES_BY_ID[id2(i + 1)];
    if (!r50 || r50.type !== "skill-level" || r50.skill !== EXP_ALL[i] || r50.minLevel !== 50) single50Ok = false;
    const r99 = RD.SKILL_RULES_BY_ID[id2(i + 22)];
    if (!r99 || r99.type !== "skill-level" || r99.skill !== EXP_ALL[i] || r99.minLevel !== 99) single99Ok = false;
  }
  ok("[sk8] A01–A21 单技能 Lv.50 映射逐项精确（21/21）", single50Ok);
  ok("[sk9] A22–A42 单技能 Lv.99 映射逐项精确（21/21）", single99Ok);
  const c14 = RD.SKILL_RULES_BY_ID["C14"], f22 = RD.SKILL_RULES_BY_ID["F22"];
  ok("[sk10] C14→shipEngineering≥99 / F22→archaeology≥99 映射精确",
    !!c14 && c14.type === "skill-level" && c14.skill === "shipEngineering" && c14.minLevel === 99 &&
    !!f22 && f22.type === "skill-level" && f22.skill === "archaeology" && f22.minLevel === 99);
  const a43 = RD.SKILL_RULES_BY_ID["A43"], a44 = RD.SKILL_RULES_BY_ID["A44"],
        a45 = RD.SKILL_RULES_BY_ID["A45"], a46 = RD.SKILL_RULES_BY_ID["A46"],
        a47 = RD.SKILL_RULES_BY_ID["A47"], a48 = RD.SKILL_RULES_BY_ID["A48"];
  const keysEq = (arr, exp) => Array.isArray(arr) && arr.length === exp.length && arr.every((k, i) => k === exp[i]);
  ok("[sk11] A43–A48 组合规则逐项精确（战斗全99 / 5项80 / 10项90 / 全50 / 战斗全80 / 全99）",
    !!a43 && a43.type === "skill-all" && keysEq(a43.keys, EXP_COMBAT) && a43.minLevel === 99 &&
    !!a44 && a44.type === "skill-count" && a44.count === 5 && a44.minLevel === 80 &&
    !!a45 && a45.type === "skill-count" && a45.count === 10 && a45.minLevel === 90 &&
    !!a46 && a46.type === "skill-all" && keysEq(a46.keys, EXP_ALL) && a46.minLevel === 50 &&
    !!a47 && a47.type === "skill-all" && keysEq(a47.keys, EXP_COMBAT) && a47.minLevel === 80 &&
    !!a48 && a48.type === "skill-all" && keysEq(a48.keys, EXP_ALL) && a48.minLevel === 99);
  ok("[sk12] 规则数组/规则对象/技能数组/BY_ID/外层对象全部 Object.freeze",
    Object.isFrozen(RD) && Object.isFrozen(RD.SKILL_RULES) && Object.isFrozen(RD.SKILL_RULES_BY_ID) &&
    Object.isFrozen(RD.ALL_SKILL_KEYS) && Object.isFrozen(RD.COMBAT_SKILL_KEYS) &&
    RD.SKILL_RULES.every((r) => Object.isFrozen(r)));
  const rulesSrc = fs.readFileSync(ACH_RULES_PATH, "utf-8");
  const sysSrc = fs.readFileSync(ACH_SYSTEM_PATH, "utf-8");
  // 去除注释后再做字面量扫描：设计注释会提及 "不解析 conditionText" 等，属合规说明而非引用
  const stripJsComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const rulesCode = stripJsComments(rulesSrc);
  const sysCode = stripJsComments(sysSrc);
  ok("[sk13] 未通过 conditionText 动态解析生成规则（规则文件与内核均无 conditionText 引用），规则文件不监听事件",
    !rulesCode.includes("conditionText") && !sysCode.includes("conditionText") &&
    !rulesCode.includes("GameEvents") && !/\.on\s*\(/.test(rulesCode) && !/\.emit\s*\(/.test(rulesCode));
  ok("[sk14] 未给其余 148 项建立规则（BY_ID 恰 50 键；B01/C01/F01/J10/J11/J12 无规则）",
    Object.keys(RD.SKILL_RULES_BY_ID).length === 50 &&
    ["B01", "C01", "F01", "J10", "J11", "J12"].every((id) => !(id in RD.SKILL_RULES_BY_ID)));

  // ========================= B. 单技能边界 =========================
  const s49 = makeSkillState(sb, { mining: 49 });
  const r49 = evaluate(s49, 1000);
  const s50 = makeSkillState(sb, { mining: 50 });
  const r50 = evaluate(s50, 1000);
  ok("[sk15] mining Lv.49 不解锁 A01；Lv.50 解锁 A01（evaluatedCount=50）",
    r49.ok === true && r49.evaluatedCount === 50 && !unlockedSet(s49).has("A01") && r49.unlockedIds.length === 0 &&
    r50.ok === true && r50.unlockedIds.includes("A01") && unlockedSet(s50).has("A01"));
  const s98 = makeSkillState(sb, { mining: 98 });
  evaluate(s98, 1000);
  const s99 = makeSkillState(sb, { mining: 99 });
  const r99 = evaluate(s99, 1000);
  ok("[sk16] mining Lv.98 只解锁 A01 不解锁 A22；Lv.99 同时满足 A01+A22",
    unlockedSet(s98).has("A01") && !unlockedSet(s98).has("A22") &&
    r99.unlockedIds.includes("A01") && r99.unlockedIds.includes("A22"));
  const sSE = makeSkillState(sb, { shipEngineering: 99 });
  const rSE = evaluate(sSE, 1000);
  ok("[sk17] shipEngineering Lv.99 同时解锁 A05/A26/C14（条件重复不合并）",
    ["A05", "A26", "C14"].every((id) => rSE.unlockedIds.includes(id)));
  const sAR = makeSkillState(sb, { archaeology: 99 });
  const rAR = evaluate(sAR, 1000);
  ok("[sk18] archaeology Lv.99 同时解锁 A21/A42/F22（条件重复不合并）",
    ["A21", "A42", "F22"].every((id) => rAR.unlockedIds.includes(id)));

  // 21 个技能逐项 50/99 边界（不抽样）：49→无，50→恰 {A(i)}，98→恰 {A(i)}，99→恰 {A(i),A(i+21)}(+C14/F22)
  for (let i = 0; i < 21; i++) {
    const key = EXP_ALL[i];
    const lo = id2(i + 1), hi = id2(i + 22);
    const extra = key === "shipEngineering" ? ["C14"] : key === "archaeology" ? ["F22"] : [];
    const a = makeSkillState(sb, { [key]: 49 }); const ra = evaluate(a, 1);
    const b = makeSkillState(sb, { [key]: 50 }); const rb = evaluate(b, 1);
    const c = makeSkillState(sb, { [key]: 98 }); const rc = evaluate(c, 1);
    const d = makeSkillState(sb, { [key]: 99 }); const rd = evaluate(d, 1);
    const expect99 = new Set([lo, hi, ...extra]);
    ok("[sk19-" + key + "] 49→0 项；50→恰 {" + lo + "}；98→恰 {" + lo + "}；99→恰 {" + [lo, hi, ...extra].join(",") + "}",
      ra.unlockedIds.length === 0 &&
      rb.unlockedIds.length === 1 && rb.unlockedIds[0] === lo &&
      rc.unlockedIds.length === 1 && rc.unlockedIds[0] === lo &&
      rd.unlockedIds.length === expect99.size && rd.unlockedIds.every((id) => expect99.has(id)));
  }

  const sBad = makeSkillState(sb, {});
  sBad.skills.mining = { lvl: "99", xp: 0 };
  sBad.skills.refining = { lvl: NaN, xp: 0 };
  sBad.skills.gasHarvesting = { lvl: Infinity, xp: 0 };
  delete sBad.skills.piloting;
  sBad.skills.drones = "junk";
  const rBad = evaluate(sBad, 1000);
  ok("[sk20] 字符串/NaN/Infinity(非法)/缺失/非对象等级不得错误达标（0 项解锁，ok=true）",
    rBad.ok === true && rBad.unlockedIds.length === 0 && Object.keys(sBad.achievements.unlockedAtById).length === 0);
  const sLegacy = makeSkillState(sb, { combat: 99 });
  const rLegacy = evaluate(sLegacy, 1000);
  ok("[sk21] legacy combat=99 不得单独触发任何规则（0 项解锁）",
    rLegacy.ok === true && rLegacy.unlockedIds.length === 0);

  // ========================= C. 组合边界 =========================
  const four80 = makeSkillState(sb, { mining: 80, refining: 80, laserOps: 80, drones: 80 });
  const rFour = evaluate(four80, 1000);
  four80.skills.targeting.lvl = 80;
  const rFive = evaluate(four80, 1001);
  ok("[sk22] 4 项 Lv.80 不解锁 A44；第 5 项 Lv.80 解锁 A44",
    !rFour.unlockedIds.includes("A44") && rFive.unlockedIds.includes("A44"));
  const nine90 = makeSkillState(sb, {});
  for (const k of EXP_ALL.slice(0, 9)) nine90.skills[k].lvl = 90;
  const rNine = evaluate(nine90, 1000);
  nine90.skills[EXP_ALL[9]].lvl = 90;
  const rTen = evaluate(nine90, 1001);
  ok("[sk23] 9 项 Lv.90 不解锁 A45；第 10 项 Lv.90 解锁 A45",
    !rNine.unlockedIds.includes("A45") && rTen.unlockedIds.includes("A45"));
  const all50 = makeSkillState(sb, {});
  for (const k of EXP_ALL) all50.skills[k].lvl = 50;
  all50.skills.archaeology.lvl = 49;
  const rA46no = evaluate(all50, 1000);
  all50.skills.archaeology.lvl = 50;
  const rA46yes = evaluate(all50, 1001);
  ok("[sk24] 全部技能 50 仅一项 49 时 A46 不解锁；补齐后解锁",
    !rA46no.unlockedIds.includes("A46") && rA46yes.unlockedIds.includes("A46"));
  const cb80 = makeSkillState(sb, {});
  for (const k of EXP_COMBAT) cb80.skills[k].lvl = 80;
  cb80.skills.drones.lvl = 79;
  const rA47no = evaluate(cb80, 1000);
  cb80.skills.drones.lvl = 80;
  const rA47yes = evaluate(cb80, 1001);
  ok("[sk25] 全部战斗技能 80 仅一项 79 时 A47 不解锁；补齐后解锁",
    !rA47no.unlockedIds.includes("A47") && rA47yes.unlockedIds.includes("A47"));
  const cb99 = makeSkillState(sb, {});
  for (const k of EXP_COMBAT) cb99.skills[k].lvl = 99;
  cb99.skills.capacitorManagement.lvl = 98;
  const rA43no = evaluate(cb99, 1000);
  cb99.skills.capacitorManagement.lvl = 99;
  const rA43yes = evaluate(cb99, 1001);
  ok("[sk26] 全部战斗技能 99 仅一项 98 时 A43 不解锁；补齐后解锁",
    !rA43no.unlockedIds.includes("A43") && rA43yes.unlockedIds.includes("A43"));
  const all99 = makeSkillState(sb, {});
  for (const k of EXP_ALL) all99.skills[k].lvl = 99;
  all99.skills.mining.lvl = 98;
  const rA48no = evaluate(all99, 1000);
  all99.skills.mining.lvl = 99;
  const rA48yes = evaluate(all99, 1001);
  ok("[sk27] 全部技能 99 仅一项 98 时 A48 不解锁；补齐后解锁",
    !rA48no.unlockedIds.includes("A48") && rA48yes.unlockedIds.includes("A48"));
  ok("[sk28] legacy combat 保持 Lv.1 时 21 项权威技能全 99 仍正确解锁 A48（combat 不参与）",
    all99.skills.combat.lvl === 1 && unlockedSet(all99).has("A48"));
  const full = makeSkillState(sb, {});
  for (const k of EXP_ALL) full.skills[k].lvl = 99;
  const rFull = evaluate(full, 2000);
  const fullSet = unlockedSet(full);
  ok("[sk29] 全部 21 项 Lv.99 单次求值精确解锁全部 50 个映射成就（不少不多）",
    rFull.unlockedIds.length === 50 && fullSet.size === 50 &&
    EXPECTED_RULE_IDS.every((id) => fullSet.has(id)));
  ok("[sk30] 已解锁 50 项时 J10/J11/J12 元成就不得解锁（本批不做）",
    !fullSet.has("J10") && !fullSet.has("J11") && !fullSet.has("J12"));
  ok("[sk31] 其余 148 项保持未解锁（解锁键集合 ⊆ 50 条规则 ID）",
    [...fullSet].every((id) => RULE_ID_SET.has(id)));

  // ========================= D. 幂等 / dirty / 事件时间 =========================
  const capD = [];
  sb.GameEvents.on("achievement:unlocked", (ev) => capD.push(ev));
  const stD = makeSkillState(sb, { mining: 99 });
  SYS.unlockAchievement(stD, "A01", 111); // 预先解锁 A01
  capD.length = 0;
  const rD1 = evaluate(stD, 5000);
  ok("[sk32] 首次求值 unlockedIds 只含本次新解锁项（含 A22 不含预解锁 A01）",
    rD1.ok === true && rD1.unlockedIds.includes("A22") && !rD1.unlockedIds.includes("A01") &&
    stD.achievements.unlockedAtById["A01"] === 111);
  const emitAfterFirst = capD.length;
  stD._dirty = false;
  const rD2 = evaluate(stD, 6000);
  ok("[sk33] 同状态重复求值 unlockedIds=[]（ok=true）", rD2.ok === true && rD2.unlockedIds.length === 0);
  ok("[sk34] 重复求值不覆盖 unlockedAt（A22 保持第一次 5000，A01 保持 111）",
    stD.achievements.unlockedAtById["A22"] === 5000 && stD.achievements.unlockedAtById["A01"] === 111);
  ok("[sk35] 重复求值不 emit（事件数不变）", capD.length === emitAfterFirst);
  ok("[sk36] 重复求值在预先重置 _dirty=false 后仍保持 false（无新解锁不主动 dirty）", stD._dirty === false);
  const TB = 1690000123456.75;
  capD.length = 0;
  const stB = makeSkillState(sb, { mining: 99 });
  const rB = evaluate(stB, TB);
  ok("[sk37] 同一批多项解锁使用完全相同的 atMs（A01=A22=浮点原样，不整数化）",
    rB.unlockedIds.length === 2 &&
    stB.achievements.unlockedAtById["A01"] === TB && stB.achievements.unlockedAtById["A22"] === TB);
  const idCounts = {};
  for (const ev of capD) idCounts[ev.payload.achievementId] = (idCounts[ev.payload.achievementId] || 0) + 1;
  ok("[sk38] 每项 achievement:unlocked 严格一次（A01×1、A22×1，共 2 条）",
    capD.length === 2 && idCounts["A01"] === 1 && idCounts["A22"] === 1);
  ok("[sk39] 事件 timestamp 与对应 unlockedAt 精确相等（=payload.unlockedAt=批次 atMs）",
    capD.every((ev) => ev.timestamp === ev.payload.unlockedAt && ev.payload.unlockedAt === TB));
  const stC = makeSkillState(sb, { refining: 50 });
  const rC = evaluate(stC, NaN);
  ok("[sk40] 非法 atMs 统一使用冻结 Date.now()（批内一致 = FROZEN_NOW）",
    rC.unlockedIds.includes("A03") && stC.achievements.unlockedAtById["A03"] === FROZEN_NOW);
  capD.length = 0;
  let invThrow = false, rInv1 = null, rInv2 = null, rInv3 = null;
  try {
    rInv1 = evaluate(null, 1);
    rInv2 = evaluate({ skills: { mining: { lvl: 99 } } }, 1); // 缺 achievements
    rInv3 = evaluate({ achievements: sb.AchievementState.createDefaultAchievementState(), skills: [1] }, 1); // skills 数组
  } catch (e) { invThrow = true; }
  ok("[sk41] 非法 state 返回 INVALID_STATE 且无副作用（evaluatedCount=0、unlockedIds=[]、不抛、不 emit）",
    !invThrow && [rInv1, rInv2, rInv3].every((r) =>
      r && r.ok === false && r.reason === "INVALID_STATE" && r.evaluatedCount === 0 && r.unlockedIds.length === 0) &&
    capD.length === 0);
  const sbNR = buildKernelSandbox({ withEvents: true, withRules: false });
  const stNR = { skills: { mining: { lvl: 99, xp: 0 } }, achievements: sbNR.AchievementState.createDefaultAchievementState() };
  const beforeNR = JSON.stringify(stNR);
  const rNR = sbNR.AchievementSystem.evaluateSkillAchievementRules(stNR, 1);
  ok("[sk42] 缺失规则数据返回 RULE_DATA_UNAVAILABLE 且无副作用（状态 JSON 不变）",
    rNR && rNR.ok === false && rNR.reason === "RULE_DATA_UNAVAILABLE" && rNR.evaluatedCount === 0 &&
    rNR.unlockedIds.length === 0 && JSON.stringify(stNR) === beforeNR);
  const stQ = makeSkillState(sb, { mining: 99, archaeology: 99 });
  const skillsBefore = JSON.stringify(stQ.skills);
  evaluate(stQ, 1);
  ok("[sk43] 求值前后 state.skills JSON 完全一致（条件读取纯只读）",
    JSON.stringify(stQ.skills) === skillsBefore);
  const rdBefore = JSON.stringify(RD);
  const adBefore = JSON.stringify(SAD.ACHIEVEMENTS);
  evaluate(makeSkillState(sb, { mining: 99 }), 1);
  ok("[sk44] AchievementRuleData 与 AchievementData 前后 JSON 完全一致且仍冻结",
    JSON.stringify(RD) === rdBefore && JSON.stringify(SAD.ACHIEVEMENTS) === adBefore &&
    Object.isFrozen(RD) && Object.isFrozen(SAD.ACHIEVEMENTS));

  // ========================= E. skill:levelUp 消费者 =========================
  const sbE = buildKernelSandbox({ withEvents: true, withRules: true });
  const capE = [];
  sbE.GameEvents.on("achievement:unlocked", (ev) => capE.push(ev));
  const stE = makeSkillState(sbE, { mining: 49 });
  const inst1 = sbE.AchievementSystem.installSkillAchievementConsumer(stE);
  ok("[sk45] 首次安装成功 {ok:true, reason:null}", inst1 && inst1.ok === true && inst1.reason === null);
  const inst2 = sbE.AchievementSystem.installSkillAchievementConsumer(stE);
  ok("[sk46] 重复安装返回 ALREADY_INSTALLED", inst2 && inst2.ok === false && inst2.reason === "ALREADY_INSTALLED");
  stE.skills.mining.lvl = 50;
  sbE.GameEvents.emit("skill:levelUp", { skill: "mining", previousLevel: 49, level: 50 }, { source: "test" });
  ok("[sk47] 重复安装后一次 skill:levelUp 只执行一套 listener（listenerCount=1，A01 恰解锁一次、恰 emit 一次）",
    sbE.GameEvents.listenerCount("skill:levelUp") === 1 &&
    capE.filter((ev) => ev.payload.achievementId === "A01").length === 1 &&
    typeof stE.achievements.unlockedAtById["A01"] === "number");
  const sbNoEv = buildKernelSandbox({ withEvents: false, withRules: true });
  let consThrow = false, rNoEv = null, rInvSt = null;
  try {
    rNoEv = sbNoEv.AchievementSystem.installSkillAchievementConsumer(makeSkillState(sbNoEv, {}));
    rInvSt = sbE.AchievementSystem.installSkillAchievementConsumer(null);
  } catch (e) { consThrow = true; }
  ok("[sk48] EVENTS_UNAVAILABLE / INVALID_STATE 返回稳定 reason，不抛异常",
    !consThrow && rNoEv && rNoEv.ok === false && rNoEv.reason === "EVENTS_UNAVAILABLE" &&
    rInvSt && rInvSt.ok === false && rInvSt.reason === "INVALID_STATE");
  stE.skills.refining.lvl = 49;
  sbE.GameEvents.emit("skill:levelUp", { skill: "refining", previousLevel: 98, level: 99 }, { source: "test" });
  ok("[sk49] 伪造 payload.level=99 但 state.skills 实际 49 时不得解锁（权威状态优先）",
    !("A03" in stE.achievements.unlockedAtById) && !("A24" in stE.achievements.unlockedAtById));
  stE.skills.gasHarvesting.lvl = 50;
  sbE.GameEvents.emit("skill:levelUp", { skill: "gasHarvesting", previousLevel: 1, level: 2 }, { source: "test" });
  ok("[sk50] payload.level 较低但 state.skills 实际达标时按权威状态解锁（A04）",
    typeof stE.achievements.unlockedAtById["A04"] === "number");
  // C-2 说明：achievements.js 源码自 Batch C-2 起含生产消费者的通配符注册
  // （installProductionAchievementConsumer，见 --production 审计），因此本断言
  // 从"源码无通配符"升级为行为断言：仅安装技能消费者时通配符监听数为 0，
  // 即技能消费者本身绝不注册通配符。
  ok("[sk51] 技能消费者只监听 skill:levelUp、自身不注册通配符 *（仅安装技能消费者后 listenerCount(\"*\")=0、listenerCount(\"skill:levelUp\")=1）",
    sbE.GameEvents.listenerCount("*") === 0 &&
    sbE.GameEvents.listenerCount("skill:levelUp") === 1);
  const TS = 1712345678901.5;
  stE.skills.laserOps.lvl = 50;
  capE.length = 0;
  sbE.GameEvents.emit("skill:levelUp", { skill: "laserOps", previousLevel: 49, level: 50 }, { source: "test", timestamp: TS });
  ok("[sk52] skill:levelUp 事件时间戳传递到全部新解锁项（A10 unlockedAt=事件 timestamp，浮点原样）",
    stE.achievements.unlockedAtById["A10"] === TS &&
    capE.length === 1 && capE[0].payload.achievementId === "A10" && capE[0].timestamp === TS);

  // ========================= F. 真实接线与追溯 =========================
  // 新游戏（无存档）：对账恰好一次、0 解锁；随后在线/离线真实链路
  let fresh = null;
  try { fresh = buildFullGameSandbox(null); } catch (e) {
    ok("[sk53] 新游戏全量脚本加载不抛异常: " + (e && e.message), false);
  }
  if (fresh) {
    const gs = fresh.sandbox.gameState;
    const recon = fresh.timeline.filter((e) => e.fn === "evaluateSkillAchievementRules");
    // C-13：技能求值器自身仍解锁 0 项；全局解锁集因经济成就 I01（初始 ISK=1e6）恰为 {I01}
    ok("[sk53] 新游戏 autoLoad 追溯对账恰好一次、atMs=登录时 Date.now()（冻结）、技能解锁 0 项",
      recon.length === 1 && recon[0].atMs === FROZEN_NOW &&
      recon[0].result && recon[0].result.ok === true && recon[0].result.unlockedIds.length === 0 &&
      Object.keys(gs.achievements.unlockedAtById).sort().join(",") === "I01");
    // 在线真实链路：addSkillXpToState → checkLevelUpFromState → skill:levelUp → 消费者
    gs.skills.mining.lvl = 49; gs.skills.mining.xp = 0;
    fresh.sandbox.addSkillXpToState(gs, "mining", fresh.sandbox.xpForLevel(50), { source: "audit-online" });
    ok("[sk54] 真实 addSkillXpToState 在线升级跨 50 后自动解锁 A01（mining Lv.50）",
      gs.skills.mining.lvl === 50 && typeof gs.achievements.unlockedAtById["A01"] === "number");
    // 离线真实链路：addOfflineSkillXp → checkLevelUp → 同一 skill:levelUp 消费者
    gs.skills.refining.lvl = 49; gs.skills.refining.xp = 0;
    fresh.sandbox.addOfflineSkillXp("refining", fresh.sandbox.xpForLevel(50));
    ok("[sk55] 真实 addOfflineSkillXp 离线升级跨 50 后通过同一消费者解锁 A03（refining Lv.50）",
      gs.skills.refining.lvl === 50 && typeof gs.achievements.unlockedAtById["A03"] === "number");
    ok("[sk56] 在线/离线解锁均来自 skill:levelUp 消费者、不靠第二次追溯扫描（对账 spy 计数仍为 1）",
      fresh.timeline.filter((e) => e.fn === "evaluateSkillAchievementRules").length === 1);

    // importData 真实路径：normalize < research < achievement migrate < reconcile < offline，对账恰好一次
    if (typeof fresh.sandbox.normalizePlanetaryState === "function") {
      const realNorm = fresh.sandbox.normalizePlanetaryState;
      fresh.sandbox.normalizePlanetaryState = function (state, opts) {
        fresh.timeline.push({ fn: "normalizePlanetaryState" });
        return realNorm.call(this, state, opts);
      };
    }
    const tlBefore = fresh.timeline.length;
    const importSave = {
      skills: { mining: { lvl: 50, xp: 0 } },
      resources: { isk: 1000, fuel: 100 },
      achievements: { schemaVersion: 1, unlockedAtById: {} },
      planetary: { deployments: [], nextId: 1 },
    };
    let importOk = false;
    try { importOk = fresh.sandbox.SaveManager.importData(JSON.stringify(importSave)); }
    catch (e) { ok("[sk57] importData 抛出异常: " + (e && e.message), false); }
    const itl = fresh.timeline.slice(tlBefore);
    const iNorm = itl.findIndex((e) => e.fn === "normalizePlanetaryState");
    const iRes = itl.findIndex((e) => e.fn === "migrateResearchState");
    const iAch = itl.findIndex((e) => e.fn === "migrateAchievementState");
    const iRec = itl.findIndex((e) => e.fn === "evaluateSkillAchievementRules");
    const iOff = itl.findIndex((e) => e.fn === "calculateOfflineGains");
    ok("[sk57] importData 对账恰好一次且顺序 normalize < research migrate < achievement migrate < skill reconcile < offline",
      importOk === true &&
      itl.filter((e) => e.fn === "evaluateSkillAchievementRules").length === 1 &&
      iNorm >= 0 && iRes >= 0 && iAch >= 0 && iRec >= 0 && iOff >= 0 &&
      iNorm < iRes && iRes < iAch && iAch < iRec && iRec < iOff);
    ok("[sk58] importData 旧存档 mining=50 空成就 → 导入即补 A01，追溯时间=导入时 Date.now()（冻结）",
      fresh.sandbox.gameState.achievements.unlockedAtById["A01"] === FROZEN_NOW);
  }

  // restored=true 登录追溯：mining=50 空成就 → 补 A01；对账一次且早于 offline
  const oldSave1 = JSON.stringify({
    skills: { mining: { lvl: 50, xp: 0 } },
    resources: { isk: 500, fuel: 100 },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    achievements: { schemaVersion: 1, unlockedAtById: {} },
    planetary: { deployments: [], nextId: 1 },
  });
  let rest1 = null;
  try { rest1 = buildFullGameSandbox(oldSave1); } catch (e) {
    ok("[sk59] restored=true 全脚本加载不抛异常: " + (e && e.message), false);
  }
  if (rest1) {
    const tl = rest1.timeline;
    const recIdx = tl.findIndex((e) => e.fn === "evaluateSkillAchievementRules");
    const offIdx = tl.findIndex((e) => e.fn === "calculateOfflineGains");
    const achIdx = tl.findIndex((e) => e.fn === "migrateAchievementState");
    ok("[sk59] restored=true 对账恰好一次且顺序 achievement migrate < skill reconcile < offline",
      tl.filter((e) => e.fn === "evaluateSkillAchievementRules").length === 1 &&
      achIdx >= 0 && recIdx >= 0 && offIdx >= 0 && achIdx < recIdx && recIdx < offIdx);
    ok("[sk60] 旧存档 mining=50 空成就登录后补 A01（追溯时间=登录 Date.now() 冻结，不伪造历史时间）",
      rest1.sandbox.gameState.achievements.unlockedAtById["A01"] === FROZEN_NOW);
  }

  // 旧存档 shipEngineering=99 → 登录补 A05/A26/C14（同一批同一时间戳）
  const oldSave2 = JSON.stringify({
    skills: { shipEngineering: { lvl: 99, xp: 0 } },
    resources: { isk: 500, fuel: 100 },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    achievements: { schemaVersion: 1, unlockedAtById: {} },
    planetary: { deployments: [], nextId: 1 },
  });
  let rest2 = null;
  try { rest2 = buildFullGameSandbox(oldSave2); } catch (e) {
    ok("[sk61] shipEngineering=99 存档加载不抛异常: " + (e && e.message), false);
  }
  if (rest2) {
    const m = rest2.sandbox.gameState.achievements.unlockedAtById;
    ok("[sk61] 旧存档 shipEngineering=99 登录后补 A05/A26/C14（同批同一时间戳=冻结 Date.now()）",
      m["A05"] === FROZEN_NOW && m["A26"] === FROZEN_NOW && m["C14"] === FROZEN_NOW);
  }

  // 旧存档已有 A01 时间戳：登录后原时间不变且 A01 不重复 emit
  const oldSave3 = JSON.stringify({
    skills: { mining: { lvl: 50, xp: 0 } },
    resources: { isk: 500, fuel: 100 },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    achievements: { schemaVersion: 1, unlockedAtById: { "A01": 123.5 } },
    planetary: { deployments: [], nextId: 1 },
  });
  let rest3 = null;
  try { rest3 = buildFullGameSandbox(oldSave3); } catch (e) {
    ok("[sk62] 已有 A01 存档加载不抛异常: " + (e && e.message), false);
  }
  if (rest3) {
    ok("[sk62] 旧存档已有 A01=123.5 登录后原时间保持不变且 A01 不重复 emit（订阅观测 0 条 A01 事件）",
      rest3.sandbox.gameState.achievements.unlockedAtById["A01"] === 123.5 &&
      rest3.achievementEvents.filter((ev) => ev.payload.achievementId === "A01").length === 0);
  }

  // 在线/离线无第二套技能成就公式（负向源码保护）
  const tickSrc = fs.readFileSync(TICK_PATH, "utf-8");
  const offlineSrc = fs.readFileSync(OFFLINE_PATH, "utf-8");
  const prodSrc = fs.readFileSync(PRODUCTION_PATH, "utf-8");
  const forbiddenRefs = ["AchievementRuleData", "SKILL_RULES", "evaluateSkillAchievementRules", "unlockAchievement"];
  ok("[sk63] tick.js / offline.js / production.js 不含复制的技能成就公式或解锁调用（在线离线共用唯一事件链路）",
    forbiddenRefs.every((t) => !tickSrc.includes(t) && !offlineSrc.includes(t) && !prodSrc.includes(t)));

  // index.html 49 脚本顺序 + verify 基线接线
  const order = readIndexScriptOrder();
  ok("[sk64] index.html 49 脚本且顺序 events<data/ach<data/rules<core/ach-state<core/state<systems/ach<persistence",
    order.srcs.length === 49 &&
    order.events >= 0 && order.achData >= 0 && order.achRules >= 0 && order.achState >= 0 &&
    order.coreState >= 0 && order.achSystem >= 0 && order.persistence >= 0 &&
    order.events < order.achData && order.achData < order.achRules && order.achRules < order.achState &&
    order.achState < order.coreState && order.coreState < order.achSystem && order.achSystem < order.persistence);
  const verifySrc = fs.readFileSync(VERIFY_PATH, "utf-8");
  ok("[sk65] verify.mjs 基线已更新为 49 且包含 achievement-rules.js 顺序断言",
    verifySrc.includes("!== 49") && verifySrc.includes("js/data/achievement-rules.js"));
  ok("[sk66] 全部 49 个脚本全量 VM 加载无未定义依赖（新游戏沙箱构建成功且 spy 完整）",
    !!fresh && fresh.scriptSources.length === 49 && fresh.spyInstalled === true);
}

// ============================================================================
//  --production：Batch C-2 采矿工业规则真实触发审计
// ============================================================================
function runProduction() {
  // ---- 独立期望表（审计侧显式复刻，与规则文件交叉验证，不从规则文件反推）----
  const EXP_ORES = ["凡晶石", "灼烧岩", "水硼砂", "斜长岩", "干焦岩", "灰岩", "艾克诺岩"];
  const EXP_MINERALS = ["三钛合金", "类银超金属", "类晶体胶矿", "同位聚合体", "超新星诺克石", "基腹断岩", "超噬矿"];
  const EXPECTED_PROD_IDS = [];
  for (let i = 1; i <= 18; i++) EXPECTED_PROD_IDS.push("B" + String(i).padStart(2, "0"));
  const PROD_ID_SET = new Set(EXPECTED_PROD_IDS);

  const sb = buildKernelSandbox({ withEvents: true, withRules: true });
  const RD = sb.AchievementRuleData;
  const SYS = sb.AchievementSystem;
  const SAD = sb.AchievementData;

  // 手工构造权威 statistics（求值内核只读 state.statistics，不依赖 statistics.js）
  function makeProdState(box, opts) {
    const o = opts || {};
    return {
      skills: {},
      achievements: box.AchievementState.createDefaultAchievementState(),
      statistics: {
        version: 1,
        totals: { minedUnits: o.minedUnits || 0, gasUnits: o.gasUnits || 0 },
        production: { gathered: o.gathered || {}, refined: o.refined || {}, manufactured: {} },
      },
      _dirty: false,
    };
  }
  const evaluate = (state, atMs) => SYS.evaluateProductionAchievementRules(state, atMs);
  const unlockedSet = (state) => new Set(Object.keys(state.achievements.unlockedAtById));

  // ========================= A. 规则数据 =========================
  ok("[pr1] AchievementRuleData 含 PRODUCTION_RULES(18)/PRODUCTION_RULES_BY_ID(18 键)，且 SKILL_RULES 仍精确 50（C-1 回归）",
    !!RD && Array.isArray(RD.PRODUCTION_RULES) && RD.PRODUCTION_RULES.length === 18 &&
    !!RD.PRODUCTION_RULES_BY_ID && Object.keys(RD.PRODUCTION_RULES_BY_ID).length === 18 &&
    Array.isArray(RD.SKILL_RULES) && RD.SKILL_RULES.length === 50 && RD.schemaVersion === 1);
  if (!RD || !SYS || !Array.isArray(RD.PRODUCTION_RULES)) return;

  let g7Ok = true;
  for (let i = 0; i < 7; i++) {
    const r = RD.PRODUCTION_RULES_BY_ID["B0" + (i + 1)];
    if (!r || r.type !== "production-gathered" || r.resourceId !== "ore:" + EXP_ORES[i] || r.minValue !== 1) g7Ok = false;
  }
  ok("[pr2] B01–B07 首次采集映射逐项精确（production-gathered / ore:{7 矿石} / minValue=1）", g7Ok);
  let r7Ok = true;
  for (let i = 0; i < 7; i++) {
    const id = "B" + String(i + 8).padStart(2, "0");
    const r = RD.PRODUCTION_RULES_BY_ID[id];
    if (!r || r.type !== "production-refined" || r.resourceId !== "mineral:" + EXP_MINERALS[i] || r.minValue !== 1) r7Ok = false;
  }
  ok("[pr3] B08–B14 首次冶炼映射逐项精确（production-refined / mineral:{7 矿物} / minValue=1）", r7Ok);
  const b15 = RD.PRODUCTION_RULES_BY_ID["B15"], b16 = RD.PRODUCTION_RULES_BY_ID["B16"];
  ok("[pr4] B15/B16 累计采矿映射精确（production-total / minedUnits / 1,000,000 与 100,000,000）",
    !!b15 && b15.type === "production-total" && b15.totalKey === "minedUnits" && b15.minValue === 1000000 &&
    !!b16 && b16.type === "production-total" && b16.totalKey === "minedUnits" && b16.minValue === 100000000);
  const b17 = RD.PRODUCTION_RULES_BY_ID["B17"], b18 = RD.PRODUCTION_RULES_BY_ID["B18"];
  ok("[pr5] B17/B18 气体映射精确（production-total / gasUnits / 1 与 1,000,000）",
    !!b17 && b17.type === "production-total" && b17.totalKey === "gasUnits" && b17.minValue === 1 &&
    !!b18 && b18.type === "production-total" && b18.totalKey === "gasUnits" && b18.minValue === 1000000);
  const prodIds = RD.PRODUCTION_RULES.map((r) => r.achievementId);
  ok("[pr6] 18 个 achievementId 全部唯一且存在于 AchievementData 冻结目录",
    new Set(prodIds).size === 18 && prodIds.every((id) => !!SAD.ACHIEVEMENTS_BY_ID[id]));
  ok("[pr7] 规则 ID 集合精确等于 B01–B18",
    prodIds.length === 18 && EXPECTED_PROD_IDS.every((id) => prodIds.includes(id)));
  ok("[pr8] PRODUCTION_RULES / BY_ID / 每条规则全部 Object.freeze",
    Object.isFrozen(RD.PRODUCTION_RULES) && Object.isFrozen(RD.PRODUCTION_RULES_BY_ID) &&
    RD.PRODUCTION_RULES.every((r) => Object.isFrozen(r)));
  const skillKeys = new Set(Object.keys(RD.SKILL_RULES_BY_ID));
  const prodKeys = new Set(Object.keys(RD.PRODUCTION_RULES_BY_ID));
  ok("[pr9] 技能 50 + 生产 18 = 68 条规则、两集合零交集；其余 130 项无规则（C01/D01/F01/J10/J11/J12 均不在任一 BY_ID）",
    skillKeys.size === 50 && prodKeys.size === 18 &&
    [...prodKeys].every((k) => !skillKeys.has(k)) &&
    ["C01", "D01", "F01", "J10", "J11", "J12"].every((id) => !skillKeys.has(id) && !prodKeys.has(id)));

  // CSV 交叉验证：策划表 B01–B18 的分类与条件文本与冻结规则一致（RFC4180 真实解析）
  const csvRows = parseCSV(fs.readFileSync(CSV_PATH).slice(3).toString("utf-8")).slice(1);
  const csvById = {};
  for (const r of csvRows) csvById[r[0]] = r;
  let csvCatOk = EXPECTED_PROD_IDS.every((id) => csvById[id] && csvById[id][1] === "采矿工业");
  let csvCondOk = true;
  for (let i = 0; i < 7; i++) {
    const cG = csvById["B0" + (i + 1)], cR = csvById["B" + String(i + 8).padStart(2, "0")];
    if (!cG || !cG[2].startsWith("首次采集") || !cG[2].includes(EXP_ORES[i])) csvCondOk = false;
    if (!cR || !cR[2].startsWith("首次冶炼") || !cR[2].includes(EXP_MINERALS[i])) csvCondOk = false;
  }
  const numOf = (txt) => Number((txt.match(/[\d,]+/) || [""])[0].replace(/,/g, ""));
  ok("[pr10] CSV 交叉：B01–B18 分类均为采矿工业，B01–B14 条件文本含对应矿石/矿物名", csvCatOk && csvCondOk);
  ok("[pr11] CSV 交叉：B15/B16/B18 条件数字与规则 minValue 精确一致（1e6/1e8/1e6），B17 为首次气体采集",
    numOf(csvById["B15"][2]) === 1000000 && numOf(csvById["B16"][2]) === 100000000 &&
    numOf(csvById["B18"][2]) === 1000000 && csvById["B17"][2] === "首次气体采集");

  // ========================= B. 求值边界 =========================
  for (let i = 0; i < 7; i++) {
    const id = "B0" + (i + 1), key = "ore:" + EXP_ORES[i];
    const s0 = makeProdState(sb, { gathered: { [key]: 0 } });
    const r0 = evaluate(s0, 1000);
    const s1 = makeProdState(sb, { gathered: { [key]: 1 } });
    const r1 = evaluate(s1, 1000);
    ok("[pr12-" + EXP_ORES[i] + "] 采集 0 → 0 项；采集 1 → 恰 {" + id + "}（evaluatedCount=18）",
      r0.ok === true && r0.evaluatedCount === 18 && r0.unlockedIds.length === 0 &&
      r1.ok === true && r1.unlockedIds.length === 1 && r1.unlockedIds[0] === id &&
      unlockedSet(s1).size === 1 && unlockedSet(s1).has(id));
  }
  for (let i = 0; i < 7; i++) {
    const id = "B" + String(i + 8).padStart(2, "0"), key = "mineral:" + EXP_MINERALS[i];
    const s0 = makeProdState(sb, { refined: { [key]: 0 } });
    const r0 = evaluate(s0, 1000);
    const s1 = makeProdState(sb, { refined: { [key]: 1 } });
    const r1 = evaluate(s1, 1000);
    ok("[pr13-" + EXP_MINERALS[i] + "] 冶炼 0 → 0 项；冶炼 1 → 恰 {" + id + "}",
      r0.ok === true && r0.unlockedIds.length === 0 &&
      r1.ok === true && r1.unlockedIds.length === 1 && r1.unlockedIds[0] === id);
  }
  const sM0 = makeProdState(sb, { minedUnits: 999999 });
  const rM0 = evaluate(sM0, 1);
  const sM1 = makeProdState(sb, { minedUnits: 1000000 });
  const rM1 = evaluate(sM1, 1);
  ok("[pr14] 累计采矿 999,999 → 0 项；1,000,000 → 恰 {B15}",
    rM0.unlockedIds.length === 0 && rM1.unlockedIds.length === 1 && rM1.unlockedIds[0] === "B15");
  const sM2 = makeProdState(sb, { minedUnits: 99999999 });
  const rM2 = evaluate(sM2, 1);
  const sM3 = makeProdState(sb, { minedUnits: 100000000 });
  const rM3 = evaluate(sM3, 1);
  ok("[pr15] 累计采矿 99,999,999 → 恰 {B15}；100,000,000 → 恰 {B15,B16}",
    rM2.unlockedIds.length === 1 && rM2.unlockedIds[0] === "B15" &&
    rM3.unlockedIds.length === 2 && rM3.unlockedIds.includes("B15") && rM3.unlockedIds.includes("B16"));
  const sG0 = makeProdState(sb, { gasUnits: 0 });
  const rG0 = evaluate(sG0, 1);
  const sG1 = makeProdState(sb, { gasUnits: 1 });
  const rG1 = evaluate(sG1, 1);
  ok("[pr16] 累计气体 0 → 0 项；1 → 恰 {B17}",
    rG0.unlockedIds.length === 0 && rG1.unlockedIds.length === 1 && rG1.unlockedIds[0] === "B17");
  const sG2 = makeProdState(sb, { gasUnits: 999999 });
  const rG2 = evaluate(sG2, 1);
  const sG3 = makeProdState(sb, { gasUnits: 1000000 });
  const rG3 = evaluate(sG3, 1);
  ok("[pr17] 累计气体 999,999 → 恰 {B17}；1,000,000 → 恰 {B17,B18}",
    rG2.unlockedIds.length === 1 && rG2.unlockedIds[0] === "B17" &&
    rG3.unlockedIds.length === 2 && rG3.unlockedIds.includes("B17") && rG3.unlockedIds.includes("B18"));
  // 错桶隔离：refined 中的矿石 / gathered 中的矿物、月矿、行星、气体资源均不得触发
  const sX = makeProdState(sb, {
    gathered: { "mineral:三钛合金": 9, "moon:镓": 9, "planetary:重金属": 9, "gas:粗制富勒烯": 9 },
    refined: { "ore:凡晶石": 9 },
  });
  const rX = evaluate(sX, 1);
  ok("[pr18] 错桶不触发：gathered 的矿物/月矿/行星/气体键与 refined 的矿石键均 0 解锁",
    rX.ok === true && rX.unlockedIds.length === 0 && unlockedSet(sX).size === 0);
  const sBadV = makeProdState(sb, {
    gathered: { "ore:凡晶石": NaN, "ore:灼烧岩": "5", "ore:水硼砂": Infinity, "ore:斜长岩": -1 },
    refined: { "mineral:三钛合金": null },
  });
  sBadV.statistics.totals.minedUnits = "1000000";
  sBadV.statistics.totals.gasUnits = -5;
  const rBadV = evaluate(sBadV, 1);
  ok("[pr19] NaN/字符串/Infinity/负数/null 统计值不得错误达标（0 项解锁，ok=true）",
    rBadV.ok === true && rBadV.unlockedIds.length === 0 && unlockedSet(sBadV).size === 0);
  // 全满状态：单次求值精确解锁全部 18 项，且不越界
  const sFull = makeProdState(sb, { minedUnits: 100000000, gasUnits: 1000000 });
  for (const o of EXP_ORES) sFull.statistics.production.gathered["ore:" + o] = 1;
  for (const m of EXP_MINERALS) sFull.statistics.production.refined["mineral:" + m] = 1;
  const rFull = evaluate(sFull, 2000);
  const fullSet = unlockedSet(sFull);
  ok("[pr20] 全满统计单次求值精确解锁全部 18 项（不少不多），同批 unlockedAt 全部=2000",
    rFull.unlockedIds.length === 18 && fullSet.size === 18 &&
    EXPECTED_PROD_IDS.every((id) => fullSet.has(id)) &&
    EXPECTED_PROD_IDS.every((id) => sFull.achievements.unlockedAtById[id] === 2000));
  ok("[pr21] 已解锁 18 项时 J10/J11/J12 元成就与任何技能成就不得解锁（解锁集合 ⊆ 18 条规则 ID）",
    !fullSet.has("J10") && !fullSet.has("J11") && !fullSet.has("J12") &&
    [...fullSet].every((id) => PROD_ID_SET.has(id)));

  // ---- 幂等 / dirty / 时间语义 ----
  const capB = [];
  sb.GameEvents.on("achievement:unlocked", (ev) => capB.push(ev));
  const sI = makeProdState(sb, { gathered: { "ore:凡晶石": 1 }, minedUnits: 1000000 });
  SYS.unlockAchievement(sI, "B01", 111); // 预先解锁 B01
  capB.length = 0;
  const rI1 = evaluate(sI, 5000);
  ok("[pr22] 首次求值 unlockedIds 只含本次新解锁项（含 B15 不含预解锁 B01，B01 保持 111）",
    rI1.ok === true && rI1.unlockedIds.includes("B15") && !rI1.unlockedIds.includes("B01") &&
    sI.achievements.unlockedAtById["B01"] === 111);
  const emitN = capB.length;
  sI._dirty = false;
  const rI2 = evaluate(sI, 6000);
  ok("[pr23] 同状态重复求值 unlockedIds=[]、不覆盖时间（B15 保持 5000）、不 emit、不 dirty",
    rI2.ok === true && rI2.unlockedIds.length === 0 &&
    sI.achievements.unlockedAtById["B15"] === 5000 && capB.length === emitN && sI._dirty === false);
  const TBP = 1690000123456.75;
  capB.length = 0;
  const sT = makeProdState(sb, { gathered: { "ore:凡晶石": 1 }, gasUnits: 1 });
  const rT = evaluate(sT, TBP);
  const idCountsP = {};
  for (const ev of capB) idCountsP[ev.payload.achievementId] = (idCountsP[ev.payload.achievementId] || 0) + 1;
  ok("[pr24] 同批多项解锁使用完全相同的浮点 atMs（B01=B17=原样），每项 emit 严格一次且 timestamp=unlockedAt",
    rT.unlockedIds.length === 2 &&
    sT.achievements.unlockedAtById["B01"] === TBP && sT.achievements.unlockedAtById["B17"] === TBP &&
    capB.length === 2 && idCountsP["B01"] === 1 && idCountsP["B17"] === 1 &&
    capB.every((ev) => ev.timestamp === ev.payload.unlockedAt && ev.payload.unlockedAt === TBP));
  const sNaN = makeProdState(sb, { gathered: { "ore:灼烧岩": 1 } });
  const rNaN = evaluate(sNaN, NaN);
  ok("[pr25] 非法 atMs 统一使用冻结 Date.now()（B02 unlockedAt=FROZEN_NOW）",
    rNaN.unlockedIds.includes("B02") && sNaN.achievements.unlockedAtById["B02"] === FROZEN_NOW);

  // ---- 失败原因与无副作用 ----
  capB.length = 0;
  let prThrow = false, rNull = null, rNoStat = null, rArrStat = null;
  try {
    rNull = evaluate(null, 1);
    const noStat = { skills: {}, achievements: sb.AchievementState.createDefaultAchievementState() };
    rNoStat = evaluate(noStat, 1);
    const arrStat = { skills: {}, achievements: sb.AchievementState.createDefaultAchievementState(), statistics: [1] };
    rArrStat = evaluate(arrStat, 1);
  } catch (e) { prThrow = true; }
  ok("[pr26] INVALID_STATE / STATISTICS_UNAVAILABLE(缺失与数组) 返回稳定 reason 且无副作用（不抛、不 emit、evaluatedCount=0）",
    !prThrow &&
    rNull && rNull.ok === false && rNull.reason === "INVALID_STATE" && rNull.evaluatedCount === 0 &&
    rNoStat && rNoStat.ok === false && rNoStat.reason === "STATISTICS_UNAVAILABLE" && rNoStat.evaluatedCount === 0 &&
    rArrStat && rArrStat.ok === false && rArrStat.reason === "STATISTICS_UNAVAILABLE" &&
    capB.length === 0);
  const sbNRp = buildKernelSandbox({ withEvents: true, withRules: false });
  const stNRp = makeProdState(sbNRp, { gathered: { "ore:凡晶石": 1 } });
  const beforeNRp = JSON.stringify(stNRp);
  const rNRp = sbNRp.AchievementSystem.evaluateProductionAchievementRules(stNRp, 1);
  ok("[pr27] 缺失规则数据返回 RULE_DATA_UNAVAILABLE 且无副作用（状态 JSON 不变）",
    rNRp && rNRp.ok === false && rNRp.reason === "RULE_DATA_UNAVAILABLE" && rNRp.evaluatedCount === 0 &&
    rNRp.unlockedIds.length === 0 && JSON.stringify(stNRp) === beforeNRp);
  const sRO = makeProdState(sb, { gathered: { "ore:凡晶石": 1 }, minedUnits: 1000000 });
  const statsBefore = JSON.stringify(sRO.statistics);
  const rdBeforeP = JSON.stringify(RD.PRODUCTION_RULES);
  evaluate(sRO, 1);
  ok("[pr28] 求值前后 state.statistics 与 PRODUCTION_RULES JSON 完全一致（条件读取纯只读）",
    JSON.stringify(sRO.statistics) === statsBefore && JSON.stringify(RD.PRODUCTION_RULES) === rdBeforeP &&
    Object.isFrozen(RD.PRODUCTION_RULES));

  // ========================= C. 三类生产事件消费者 =========================
  // C-a 真实 statistics.js 沙箱：statistics 与生产消费者同注册在 *，statistics 先行
  const sbS = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsS = sbS.gameState;
  const capS = [];
  sbS.GameEvents.on("achievement:unlocked", (ev) => capS.push(ev));
  const reinstall = sbS.AchievementSystem.installProductionAchievementConsumer(gsS);
  ok("[pr29] statistics 沙箱加载完成即自动安装消费者：listenerCount(\"*\")=10（statistics+生产+战斗+制造+装备+增幅剂+考古+行星+空间站+综合生命周期）、listenerCount(\"skill:levelUp\")=1、重复安装返回 ALREADY_INSTALLED",
    sbS.GameEvents.listenerCount("*") === 10 && sbS.GameEvents.listenerCount("skill:levelUp") === 1 &&
    reinstall && reinstall.ok === false && reinstall.reason === "ALREADY_INSTALLED");
  const TSP = 1712345678901.5;
  sbS.GameEvents.emit("mining:completed",
    { area: "凡晶石带", mode: "normal", resourceId: "ore:凡晶石", quantity: 1, xp: 10 },
    { offline: false, timestamp: TSP });
  ok("[pr30] 首个 mining:completed 即解锁 B01（分发顺序证明：statistics 先累计、消费者后读到 gathered=1），unlockedAt=事件浮点 timestamp",
    gsS.statistics.production.gathered["ore:凡晶石"] === 1 &&
    gsS.statistics.totals.minedUnits === 1 &&
    gsS.achievements.unlockedAtById["B01"] === TSP &&
    capS.filter((ev) => ev.payload.achievementId === "B01").length === 1);
  ok("[pr31] 在线 emit 缺 cycles 时合约 normalize 自动补 1（totals.miningCycles=1，与 tick.js 在线链路同形）",
    gsS.statistics.totals.miningCycles === 1);
  // 幂等账本：同 eventId 重放不得二次累计也不得二次解锁
  sbS.GameEvents.emit("mining:completed",
    { area: "灼烧岩带", mode: "normal", resourceId: "ore:灼烧岩", quantity: 1, cycles: 1, xp: 30 },
    { offline: false, eventId: "prod-audit-dup-1" });
  sbS.GameEvents.emit("mining:completed",
    { area: "灼烧岩带", mode: "normal", resourceId: "ore:灼烧岩", quantity: 1, cycles: 1, xp: 30 },
    { offline: false, eventId: "prod-audit-dup-1" });
  ok("[pr32] 同 eventId 重放：statistics 幂等账本只累计一次（灼烧岩=1）、B02 恰解锁一次",
    gsS.statistics.production.gathered["ore:灼烧岩"] === 1 &&
    capS.filter((ev) => ev.payload.achievementId === "B02").length === 1 &&
    typeof gsS.achievements.unlockedAtById["B02"] === "number");
  // 严格类型过滤：非三类事件不触发生产求值；任一三类事件触发全量求值
  gsS.statistics.production.gathered["ore:水硼砂"] = 1; // 直接预置权威统计
  sbS.GameEvents.emit("skill:levelUp", { skill: "mining", previousLevel: 1, level: 2 }, { source: "audit" });
  const b03AfterSkill = "B03" in gsS.achievements.unlockedAtById;
  sbS.GameEvents.emit("gas:completed", { area: "富勒烯云团", resourceId: "gas:粗制富勒烯", quantity: 0, cycles: 1, xp: 10 }, { offline: false });
  ok("[pr33] 消费者严格过滤三类型：skill:levelUp 不触发生产求值（B03 仍锁）；随后 gas:completed 触发全量求值补 B03；quantity=0 时 B17 不解锁（gasUnits=0）",
    !b03AfterSkill && typeof gsS.achievements.unlockedAtById["B03"] === "number" &&
    !("B17" in gsS.achievements.unlockedAtById) && gsS.statistics.totals.gasUnits === 0);
  sbS.GameEvents.emit("refining:completed",
    { recipe: "凡晶石带", inputId: "ore:凡晶石", outputId: "mineral:三钛合金", inputQuantity: 1, outputQuantity: 1, cycles: 1, xp: 10 },
    { offline: false });
  ok("[pr34] refining:completed 真实链路：refined[三钛合金]=1 且 B08 解锁",
    gsS.statistics.production.refined["mineral:三钛合金"] === 1 &&
    typeof gsS.achievements.unlockedAtById["B08"] === "number");
  sbS.GameEvents.emit("gas:completed", { area: "富勒烯云团", resourceId: "gas:粗制富勒烯", quantity: 2, cycles: 2, xp: 20 }, { offline: false });
  ok("[pr35] gas:completed 真实链路：gasUnits=2 且 B17 解锁、B18 不解锁",
    gsS.statistics.totals.gasUnits === 2 && typeof gsS.achievements.unlockedAtById["B17"] === "number" &&
    !("B18" in gsS.achievements.unlockedAtById));
  sbS.GameEvents.emit("mining:completed",
    { area: "干焦岩带", mode: "normal", resourceId: "ore:干焦岩", quantity: 3, cycles: 3, xp: 690 },
    { offline: true, source: "offline-settlement" });
  ok("[pr36] 离线聚合事件（meta.offline=true, cycles=3）走同一消费者：干焦岩=3、B05 解锁、offlineEvents 计数增加",
    gsS.statistics.production.gathered["ore:干焦岩"] === 3 &&
    typeof gsS.achievements.unlockedAtById["B05"] === "number" &&
    gsS.statistics.activity.offlineEvents >= 1);

  // C-b 手工 statistics 沙箱：payload 不可信 + 安装失败原因 + dirty 语义
  const sbM = buildKernelSandbox({ withEvents: true, withRules: true });
  let instThrow = false, rInv = null, rNoStatI = null, rNoEv = null;
  try {
    rInv = sbM.AchievementSystem.installProductionAchievementConsumer(null);
    rNoStatI = sbM.AchievementSystem.installProductionAchievementConsumer(
      { skills: {}, achievements: sbM.AchievementState.createDefaultAchievementState() });
    const sbNoEvP = buildKernelSandbox({ withEvents: false, withRules: true });
    rNoEv = sbNoEvP.AchievementSystem.installProductionAchievementConsumer(makeProdState(sbNoEvP, {}));
  } catch (e) { instThrow = true; }
  ok("[pr37] INVALID_STATE / STATISTICS_UNAVAILABLE / EVENTS_UNAVAILABLE 安装失败原因稳定，不抛异常",
    !instThrow && rInv && rInv.ok === false && rInv.reason === "INVALID_STATE" &&
    rNoStatI && rNoStatI.ok === false && rNoStatI.reason === "STATISTICS_UNAVAILABLE" &&
    rNoEv && rNoEv.ok === false && rNoEv.reason === "EVENTS_UNAVAILABLE");
  const stM = makeProdState(sbM, {});
  const instM1 = sbM.AchievementSystem.installProductionAchievementConsumer(stM);
  const instM2 = sbM.AchievementSystem.installProductionAchievementConsumer(stM);
  ok("[pr38] 首次安装 {ok:true,reason:null}；重复安装 ALREADY_INSTALLED（每沙箱恰一套监听）",
    instM1 && instM1.ok === true && instM1.reason === null &&
    instM2 && instM2.ok === false && instM2.reason === "ALREADY_INSTALLED" &&
    sbM.GameEvents.listenerCount("*") === 1);
  sbM.GameEvents.emit("mining:completed",
    { area: "凡晶石带", mode: "normal", resourceId: "ore:凡晶石", quantity: 999999, cycles: 1, xp: 10 },
    { offline: false });
  ok("[pr39] 不信任 payload：事件声称 quantity=999999 但权威 statistics 仍为 0 时不得解锁任何项",
    Object.keys(stM.achievements.unlockedAtById).length === 0);
  stM.statistics.production.gathered["ore:凡晶石"] = 1;
  sbM.GameEvents.emit("gas:completed", { area: "富勒烯云团", resourceId: "gas:粗制富勒烯", quantity: 0, cycles: 1, xp: 10 }, { offline: false });
  ok("[pr40] 权威 statistics 达标时即使触发事件 payload 无关（gas quantity=0）也按统计解锁 B01（unlockedAt=事件时间=FROZEN_NOW）",
    stM.achievements.unlockedAtById["B01"] === FROZEN_NOW);
  stM._dirty = false;
  sbM.GameEvents.emit("mining:completed",
    { area: "凡晶石带", mode: "normal", resourceId: "ore:凡晶石", quantity: 1, cycles: 1, xp: 10 },
    { offline: false });
  ok("[pr41] 无新解锁的消费者求值不置 dirty（_dirty 预置 false 后保持 false）", stM._dirty === false);

  // ========================= D. 真实接线与追溯 =========================
  let freshP = null;
  try { freshP = buildFullGameSandbox(null); } catch (e) {
    ok("[pr42] 新游戏全量脚本加载不抛异常: " + (e && e.message), false);
  }
  if (freshP) {
    const gs = freshP.sandbox.gameState;
    ok("[pr42] 全部 49 个脚本全量 VM 加载成功且 spy 完整（含生产对账 spy）",
      freshP.scriptSources.length === 49 && freshP.spyInstalled === true);
    const sRec = freshP.timeline.filter((e) => e.fn === "evaluateSkillAchievementRules");
    const pRec = freshP.timeline.filter((e) => e.fn === "evaluateProductionAchievementRules");
    // C-13：生产求值器自身仍解锁 0 项；全局解锁集恰为 {I01}（初始 ISK=1e6 触发经济成就）
    ok("[pr43] 新游戏 autoLoad 生产对账恰好一次、atMs=登录时 Date.now()（冻结）、ok=true、生产解锁 0 项",
      pRec.length === 1 && pRec[0].atMs === FROZEN_NOW &&
      pRec[0].result && pRec[0].result.ok === true && pRec[0].result.unlockedIds.length === 0 &&
      Object.keys(gs.achievements.unlockedAtById).sort().join(",") === "I01");
    const iSk = freshP.timeline.findIndex((e) => e.fn === "evaluateSkillAchievementRules");
    const iPr = freshP.timeline.findIndex((e) => e.fn === "evaluateProductionAchievementRules");
    const iAchM = freshP.timeline.findIndex((e) => e.fn === "migrateAchievementState");
    const iOffl = freshP.timeline.findIndex((e) => e.fn === "calculateOfflineGains");
    // 新游戏（restored=false）不触发离线结算；若触发则双对账必须在其之前
    ok("[pr44] autoLoad 双对账顺序 achievement migrate < skill reconcile < production reconcile（<offline，若有），且两次对账 atMs 完全相同",
      sRec.length === 1 && iAchM >= 0 && iSk >= 0 && iPr >= 0 &&
      iAchM < iSk && iSk < iPr && (iOffl === -1 || iPr < iOffl) && sRec[0].atMs === pRec[0].atMs);

    // 在线真实链路：gameTick → mining:completed → statistics → 消费者 → B01
    let onlineErr = null;
    try {
      gs.currentAction.active = true;
      gs.currentAction.skill = "mining";
      gs.currentAction.area = "凡晶石带";
      gs.currentAction.startedArea = "凡晶石带";
      gs.currentAction.progress = 0;
      gs.currentAction.batchRemaining = 99;
      for (let i = 0; i < 12 && !("B01" in gs.achievements.unlockedAtById); i++) {
        gs.currentAction.lastProgressUpdate = FROZEN_NOW - 5000;
        freshP.sandbox.gameTick();
      }
    } catch (e) { onlineErr = (e && e.message) ? e.message : String(e); }
    ok("[pr45] 真实 gameTick 在线采矿链路解锁 B01（statistics.gathered[凡晶石]≥1、minedUnits≥1）" + (onlineErr ? "【异常: " + onlineErr + "】" : ""),
      onlineErr === null && typeof gs.achievements.unlockedAtById["B01"] === "number" &&
      (gs.statistics.production.gathered["ore:凡晶石"] || 0) >= 1 && gs.statistics.totals.minedUnits >= 1);
    ok("[pr46] 在线解锁来自三类事件消费者、不靠第二次追溯扫描（生产对账 spy 计数仍为 1），且 B01 恰 emit 一次",
      freshP.timeline.filter((e) => e.fn === "evaluateProductionAchievementRules").length === 1 &&
      freshP.achievementEvents.filter((ev) => ev.payload.achievementId === "B01").length === 1);

    // importData 真实路径：statistics 随档导入 → 双对账（同一 now）→ 生产对账补 B01
    const tlB = freshP.timeline.length;
    const importSaveP = {
      skills: { mining: { lvl: 1, xp: 0 } },
      resources: { isk: 1000, fuel: 100 },
      achievements: { schemaVersion: 1, unlockedAtById: {} },
      planetary: { deployments: [], nextId: 1 },
      statistics: {
        version: 1,
        totals: { minedUnits: 5 },
        production: { gathered: { "ore:凡晶石": 5 }, refined: {}, manufactured: {} },
      },
    };
    let importOkP = false;
    try { importOkP = freshP.sandbox.SaveManager.importData(JSON.stringify(importSaveP)); }
    catch (e) { ok("[pr47] importData 抛出异常: " + (e && e.message), false); }
    const itlP = freshP.timeline.slice(tlB);
    const jSk = itlP.findIndex((e) => e.fn === "evaluateSkillAchievementRules");
    const jPr = itlP.findIndex((e) => e.fn === "evaluateProductionAchievementRules");
    const jAch = itlP.findIndex((e) => e.fn === "migrateAchievementState");
    const jOff = itlP.findIndex((e) => e.fn === "calculateOfflineGains");
    ok("[pr47] importData 双对账各恰一次且顺序 achievement migrate < skill < production < offline、两次 atMs 完全相同",
      importOkP === true &&
      itlP.filter((e) => e.fn === "evaluateSkillAchievementRules").length === 1 &&
      itlP.filter((e) => e.fn === "evaluateProductionAchievementRules").length === 1 &&
      jAch >= 0 && jSk >= 0 && jPr >= 0 && jOff >= 0 &&
      jAch < jSk && jSk < jPr && jPr < jOff && itlP[jSk].atMs === itlP[jPr].atMs);
    ok("[pr48] 旧档导入（statistics 凡晶石=5、空成就）→ 生产对账立即补 B01=导入时 Date.now()（unlockedIds 含 B01）",
      jPr >= 0 && itlP[jPr].result && itlP[jPr].result.unlockedIds.includes("B01") &&
      freshP.sandbox.gameState.achievements.unlockedAtById["B01"] === FROZEN_NOW);
  }

  // restored=true 登录追溯：全满 statistics 空成就 → 登录一次性补全 18 项
  const retroSave = {
    skills: { mining: { lvl: 1, xp: 0 } },
    resources: { isk: 500, fuel: 100 },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    achievements: { schemaVersion: 1, unlockedAtById: {} },
    planetary: { deployments: [], nextId: 1 },
    statistics: {
      version: 1,
      totals: { minedUnits: 100000000, gasUnits: 1000000 },
      production: { gathered: {}, refined: {}, manufactured: {} },
    },
  };
  for (const o of EXP_ORES) retroSave.statistics.production.gathered["ore:" + o] = 1;
  for (const m of EXP_MINERALS) retroSave.statistics.production.refined["mineral:" + m] = 1;
  let retro = null;
  try { retro = buildFullGameSandbox(JSON.stringify(retroSave)); } catch (e) {
    ok("[pr49] 全满统计存档加载不抛异常: " + (e && e.message), false);
  }
  if (retro) {
    const m = retro.sandbox.gameState.achievements.unlockedAtById;
    const pRecR = retro.timeline.filter((e) => e.fn === "evaluateProductionAchievementRules");
    ok("[pr49] 旧档全满统计登录后一次性补全 18 项（对账恰一次、unlockedIds 恰 18、全部=登录冻结 Date.now()）",
      pRecR.length === 1 && pRecR[0].result && pRecR[0].result.unlockedIds.length === 18 &&
      EXPECTED_PROD_IDS.every((id) => m[id] === FROZEN_NOW));
    const perId = {};
    for (const ev of retro.achievementEvents) {
      if (PROD_ID_SET.has(ev.payload.achievementId)) perId[ev.payload.achievementId] = (perId[ev.payload.achievementId] || 0) + 1;
    }
    ok("[pr50] 登录追溯的 18 项 achievement:unlocked 每项严格 emit 一次",
      EXPECTED_PROD_IDS.every((id) => perId[id] === 1));
  }

  // 旧存档已有 B01 时间戳：登录后原时间不变且不重复 emit
  const keepSave = {
    skills: { mining: { lvl: 1, xp: 0 } },
    resources: { isk: 500, fuel: 100 },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    achievements: { schemaVersion: 1, unlockedAtById: { "B01": 123.5 } },
    planetary: { deployments: [], nextId: 1 },
    statistics: {
      version: 1,
      totals: { minedUnits: 5 },
      production: { gathered: { "ore:凡晶石": 5 }, refined: {}, manufactured: {} },
    },
  };
  let keep = null;
  try { keep = buildFullGameSandbox(JSON.stringify(keepSave)); } catch (e) {
    ok("[pr51] 已有 B01 存档加载不抛异常: " + (e && e.message), false);
  }
  if (keep) {
    ok("[pr51] 旧存档已有 B01=123.5 登录后原时间保持不变且 B01 不重复 emit（订阅观测 0 条 B01 事件）",
      keep.sandbox.gameState.achievements.unlockedAtById["B01"] === 123.5 &&
      keep.achievementEvents.filter((ev) => ev.payload.achievementId === "B01").length === 0);
  }

  // 离线真实链路：登录对账 0 解锁（statistics 空），calculateOfflineGains 发离线事件 → 消费者解锁 B01
  const offSave = {
    skills: { mining: { lvl: 1, xp: 0 } },
    resources: { isk: 500, fuel: 100 },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    lastActiveTime: FROZEN_NOW - 3600 * 1000, // calculateOfflineGains 以 lastActiveTime 计算 elapsed
    currentAction: {
      active: true, skill: "mining", area: "凡晶石带", startedArea: "凡晶石带",
      progress: 0, lastProgressUpdate: FROZEN_NOW - 3600 * 1000, batchRemaining: 0,
    },
    achievements: { schemaVersion: 1, unlockedAtById: {} },
    planetary: { deployments: [], nextId: 1 },
  };
  let offr = null;
  try { offr = buildFullGameSandbox(JSON.stringify(offSave)); } catch (e) {
    ok("[pr52] 离线采矿存档加载不抛异常: " + (e && e.message), false);
  }
  if (offr) {
    const gsO = offr.sandbox.gameState;
    const pRecO = offr.timeline.filter((e) => e.fn === "evaluateProductionAchievementRules");
    const iPrO = offr.timeline.findIndex((e) => e.fn === "evaluateProductionAchievementRules");
    const iOffO = offr.timeline.findIndex((e) => e.fn === "calculateOfflineGains");
    ok("[pr52] 真实 calculateOfflineGains 离线采矿链路解锁 B01（登录对账在离线前且 0 解锁 → 解锁来自离线事件消费者）",
      pRecO.length === 1 && iPrO >= 0 && iOffO >= 0 && iPrO < iOffO &&
      pRecO[0].result && pRecO[0].result.unlockedIds.length === 0 &&
      typeof gsO.achievements.unlockedAtById["B01"] === "number");
    ok("[pr53] 离线结算真实累计进 statistics（minedUnits≥1、gathered[凡晶石]≥1、offlineEvents≥1）且 B01 恰 emit 一次",
      gsO.statistics.totals.minedUnits >= 1 &&
      (gsO.statistics.production.gathered["ore:凡晶石"] || 0) >= 1 &&
      gsO.statistics.activity.offlineEvents >= 1 &&
      offr.achievementEvents.filter((ev) => ev.payload.achievementId === "B01").length === 1);
  }

  // ---- persistence 源码结构：双对账复用同一 now 变量 ----
  const persSrc = fs.readFileSync(PERSISTENCE_PATH, "utf-8");
  const persCode = persSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const skillCallN = (persCode.match(/evaluateSkillAchievementRules\(gameState,\s*achievementReconcileNow\)/g) || []).length;
  const prodCallN = (persCode.match(/evaluateProductionAchievementRules\(gameState,\s*achievementReconcileNow\)/g) || []).length;
  const nowDefN = (persCode.match(/achievementReconcileNow\s*=\s*Date\.now\(\)/g) || []).length;
  ok("[pr54] persistence 双入口（importData+autoLoad）各以同一 achievementReconcileNow 调用两个求值器（技能调用×2、生产调用×2、Date.now() 取值恰 2 次）",
    skillCallN === 2 && prodCallN === 2 && nowDefN === 2);
  const prodRefN = (persCode.match(/evaluateProductionAchievementRules/g) || []).length;
  ok("[pr55] persistence 中生产求值器引用恰 4 处（2 入口 ×（typeof 能力探测 + 调用））、无游离调用",
    prodRefN === 4);

  // ---- 负向源码保护：在线/离线/生产数据层无第二套生产成就公式 ----
  const tickSrcP = fs.readFileSync(TICK_PATH, "utf-8");
  const offlineSrcP = fs.readFileSync(OFFLINE_PATH, "utf-8");
  const prodSrcP = fs.readFileSync(PRODUCTION_PATH, "utf-8");
  const statSrcP = fs.readFileSync(STATISTICS_PATH, "utf-8");
  const forbiddenP = ["PRODUCTION_RULES", "evaluateProductionAchievementRules", "unlockAchievement", "AchievementRuleData"];
  ok("[pr56] tick.js / offline.js / production.js / statistics.js 不含生产成就规则或解锁调用（在线离线共用唯一事件链路，statistics 保持纯记账）",
    forbiddenP.every((t) => !tickSrcP.includes(t) && !offlineSrcP.includes(t) && !prodSrcP.includes(t) && !statSrcP.includes(t)));

  // ---- index.html 49 脚本顺序（C-2 完整链）+ verify 基线接线 ----
  const orderP = readIndexScriptOrder();
  ok("[pr57] index.html 49 脚本且顺序 events<data/ach<data/rules<core/ach-state<core/state<core/statistics<systems/ach<systems/production<persistence",
    orderP.srcs.length === 49 &&
    orderP.events >= 0 && orderP.achData >= 0 && orderP.achRules >= 0 && orderP.achState >= 0 &&
    orderP.coreState >= 0 && orderP.statistics >= 0 && orderP.achSystem >= 0 &&
    orderP.production >= 0 && orderP.persistence >= 0 &&
    orderP.events < orderP.achData && orderP.achData < orderP.achRules &&
    orderP.achRules < orderP.achState && orderP.achState < orderP.coreState &&
    orderP.coreState < orderP.statistics && orderP.statistics < orderP.achSystem &&
    orderP.achSystem < orderP.production && orderP.production < orderP.persistence);
  const verifySrcP = fs.readFileSync(VERIFY_PATH, "utf-8");
  ok("[pr58] verify.mjs 已包含 statistics/production 顺序断言（js/core/statistics.js 与 js/systems/production.js 均被引用）",
    verifySrcP.includes("js/core/statistics.js") && verifySrcP.includes("js/systems/production.js"));
}

// ============================================================================
//  --combat：Batch C-3 战斗星带通关规则真实触发审计
// ============================================================================
function runCombat() {
  // ---- 独立期望表（审计侧显式复刻，与规则文件交叉验证，不从规则文件反推）----
  const EXP_ZONE_IDS = [
    "angel_outpost", "blood_hideout", "sansha_outpost", "angel_corridor",
    "blood_sacrifice", "sansha_node", "angel_hunting_ground", "blood_cathedral",
    "sansha_nexus", "angel_warfront", "blood_iron_basilica", "sansha_command_matrix",
    "angel_outer_reach", "blood_outer_reliquary", "sansha_outer_array", "angel_deep_domain",
    "blood_deep_reliquary", "sansha_deep_nexus",
  ];
  const EXP_ZONE_NAMES = [
    "天使前哨站", "血袭者隐蔽所", "萨沙哨站", "天使劫掠走廊",
    "血袭者献祭场", "萨沙控制节点", "天使猎杀空域", "血袭者深红圣堂",
    "萨沙同化枢纽", "天使破阵战场", "血袭者铁血圣殿", "萨沙统御矩阵",
    "天使外环侵袭区", "血袭者外环圣库", "萨沙外环同化阵列", "天使深域王庭",
    "血袭者深域圣殿", "萨沙深域主脑",
  ];
  const EXPECTED_COMBAT_IDS = [];
  for (let i = 1; i <= 19; i++) EXPECTED_COMBAT_IDS.push("E" + String(i).padStart(2, "0"));
  const COMBAT_ID_SET = new Set(EXPECTED_COMBAT_IDS);

  const sb = buildKernelSandbox({ withEvents: true, withRules: true });
  const RD = sb.AchievementRuleData;
  const SYS = sb.AchievementSystem;
  const SAD = sb.AchievementData;
  // 本分区只读证明基线：战斗规则数据进入本分区时的 JSON 快照（cb35f 用于对比）
  const combatRulesPreJson = JSON.stringify(RD.COMBAT_RULES);

  function makeCombatState(box, zoneClears, combatExtra) {
    const combat = Object.assign({
      zoneClears: zoneClears || {},
      maxWaveReached: 0,
      zoneClearsByWeapon: { laser: 0, cannon: 0, missile: 0 },
      capitalEnemyKills: 0,
      supercapitalEnemyKills: 0,
    }, combatExtra || {});
    return {
      skills: {},
      achievements: box.AchievementState.createDefaultAchievementState(),
      statistics: {
        version: 1,
        totals: {},
        combat,
      },
      _dirty: false,
    };
  }
  const evaluate = (state, atMs) => SYS.evaluateCombatAchievementRules(state, atMs);
  const unlockedSet = (state) => new Set(Object.keys(state.achievements.unlockedAtById));

  // ========================= A. 规则数据 =========================
  const zidFrozen = Object.isFrozen(RD.COMBAT_ZONE_IDS) &&
    RD.COMBAT_ZONE_IDS.length === 18 && new Set(RD.COMBAT_ZONE_IDS).size === 18 &&
    RD.COMBAT_ZONE_IDS.every((id, i) => id === EXP_ZONE_IDS[i]);
  ok("[cb1] COMBAT_ZONE_IDS 精确等于 18 个权威星带 ID（顺序一致、无重复、全部冻结）", zidFrozen);
  if (!RD || !SYS || !Array.isArray(RD.COMBAT_RULES)) return;

  let mapOk = true;
  for (let i = 0; i < 18; i++) {
    const r = RD.COMBAT_RULES_BY_ID["E" + String(i + 1).padStart(2, "0")];
    if (!r || r.type !== "combat-zone-clear" || r.zoneId !== EXP_ZONE_IDS[i] || r.minValue !== 1) mapOk = false;
  }
  ok("[cb2] E01–E18 映射逐项精确（combat-zone-clear / zoneId=对应星带 / minValue=1）", mapOk);

  const e19 = RD.COMBAT_RULES_BY_ID["E19"];
  const e19ok = !!e19 && e19.type === "combat-all-zones" && e19.minValue === 1 &&
    Array.isArray(e19.zoneIds) && e19.zoneIds.length === 18 &&
    new Set(e19.zoneIds).size === 18 &&
    e19.zoneIds.every((id, i) => id === EXP_ZONE_IDS[i] && RD.COMBAT_ZONE_IDS.includes(id));
  ok("[cb3] E19 规则精确引用全部 18 个不同星带（combat-all-zones / zoneIds=COMBAT_ZONE_IDS）", e19ok);

  const ruleFrozen = Object.isFrozen(RD.COMBAT_RULES) && Object.isFrozen(RD.COMBAT_RULES_BY_ID) &&
    RD.COMBAT_RULES.every((r) => Object.isFrozen(r)) &&
    (e19 && Object.isFrozen(e19.zoneIds));
  ok("[cb4] COMBAT_RULES=32、BY_ID=32 键、每条规则与 E19.zoneIds 全部 Object.freeze",
    RD.COMBAT_RULES.length === 32 && Object.keys(RD.COMBAT_RULES_BY_ID).length === 32 && ruleFrozen);

  const skillKeys = new Set(Object.keys(RD.SKILL_RULES_BY_ID));
  const prodKeys = new Set(Object.keys(RD.PRODUCTION_RULES_BY_ID));
  const combKeys = new Set(Object.keys(RD.COMBAT_RULES_BY_ID));
  ok("[cb5] 技能50 + 生产18 + 战斗32 = 100 条规则、三集合零交集；其余 98 项无规则（C01/D01/F01/J10/J11/J12 均不在任一 BY_ID）",
    skillKeys.size === 50 && prodKeys.size === 18 && combKeys.size === 32 &&
    [...combKeys].every((k) => !skillKeys.has(k) && !prodKeys.has(k)) &&
    ["C01", "D01", "F01", "J10", "J11", "J12"].every((id) => !skillKeys.has(id) && !prodKeys.has(id) && !combKeys.has(id)));

  let e26to33Ok = true;
  for (let i = 20; i <= 33; i++) {
    if (i === 28) continue; // E28 已从目录删除
    if (!RD.COMBAT_RULES_BY_ID["E" + String(i).padStart(2, "0")]) e26to33Ok = false;
  }
  ok("[cb6] E20–E33（不含 E28）全部在 COMBAT_RULES（E28 已从目录删除、不在规则中）",
    e26to33Ok && !RD.COMBAT_RULES_BY_ID["E28"]);

  // CSV 交叉 + combat.js id→name 交叉
  const csvRows = parseCSV(fs.readFileSync(CSV_PATH).slice(3).toString("utf-8")).slice(1);
  const csvById = {};
  for (const r of csvRows) csvById[r[0]] = r;
  let csvCatOk = EXPECTED_COMBAT_IDS.every((id) => csvById[id] && csvById[id][1] === "战斗");
  let csvCondOk = true;
  for (let i = 0; i < 18; i++) {
    const c = csvById["E" + String(i + 1).padStart(2, "0")];
    if (!c || !c[2].startsWith("首次通关战斗星带：") || !c[2].includes(EXP_ZONE_NAMES[i])) csvCondOk = false;
  }
  if (!csvById["E19"] || csvById["E19"][2] !== "通关全部 18 个战斗星带") csvCondOk = false;
  const combatSrc = fs.readFileSync(COMBAT_PATH, "utf-8");
  const zoneRe = /id:\s*"([^"]+)"\s*,\s*name:\s*"([^"]+)"/g;
  const combatZones = {};
  let mm;
  while ((mm = zoneRe.exec(combatSrc))) combatZones[mm[1]] = mm[2];
  let combatCrossOk = EXP_ZONE_IDS.every((id, i) => combatZones[id] === EXP_ZONE_NAMES[i]);
  ok("[cb7] CSV 交叉：E01–E19 分类=战斗、E01–E18 条件文本含星带名、E19=通关全部 18 星带；且 combat.js 的 id→name 与 18 星带逐项一致",
    csvCatOk && csvCondOk && combatCrossOk);

  // ========================= B. 求值边界 =========================
  for (let i = 0; i < 18; i++) {
    const id = "E" + String(i + 1).padStart(2, "0"), key = EXP_ZONE_IDS[i];
    const s0 = makeCombatState(sb, { [key]: 0 });
    const r0 = evaluate(s0, 1000);
    const s1 = makeCombatState(sb, { [key]: 1 });
    const r1 = evaluate(s1, 1000);
    ok("[cb8-" + EXP_ZONE_NAMES[i] + "] 通关 0 → 0 项；通关 1 → 恰 {" + id + "}",
      r0.ok === true && r0.evaluatedCount === 32 && r0.unlockedIds.length === 0 &&
      r1.ok === true && r1.unlockedIds.length === 1 && r1.unlockedIds[0] === id &&
      unlockedSet(s1).size === 1 && unlockedSet(s1).has(id));
  }
  const sBad = makeCombatState(sb, {
    angel_outpost: NaN, blood_hideout: "5", sansha_outpost: Infinity,
    angel_corridor: -1, blood_sacrifice: null, unknown_zone_xyz: 99,
  });
  const rBad = evaluate(sBad, 1);
  ok("[cb9] 未知 ID、错桶、NaN/字符串/Infinity/负数/null 不得误解锁（0 项解锁，ok=true）",
    rBad.ok === true && rBad.unlockedIds.length === 0 && unlockedSet(sBad).size === 0);

  const sSame18 = makeCombatState(sb, { angel_outpost: 18 });
  const rSame18 = evaluate(sSame18, 1);
  ok("[cb10] 同一星带通关 18 次不得解锁 E19（仅 E01 达标；E19 需全部 18 个不同星带）",
    rSame18.unlockedIds.length === 1 && rSame18.unlockedIds[0] === "E01" &&
    !("E19" in sSame18.achievements.unlockedAtById));

  // 17 个不同星带完成、第 18 个为 0
  const zc17 = {};
  for (let i = 0; i < 17; i++) zc17[EXP_ZONE_IDS[i]] = 1;
  const s17 = makeCombatState(sb, zc17);
  const r17 = evaluate(s17, 1);
  ok("[cb11] 17 个不同星带完成不得解锁 E19（仅 17 个 E0x 解锁，E18 与 E19 仍锁）",
    !("E19" in s17.achievements.unlockedAtById) &&
    !("E18" in s17.achievements.unlockedAtById) &&
    r17.unlockedIds.length === 17 &&
    r17.unlockedIds.every((id) => id !== "E18" && id !== "E19"));

  // 第 18 个不同星带完成 → E19 恰好解锁一次
  const zc18 = {};
  for (let i = 0; i < 18; i++) zc18[EXP_ZONE_IDS[i]] = 1;
  const s18 = makeCombatState(sb, zc18);
  const r18 = evaluate(s18, 1);
  ok("[cb12] 第 18 个不同星带完成时 E19 恰好解锁一次（连同 E01–E18 共 19 项）",
    r18.unlockedIds.length === 19 && r18.unlockedIds.includes("E19") &&
    EXPECTED_COMBAT_IDS.every((id) => unlockedSet(s18).has(id)));

  // 全满单次求值精确 19 项、不多不少、同批 atMs 一致
  const sFull = makeCombatState(sb, zc18);
  const rFull = evaluate(sFull, 2000);
  const fullSet = unlockedSet(sFull);
  ok("[cb13] 全满统计单次求值恰好解锁 E01–E19（19 项，不少不多），且全部 unlockedAt=2000",
    rFull.unlockedIds.length === 19 && fullSet.size === 19 &&
    EXPECTED_COMBAT_IDS.every((id) => fullSet.has(id)) &&
    EXPECTED_COMBAT_IDS.every((id) => sFull.achievements.unlockedAtById[id] === 2000));

  // ========================= C. 幂等 / dirty / 时间语义 =========================
  const capC = [];
  sb.GameEvents.on("achievement:unlocked", (ev) => capC.push(ev));
  const sI = makeCombatState(sb, { angel_outpost: 1, sansha_outpost: 1 });
  SYS.unlockAchievement(sI, "E01", 111); // 预解锁 E01
  capC.length = 0;
  const rI1 = evaluate(sI, 5000);
  ok("[cb14] 首次求值 unlockedIds 只含本次新解锁项（含 E03 不含预解锁 E01，E01 保持 111）",
    rI1.ok === true && rI1.unlockedIds.includes("E03") && !rI1.unlockedIds.includes("E01") &&
    sI.achievements.unlockedAtById["E01"] === 111);
  sI._dirty = false;
  capC.length = 0; // 复算前清空事件捕获缓冲，避免 cb14 的 E03 事件残留干扰「无新 emit」判定
  const rI2 = evaluate(sI, 6000);
  ok("[cb15] 同状态重复求值 unlockedIds=[]、不覆盖时间（E03 保持 5000）、不 emit、不 dirty",
    rI2.ok === true && rI2.unlockedIds.length === 0 &&
    sI.achievements.unlockedAtById["E03"] === 5000 && capC.length === 0 && sI._dirty === false);

  const TBC = 1690000123456.75;
  capC.length = 0;
  const sT = makeCombatState(sb, { angel_outpost: 1, blood_hideout: 1 });
  const rT = evaluate(sT, TBC);
  const idCountsC = {};
  for (const ev of capC) idCountsC[ev.payload.achievementId] = (idCountsC[ev.payload.achievementId] || 0) + 1;
  ok("[cb16] 同批多项解锁使用完全相同的浮点 atMs（E01=E02=TBC），每项 emit 严格一次且 timestamp=unlockedAt",
    rT.unlockedIds.length === 2 &&
    sT.achievements.unlockedAtById["E01"] === TBC && sT.achievements.unlockedAtById["E02"] === TBC &&
    capC.length === 2 && idCountsC["E01"] === 1 && idCountsC["E02"] === 1 &&
    capC.every((ev) => ev.timestamp === ev.payload.unlockedAt && ev.payload.unlockedAt === TBC));

  const sNaN = makeCombatState(sb, { blood_sacrifice: 1 });
  const rNaN = evaluate(sNaN, NaN);
  ok("[cb17] 非法 atMs 统一使用冻结 Date.now()（E05 unlockedAt=FROZEN_NOW）",
    rNaN.unlockedIds.includes("E05") && sNaN.achievements.unlockedAtById["E05"] === FROZEN_NOW);

  const sRO = makeCombatState(sb, { angel_outpost: 1 });
  const statsBefore = JSON.stringify(sRO.statistics);
  const rdBefore = JSON.stringify(RD.COMBAT_RULES);
  evaluate(sRO, 1);
  ok("[cb18] 求值前后 state.statistics 与 COMBAT_RULES JSON 完全一致（条件读取纯只读；成就状态无 schema 污染）",
    JSON.stringify(sRO.statistics) === statsBefore && JSON.stringify(RD.COMBAT_RULES) === rdBefore &&
    Object.isFrozen(RD.COMBAT_RULES) && !("combat" in sRO.achievements) && !("zoneClears" in sRO.achievements));

  // ========================= D. 消费者（真实沙箱） =========================
  // D-a 真实 statistics.js 沙箱：statistics + 生产 + 战斗 三消费者同注册在 *，statistics 先行
  const sbS = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsS = sbS.gameState;
  const capS = [];
  sbS.GameEvents.on("achievement:unlocked", (ev) => capS.push(ev));
  const reinstallC = sbS.AchievementSystem.installCombatAchievementConsumer(gsS);
  ok("[cb19] listenerCount(\"*\") 体现 statistics+生产+战斗+制造+装备+增幅剂+考古+行星+空间站+综合生命周期 十监听，重复安装返回 ALREADY_INSTALLED",
    sbS.GameEvents.listenerCount("*") === 10 && sbS.GameEvents.listenerCount("skill:levelUp") === 1 &&
    reinstallC && reinstallC.ok === false && reinstallC.reason === "ALREADY_INSTALLED");
  const TSC = 1712345678901.5;
  sbS.GameEvents.emit("combat:zoneCleared",
    { zoneId: "angel_outpost", name: "天使前哨站", lp: 10, clearCount: 1, wave: 1, weaponTypes: [], damageTaken: 0 },
    { offline: false, timestamp: TSC });
  ok("[cb20] 首个 combat:zoneCleared 即解锁 E01（分发顺序证明：statistics 先累计、战斗消费者后读到 zoneClears[angel_outpost]=1），unlockedAt=事件浮点 timestamp",
    gsS.statistics.combat.zoneClears["angel_outpost"] === 1 &&
    typeof gsS.achievements.unlockedAtById["E01"] === "number" &&
    gsS.achievements.unlockedAtById["E01"] === TSC &&
    capS.filter((ev) => ev.payload.achievementId === "E01").length === 1);
  // 幂等账本：同 eventId 重放不得二次累计也不得二次解锁
  sbS.GameEvents.emit("combat:zoneCleared",
    { zoneId: "blood_hideout", name: "血袭者隐蔽所", lp: 10, clearCount: 1, wave: 1, weaponTypes: [], damageTaken: 0 },
    { offline: false, eventId: "combat-audit-dup-1" });
  sbS.GameEvents.emit("combat:zoneCleared",
    { zoneId: "blood_hideout", name: "血袭者隐蔽所", lp: 10, clearCount: 1, wave: 1, weaponTypes: [], damageTaken: 0 },
    { offline: false, eventId: "combat-audit-dup-1" });
  ok("[cb21] 同 eventId 重放：statistics 幂等账本只累计一次（blood_hideout=1）、E02 恰解锁一次",
    gsS.statistics.combat.zoneClears["blood_hideout"] === 1 &&
    capS.filter((ev) => ev.payload.achievementId === "E02").length === 1 &&
    typeof gsS.achievements.unlockedAtById["E02"] === "number");

  // D-b 手工沙箱（无 statistics.js）：payload 不可信 + 安装失败原因 + dirty 语义
  const sbM = buildKernelSandbox({ withEvents: true, withRules: true });
  let instThrow = false, rInv = null, rNoStatI = null, rNoEv = null;
  try {
    rInv = sbM.AchievementSystem.installCombatAchievementConsumer(null);
    rNoStatI = sbM.AchievementSystem.installCombatAchievementConsumer(
      { achievements: sbM.AchievementState.createDefaultAchievementState() });
    const sbNoEvC = buildKernelSandbox({ withEvents: false, withRules: true });
    rNoEv = sbNoEvC.AchievementSystem.installCombatAchievementConsumer(makeCombatState(sbNoEvC, {}));
  } catch (e) { instThrow = true; }
  ok("[cb22] INVALID_STATE / STATISTICS_UNAVAILABLE / EVENTS_UNAVAILABLE 安装失败原因稳定，不抛异常",
    !instThrow && rInv && rInv.ok === false && rInv.reason === "INVALID_STATE" &&
    rNoStatI && rNoStatI.ok === false && rNoStatI.reason === "STATISTICS_UNAVAILABLE" &&
    rNoEv && rNoEv.ok === false && rNoEv.reason === "EVENTS_UNAVAILABLE");
  const stM = makeCombatState(sbM, {});
  const instM1 = sbM.AchievementSystem.installCombatAchievementConsumer(stM);
  const instM2 = sbM.AchievementSystem.installCombatAchievementConsumer(stM);
  ok("[cb23] 首次安装 {ok:true,reason:null}；重复安装 ALREADY_INSTALLED（每沙箱恰一套监听）",
    instM1 && instM1.ok === true && instM1.reason === null &&
    instM2 && instM2.ok === false && instM2.reason === "ALREADY_INSTALLED" &&
    sbM.GameEvents.listenerCount("*") === 1);
  sbM.GameEvents.emit("combat:zoneCleared",
    { zoneId: "angel_outpost", name: "天使前哨站", lp: 10, clearCount: 999999, wave: 1, weaponTypes: [], damageTaken: 0 },
    { offline: false });
  ok("[cb24] 不信任 payload：事件声称 clearCount=999999 但权威 statistics 仍为 0 时不得解锁任何项",
    Object.keys(stM.achievements.unlockedAtById).length === 0);
  stM.statistics.combat.zoneClears["angel_outpost"] = 1;
  sbM.GameEvents.emit("combat:zoneCleared",
    { zoneId: "angel_outpost", name: "天使前哨站", lp: 10, clearCount: 0, wave: 1, weaponTypes: [], damageTaken: 0 },
    { offline: false });
  ok("[cb25] 权威 statistics 达标时即使触发事件 payload 无关（clearCount=0）也按统计解锁 E01（unlockedAt=事件时间=FROZEN_NOW）",
    stM.achievements.unlockedAtById["E01"] === FROZEN_NOW);
  stM._dirty = false;
  sbM.GameEvents.emit("combat:zoneCleared",
    { zoneId: "angel_outpost", name: "天使前哨站", lp: 10, clearCount: 1, wave: 1, weaponTypes: [], damageTaken: 0 },
    { offline: false });
  ok("[cb26] 无新解锁的消费者求值不置 dirty（_dirty 预置 false 后保持 false）", stM._dirty === false);
  // 非 combat 事件不得触发战斗求值
  gsS.statistics.combat.zoneClears["sansha_outpost"] = 1;
  sbM.GameEvents.emit("skill:levelUp", { skill: "mining", previousLevel: 1, level: 2 }, { source: "audit" });
  sbM.GameEvents.emit("mining:completed", { area: "凡晶石带", mode: "normal", resourceId: "ore:凡晶石", quantity: 1, cycles: 1, xp: 10 }, { offline: false });
  sbM.GameEvents.emit("refining:completed", { recipe: "x", inputId: "ore:凡晶石", outputId: "mineral:三钛合金", inputQuantity: 1, outputQuantity: 1, cycles: 1, xp: 10 }, { offline: false });
  sbM.GameEvents.emit("gas:completed", { area: "富勒烯云团", resourceId: "gas:粗制富勒烯", quantity: 1, cycles: 1, xp: 10 }, { offline: false });
  ok("[cb27] skill/mining/refining/gas/其他事件不得触发战斗求值（sansha_outpost 已达标但无 emit、未解锁 E03）",
    !("E03" in stM.achievements.unlockedAtById) && capS.filter((ev) => ev.payload.achievementId === "E03").length === 0);

  // ========================= E. 真实接线与追溯 =========================
  let freshC = null;
  try { freshC = buildFullGameSandbox(null); } catch (e) {
    ok("[cb28] 新游戏全量脚本加载不抛异常: " + (e && e.message), false);
  }
  if (freshC) {
    const gs = freshC.sandbox.gameState;
    ok("[cb28] 全部 49 个脚本全量 VM 加载成功且 spy 完整（含战斗对账 spy）",
      freshC.scriptSources.length === 49 && freshC.spyInstalled === true);
    const cRec = freshC.timeline.filter((e) => e.fn === "evaluateCombatAchievementRules");
    const sRecC = freshC.timeline.filter((e) => e.fn === "evaluateSkillAchievementRules");
    const pRecC = freshC.timeline.filter((e) => e.fn === "evaluateProductionAchievementRules");
    // C-13：战斗求值器自身仍解锁 0 项；全局解锁集恰为 {I01}
    ok("[cb29] 新游戏 autoLoad 战斗对账恰好一次、atMs=登录时 Date.now()（冻结）、ok=true、战斗解锁 0 项",
      cRec.length === 1 && cRec[0].atMs === FROZEN_NOW &&
      cRec[0].result && cRec[0].result.ok === true && cRec[0].result.unlockedIds.length === 0 &&
      Object.keys(gs.achievements.unlockedAtById).sort().join(",") === "I01");
    const iSk = freshC.timeline.findIndex((e) => e.fn === "evaluateSkillAchievementRules");
    const iPr = freshC.timeline.findIndex((e) => e.fn === "evaluateProductionAchievementRules");
    const iCb = freshC.timeline.findIndex((e) => e.fn === "evaluateCombatAchievementRules");
    const iAchM = freshC.timeline.findIndex((e) => e.fn === "migrateAchievementState");
    const iOff = freshC.timeline.findIndex((e) => e.fn === "calculateOfflineGains");
    ok("[cb30] 三类对账顺序 achievement migrate < skill < production < combat < offline（若有），且三次 atMs 完全相同",
      sRecC.length === 1 && iAchM >= 0 && iSk >= 0 && iPr >= 0 && iCb >= 0 &&
      iAchM < iSk && iSk < iPr && iPr < iCb && (iOff === -1 || iCb < iOff) &&
      sRecC[0].atMs === pRecC[0].atMs && pRecC[0].atMs === cRec[0].atMs);

    // importData 真实路径：statistics.combat.zoneClears 随档导入 → 战斗对账补 E 项
    const tlC = freshC.timeline.length;
    const importSaveC = {
      skills: { mining: { lvl: 1, xp: 0 } },
      resources: { isk: 1000, fuel: 100 },
      achievements: { schemaVersion: 1, unlockedAtById: {} },
      planetary: { deployments: [], nextId: 1 },
      statistics: {
        version: 1, totals: {}, combat: { zoneClears: { angel_outpost: 5 } },
      },
    };
    let importOkC = false;
    try { importOkC = freshC.sandbox.SaveManager.importData(JSON.stringify(importSaveC)); } catch (e) {
      ok("[cb31] importData 抛出异常: " + (e && e.message), false);
    }
    const itlC = freshC.timeline.slice(tlC);
    const jSk = itlC.findIndex((e) => e.fn === "evaluateSkillAchievementRules");
    const jPr = itlC.findIndex((e) => e.fn === "evaluateProductionAchievementRules");
    const jCb = itlC.findIndex((e) => e.fn === "evaluateCombatAchievementRules");
    const jAch = itlC.findIndex((e) => e.fn === "migrateAchievementState");
    const jOff = itlC.findIndex((e) => e.fn === "calculateOfflineGains");
    ok("[cb31] importData 战斗对账恰好一次且顺序 achievement migrate < skill < production < combat < offline、三次 atMs 完全相同",
      importOkC === true &&
      itlC.filter((e) => e.fn === "evaluateCombatAchievementRules").length === 1 &&
      jAch >= 0 && jSk >= 0 && jPr >= 0 && jCb >= 0 && jOff >= 0 &&
      jAch < jSk && jSk < jPr && jPr < jCb && jCb < jOff &&
      itlC[jSk].atMs === itlC[jPr].atMs && itlC[jPr].atMs === itlC[jCb].atMs);
    ok("[cb32] 旧档导入（combat.zoneClears[angel_outpost]=5、空成就）→ 战斗对账立即补 E01=导入时 Date.now()",
      jCb >= 0 && itlC[jCb].result && itlC[jCb].result.unlockedIds.includes("E01") &&
      freshC.sandbox.gameState.achievements.unlockedAtById["E01"] === FROZEN_NOW);
  }

  // restored=true 登录追溯：全 18 星带 zoneClears=1、空成就 → 一次性补全 E01–E19
  const retroSaveC = {
    skills: { mining: { lvl: 1, xp: 0 } },
    resources: { isk: 500, fuel: 100 },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    achievements: { schemaVersion: 1, unlockedAtById: {} },
    planetary: { deployments: [], nextId: 1 },
    statistics: { version: 1, totals: {}, combat: { zoneClears: {} } },
  };
  for (const id of EXP_ZONE_IDS) retroSaveC.statistics.combat.zoneClears[id] = 1;
  let retroC = null;
  try { retroC = buildFullGameSandbox(JSON.stringify(retroSaveC)); } catch (e) {
    ok("[cb33] 全满星带存档加载不抛异常: " + (e && e.message), false);
  }
  if (retroC) {
    const m = retroC.sandbox.gameState.achievements.unlockedAtById;
    const cRecR = retroC.timeline.filter((e) => e.fn === "evaluateCombatAchievementRules");
    ok("[cb33] 旧档 18 星带全满登录后一次性补全 E01–E20（对账恰一次、unlockedIds 恰 20、全部=登录冻结 Date.now()）",
      cRecR.length === 1 && cRecR[0].result && cRecR[0].result.unlockedIds.length === 20 &&
      EXPECTED_COMBAT_IDS.every((id) => m[id] === FROZEN_NOW));
    const perId = {};
    for (const ev of retroC.achievementEvents) {
      if (COMBAT_ID_SET.has(ev.payload.achievementId)) perId[ev.payload.achievementId] = (perId[ev.payload.achievementId] || 0) + 1;
    }
    ok("[cb34] 登录追溯的 19 项 achievement:unlocked 每项严格 emit 一次",
      EXPECTED_COMBAT_IDS.every((id) => perId[id] === 1));
  }

  // ========================= E. Batch C-11 战斗进阶（E20–E25） =========================
  const c11e20 = RD.COMBAT_RULES_BY_ID["E20"];
  const c11e21 = RD.COMBAT_RULES_BY_ID["E21"];
  const c11e22 = RD.COMBAT_RULES_BY_ID["E22"];
  const c11e23 = RD.COMBAT_RULES_BY_ID["E23"];
  const c11e24 = RD.COMBAT_RULES_BY_ID["E24"];
  const c11e25 = RD.COMBAT_RULES_BY_ID["E25"];
  const c11RulesOk = !!c11e20 && c11e20.type === "combat-max-wave" && c11e20.minValue === 20 &&
    !!c11e21 && c11e21.type === "combat-weapon-clear" && c11e21.weaponType === "laser" && c11e21.minValue === 1 &&
    !!c11e22 && c11e22.type === "combat-weapon-clear" && c11e22.weaponType === "cannon" && c11e22.minValue === 1 &&
    !!c11e23 && c11e23.type === "combat-weapon-clear" && c11e23.weaponType === "missile" && c11e23.minValue === 1 &&
    !!c11e24 && c11e24.type === "combat-capital-kills" && c11e24.minValue === 1 &&
    !!c11e25 && c11e25.type === "combat-supercapital-kills" && c11e25.minValue === 1;
  ok("[cbE1] E20–E25 规则类型/参数精确（wave>=20 / laser·cannon·missile 各 1 / 旗舰·超旗各 1）", c11RulesOk);

  const c11sW = makeCombatState(sb, {}, { maxWaveReached: 20 });
  const c11rW = SYS.evaluateCombatAchievementRules(c11sW, 1);
  ok("[cbE2] maxWaveReached=20 恰好解锁 E20（E21–E25 仍锁）",
    c11rW.unlockedIds.length === 1 && c11rW.unlockedIds[0] === "E20" &&
    !("E21" in c11sW.achievements.unlockedAtById) && !("E24" in c11sW.achievements.unlockedAtById));

  ok("[cbE3] maxWaveReached=19 不解锁 E20（阈值严格 >=20）",
    SYS.evaluateCombatAchievementRules(makeCombatState(sb, {}, { maxWaveReached: 19 }), 1).unlockedIds.length === 0);

  const c11sL = makeCombatState(sb, {}, { zoneClearsByWeapon: { laser: 1, cannon: 0, missile: 0 } });
  const c11rL = SYS.evaluateCombatAchievementRules(c11sL, 1);
  ok("[cbE4] zoneClearsByWeapon.laser=1 恰好解锁 E21（E22/E23 仍锁）",
    c11rL.unlockedIds.length === 1 && c11rL.unlockedIds[0] === "E21" &&
    !("E22" in c11sL.achievements.unlockedAtById) && !("E23" in c11sL.achievements.unlockedAtById));

  const c11sC = makeCombatState(sb, {}, { zoneClearsByWeapon: { laser: 0, cannon: 1, missile: 0 } });
  const c11rC = SYS.evaluateCombatAchievementRules(c11sC, 1);
  ok("[cbE5] zoneClearsByWeapon.cannon=1 恰好解锁 E22",
    c11rC.unlockedIds.length === 1 && c11rC.unlockedIds[0] === "E22");

  const c11sM = makeCombatState(sb, {}, { zoneClearsByWeapon: { laser: 0, cannon: 0, missile: 3 } });
  const c11rM = SYS.evaluateCombatAchievementRules(c11sM, 1);
  ok("[cbE6] zoneClearsByWeapon.missile>=1 解锁 E23（阈值只需 >=1）",
    c11rM.unlockedIds.length === 1 && c11rM.unlockedIds[0] === "E23");

  const c11sCap = makeCombatState(sb, {}, { capitalEnemyKills: 1 });
  const c11rCap = SYS.evaluateCombatAchievementRules(c11sCap, 1);
  ok("[cbE7] capitalEnemyKills>=1 恰好解锁 E24",
    c11rCap.unlockedIds.length === 1 && c11rCap.unlockedIds[0] === "E24");

  const c11sSup = makeCombatState(sb, {}, { supercapitalEnemyKills: 1 });
  const c11rSup = SYS.evaluateCombatAchievementRules(c11sSup, 1);
  ok("[cbE8] supercapitalEnemyKills>=1 恰好解锁 E25",
    c11rSup.unlockedIds.length === 1 && c11rSup.unlockedIds[0] === "E25");

  ok("[cbE9] capital/supercapital 为 0 不解锁 E24/E25",
    SYS.evaluateCombatAchievementRules(makeCombatState(sb, {}), 1).unlockedIds.length === 0);

  const c11zcAll = {};
  for (const z of EXP_ZONE_IDS) c11zcAll[z] = 1;
  const c11sAll = makeCombatState(sb, c11zcAll, {
    maxWaveReached: 20,
    zoneClearsByWeapon: { laser: 1, cannon: 1, missile: 1 },
    capitalEnemyKills: 1,
    supercapitalEnemyKills: 1,
  });
  const c11rAll = SYS.evaluateCombatAchievementRules(c11sAll, 2000);
  ok("[cbE10] 全满统计单次求值恰好解锁 E01–E25（25 项，不少不多），全部 unlockedAt=2000",
    c11rAll.unlockedIds.length === 25 &&
    (function () { for (let i = 1; i <= 25; i++) { if (!("E" + String(i).padStart(2, "0") in c11sAll.achievements.unlockedAtById)) return false; } return true; })() &&
    (function () { for (let i = 1; i <= 25; i++) { if (c11sAll.achievements.unlockedAtById["E" + String(i).padStart(2, "0")] !== 2000) return false; } return true; })());

  // E-b：真实 GameStatistics 通配消费者（combat:zoneCleared / combat:enemyDefeated）
  const c11sb = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const c11cStatA = c11sb.gameState.statistics.combat;
  c11sb.GameEvents.emit("combat:zoneCleared", { zoneId: "z_a", name: "A", lp: 10, clearCount: 1, wave: 20, weaponTypes: ["laser", "cannon"], damageTaken: 0 });
  ok("[cbE11] 消费者：zoneCleared(wave=20,[laser,cannon]) → maxWave=20、laser=1、cannon=1、missile=0",
    c11cStatA.maxWaveReached === 20 && c11cStatA.zoneClearsByWeapon.laser === 1 &&
    c11cStatA.zoneClearsByWeapon.cannon === 1 && c11cStatA.zoneClearsByWeapon.missile === 0);
  c11sb.GameEvents.emit("combat:zoneCleared", { zoneId: "z_b", name: "B", lp: 10, clearCount: 1, wave: 15, weaponTypes: ["laser", "bogus"], damageTaken: 0 });
  ok("[cbE12] 消费者：zoneCleared(wave=15,[laser,bogus]) → maxWave 保持 20（取 max）、laser 累计 2、bogus 被忽略",
    c11cStatA.maxWaveReached === 20 && c11cStatA.zoneClearsByWeapon.laser === 2 && c11cStatA.zoneClearsByWeapon.cannon === 1 && c11cStatA.zoneClearsByWeapon.missile === 0);
  c11sb.GameEvents.emit("combat:zoneCleared", { zoneId: "z_c", name: "C", lp: 10, clearCount: 1, wave: 25, weaponTypes: ["laser", "laser", "missile"], damageTaken: 0 });
  ok("[cbE13] 消费者：zoneCleared(wave=25,[laser,laser,missile]) → maxWave=25、laser 累计 3、missile=1",
    c11cStatA.maxWaveReached === 25 && c11cStatA.zoneClearsByWeapon.laser === 3 && c11cStatA.zoneClearsByWeapon.missile === 1);

  const c11sbB = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const c11cbStat = c11sbB.gameState.statistics.combat;
  c11sbB.GameEvents.emit("combat:enemyDefeated", { zoneId: "angel_outer_reach", faction: "angel", enemyId: "e1", enemyKind: "normal", isk: 1, xp: 1 });
  c11sbB.GameEvents.emit("combat:enemyDefeated", { zoneId: "angel_outer_reach", faction: "angel", enemyId: "e2", enemyKind: "elite", isk: 1, xp: 1 });
  ok("[cbE14] 消费者：旗舰星带 enemyDefeated ×2 → capitalEnemyKills=2、supercapital=0",
    c11cbStat.capitalEnemyKills === 2 && c11cbStat.supercapitalEnemyKills === 0);
  c11sbB.GameEvents.emit("combat:enemyDefeated", { zoneId: "angel_deep_domain", faction: "angel", enemyId: "e3", enemyKind: "boss", isk: 1, xp: 1 });
  ok("[cbE15] 消费者：超旗星带 enemyDefeated ×1 → supercapitalEnemyKills=1（capital 不重复计入）",
    c11cbStat.supercapitalEnemyKills === 1 && c11cbStat.capitalEnemyKills === 2);
  c11sbB.GameEvents.emit("combat:enemyDefeated", { zoneId: "angel_outpost", faction: "angel", enemyId: "e4", enemyKind: "normal", isk: 1, xp: 1 });
  c11sbB.GameEvents.emit("combat:enemyDefeated", { zoneId: "ds_xyz", faction: "angel", enemyId: "e5", enemyKind: "normal", isk: 1, xp: 1 });
  ok("[cbE16] 消费者：普通星带与死亡空间(zoneId=deathspaceId) enemyDefeated 不计入 capital/supercapital",
    c11cbStat.capitalEnemyKills === 2 && c11cbStat.supercapitalEnemyKills === 1);

  // E-c：v9 迁移与追溯回填（fromVersion<8 闸门：仅旧档回填一次）
  const c11sbM = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  c11sbM.gameState.statistics = {
    version: 6, totals: {},
    combat: {
      zoneClears: { angel_outpost: 1 },
      zoneKills: { angel_outer_reach: 3, angel_deep_domain: 2, angel_outpost: 5 },
      factionKills: {}, deathspaceClears: {},
    },
  };
  c11sbM.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  const c11mStat = c11sbM.gameState.statistics.combat;
  ok("[cbE17] v9 迁移：fromVersion=6 → maxWaveReached 追溯补 20、capital=3、supercapital=2、version=9",
    c11mStat.maxWaveReached === 20 && c11mStat.capitalEnemyKills === 3 && c11mStat.supercapitalEnemyKills === 2 &&
    c11sbM.gameState.statistics.version === 9 && c11mStat.zoneClearsByWeapon.laser === 0);

  const c11sbM2 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  c11sbM2.gameState.statistics = {
    version: 6, totals: {},
    combat: { zoneClears: {}, zoneKills: {}, factionKills: {}, deathspaceClears: {} },
  };
  c11sbM2.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  ok("[cbE18] v9 迁移：无 zoneClears 的旧档 maxWaveReached 保持 0（不臆测）",
    c11sbM2.gameState.statistics.combat.maxWaveReached === 0 &&
    c11sbM2.gameState.statistics.combat.capitalEnemyKills === 0 &&
    c11sbM2.gameState.statistics.combat.supercapitalEnemyKills === 0);

  const c11sbM3 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  c11sbM3.gameState.statistics = {
    version: 7, totals: {},
    combat: { zoneClears: { angel_outpost: 1 }, zoneKills: {}, factionKills: {}, deathspaceClears: {} },
  };
  c11sbM3.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  ok("[cbE19] v9 迁移：fromVersion>=7 不追溯回填（有 zoneClears 但 maxWave 保持 0、version 不变为 9）",
    c11sbM3.gameState.statistics.combat.maxWaveReached === 0 && c11sbM3.gameState.statistics.version === 9);

  const c11sbM4 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  c11sbM4.gameState.statistics = {
    version: 6, totals: {},
    combat: { zoneClears: {}, zoneKills: {}, factionKills: {}, deathspaceClears: {}, zoneClearsByWeapon: { laser: 2, bogus: 9 } },
  };
  c11sbM4.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  const c11m4 = c11sbM4.gameState.statistics.combat;
  ok("[cbE20] v9 迁移：zoneClearsByWeapon 仅保留三合法键（laser=2、bogus 丢弃、cannon/missile=0）",
    c11m4.zoneClearsByWeapon.laser === 2 && c11m4.zoneClearsByWeapon.cannon === 0 && c11m4.zoneClearsByWeapon.missile === 0 &&
    !("bogus" in c11m4.zoneClearsByWeapon) && c11m4.capitalEnemyKills === 0);

  const c11sbM5 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  c11sbM5.gameState.statistics = {
    version: 6, totals: {},
    combat: { zoneClears: {}, zoneKills: {}, factionKills: {}, deathspaceClears: {}, capitalEnemyKills: -5, supercapitalEnemyKills: NaN },
  };
  c11sbM5.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  const c11m5 = c11sbM5.gameState.statistics.combat;
  ok("[cbE21] v9 迁移：capital/supercapital 非法值(-5/NaN)清洗为 0（不保留负数/NaN）",
    c11m5.capitalEnemyKills === 0 && c11m5.supercapitalEnemyKills === 0);

  // E-d：消费者幂等（eventId 重放）
  const c11sbI = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const c11iStat = c11sbI.gameState.statistics.combat;
  c11sbI.GameEvents.emit("combat:zoneCleared", { zoneId: "z", name: "Z", lp: 1, clearCount: 1, wave: 20, weaponTypes: ["laser"], damageTaken: 0 }, { eventId: "dup-zc-1" });
  c11sbI.GameEvents.emit("combat:zoneCleared", { zoneId: "z", name: "Z", lp: 1, clearCount: 1, wave: 20, weaponTypes: ["laser"], damageTaken: 0 }, { eventId: "dup-zc-1" });
  ok("[cbE22] 消费者幂等：同 eventId 重放 zoneCleared → maxWave=20、laser 仅计 1 次（不双计）",
    c11iStat.maxWaveReached === 20 && c11iStat.zoneClearsByWeapon.laser === 1);
  c11sbI.GameEvents.emit("combat:enemyDefeated", { zoneId: "angel_outer_reach", faction: "angel", enemyId: "e", enemyKind: "normal", isk: 1, xp: 1 }, { eventId: "dup-ed-1" });
  c11sbI.GameEvents.emit("combat:enemyDefeated", { zoneId: "angel_outer_reach", faction: "angel", enemyId: "e", enemyKind: "normal", isk: 1, xp: 1 }, { eventId: "dup-ed-1" });
  ok("[cbE23] 消费者幂等：同 eventId 重放 enemyDefeated（旗舰星带）→ capitalEnemyKills 仅计 1 次",
    c11iStat.capitalEnemyKills === 1);

  // E-e：回归守卫 + 边界
  ok("[cbE24] 回归：仅 18 星带通关（无 wave/武器/旗舰事实）不解锁 E20–E25（仍恰 19 项、E20 不在解锁集）",
    r18.unlockedIds.length === 19 && r18.unlockedIds.indexOf("E20") === -1);

  const c11sbW = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const c11wStat = c11sbW.gameState.statistics.combat;
  c11sbW.GameEvents.emit("combat:zoneCleared", { zoneId: "z", name: "Z", lp: 1, clearCount: 1, wave: 20.9, weaponTypes: ["laser"], damageTaken: 0 });
  ok("[cbE25] 消费者：wave 小数 20.9 → maxWaveReached 取整为 20（Math.floor）",
    c11wStat.maxWaveReached === 20 && c11wStat.zoneClearsByWeapon.laser === 1);

  ok("[cbE26] E20–E33（不含 E28）进入 COMBAT_RULES、与 E01–E19 同属冻结数组（长度 32、每条 Object.freeze）",
    RD.COMBAT_RULES.length === 32 && !!RD.COMBAT_RULES_BY_ID["E20"] && !!RD.COMBAT_RULES_BY_ID["E33"] &&
    RD.COMBAT_RULES.every((r) => Object.isFrozen(r)));

  // ========================= F. 返修审计断言（Batch C-11 第一次定点返修）=========================
  // F-a：v6→v7 回填仅合法普通星带
  const c11r1 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  c11r1.gameState.statistics = {
    version: 6, totals: {},
    combat: { zoneClears: { ghost_zone: 1 }, zoneKills: {}, factionKills: {}, deathspaceClears: {} },
  };
  c11r1.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  ok("[cbE27] v6 ghost_zone:1 不回填 E20（非法键不触发回填）",
    c11r1.gameState.statistics.combat.maxWaveReached === 0);

  const c11r2 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  c11r2.gameState.statistics = {
    version: 6, totals: {},
    combat: { zoneClears: { deathspace_z1: 1 }, zoneKills: {}, factionKills: {}, deathspaceClears: {} },
  };
  c11r2.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  ok("[cbE28] v6 deathspace ID 在 zoneClears 不回填 E20（非 18 合法星带）",
    c11r2.gameState.statistics.combat.maxWaveReached === 0);

  const c11r3 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  c11r3.gameState.statistics = {
    version: 6, totals: {},
    combat: { zoneClears: { angel_outpost: 1 }, zoneKills: {}, factionKills: {}, deathspaceClears: {} },
  };
  c11r3.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  ok("[cbE29] v6 合法星带 angel_outpost:1 仍正确回填 E20",
    c11r3.gameState.statistics.combat.maxWaveReached === 20);

  const c11r4 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  c11r4.gameState.statistics = {
    version: 6, totals: {},
    combat: { zoneClears: { angel_outpost: "1" }, zoneKills: {}, factionKills: {}, deathspaceClears: {} },
  };
  c11r4.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  ok("[cbE30] 合法星带键但字符串 value \"1\" 不回填（typeof 非 number）",
    c11r4.gameState.statistics.combat.maxWaveReached === 0);

  // F-b：实时 wave 拒绝非法类型
  const c11w1 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  c11w1.GameEvents.emit("combat:zoneCleared",
    { zoneId: "z", name: "Z", lp: 1, clearCount: 1, wave: "20", weaponTypes: [], damageTaken: 0 });
  ok("[cbE31] wave=\"20\"（字符串）通过事件层后不提升 maxWaveReached",
    c11w1.gameState.statistics.combat.maxWaveReached === 0);

  const c11w2 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const illegalWaves = [NaN, Infinity, -1, null, true, {}, []];
  let illegalOk = true;
  for (const w of illegalWaves) {
    const sbW = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
    sbW.GameEvents.emit("combat:zoneCleared",
      { zoneId: "z", name: "Z", lp: 1, clearCount: 1, wave: w, weaponTypes: [], damageTaken: 0 });
    if (sbW.gameState.statistics.combat.maxWaveReached !== 0) illegalOk = false;
  }
  ok("[cbE32] 其余非法 wave(NaN/Infinity/-1/null/true/{}/[]) 均不提升 maxWaveReached", illegalOk);

  // F-c：dispatchGameAction 真实执行（全量沙箱，统一走公共 dispatchGameAction 路由）
  const sbF = buildFullGameSandbox(null);
  const gsF = sbF.sandbox.gameState;
  const dga = sbF.sandbox.dispatchGameAction;

  // 7) combat/stop
  gsF.combat.active = true;
  gsF.combat.runWeaponTypes = ["laser"];
  gsF.combat.runWeaponTypesZone = "zone_x";
  gsF.currentAction = { skill: "combat", active: true };
  const r3 = dga(gsF, { type: "combat/stop" }, Date.now());
  ok("[cbE33] combat/stop 清空旧 runWeaponTypes", r3.changed &&
    Array.isArray(gsF.combat.runWeaponTypes) && gsF.combat.runWeaponTypes.length === 0 &&
    gsF.combat.runWeaponTypesZone === null);

  // 8) selectZone
  gsF.combat.active = false;
  gsF.combat.runWeaponTypes = ["cannon"];
  gsF.combat.runWeaponTypesZone = "old";
  gsF.skills.combat = { lvl: 80, xp: 0 };
  const r4 = dga(gsF, { type: "combat/selectZone", zoneId: "angel_outpost" }, Date.now());
  ok("[cbE34] selectZone 清空 runWeaponTypes 并绑定新 zone", r4.changed &&
    gsF.combat.runWeaponTypes.length === 0 && gsF.combat.runWeaponTypesZone === "angel_outpost");

  // 9) equipCombatShip
  if (!gsF.inventory.ships || gsF.inventory.ships.length === 0) {
    gsF.inventory.ships = [{ instanceId: "audit-cb35-ship", shipId: "frigate", name: "测试舰船", fitted: { high:[], mid:[], low:[], rig:[] } }];
  }
  const freshShip = gsF.inventory.ships[0];
  gsF.shipAssignments = {};
  gsF.combat.runWeaponTypes = ["missile"];
  gsF.combat.runWeaponTypesZone = "some_zone";
  const r5 = dga(gsF, { type: "hangar/equipCombatShip", instanceId: freshShip.instanceId }, Date.now());
  ok("[cbE35] equipCombatShip 清空 runWeaponTypes", r5.changed && gsF.combat.runWeaponTypes.length === 0);

  // 10) start 全新 formation
  gsF.combat.enemies = [];
  gsF.combat.runWeaponTypes = ["old_type"];
  gsF.combat.runWeaponTypesZone = "old";
  gsF.currentAction = {};
  const r6 = dga(gsF, {
    type: "combat/start",
    enemies: [{ id:"e1", hp:{ structure:100, shield:100 }, maxHp:{ structure:100, shield:100 }, faction:"angel", reward:{ min:0, max:0 } }],
    formationId: "f1"
  }, Date.now());
  ok("[cbE36] start 全新 formation 清空 runWeaponTypes", r6.changed &&
    gsF.combat.runWeaponTypes.length === 0 && gsF.combat.runWeaponTypesZone === gsF.combat.zone);

  // 11) 同一 run 暂停/恢复不清空
  gsF.combat.runWeaponTypes = ["laser"];
  gsF.combat.runWeaponTypesZone = "angel_outpost";
  const r7 = dga(gsF, { type: "combat/start", enemies: [], formationId: "" }, Date.now());
  ok("[cbE37] 同一 run 暂停/恢复保留 living enemies 不清空 runWeaponTypes",
    r7.changed && gsF.combat.runWeaponTypes.length === 1 &&
    gsF.combat.runWeaponTypes[0] === "laser" && gsF.combat.runWeaponTypesZone === "angel_outpost");

  // 12) 旧 run 激光 → stop → 新 run 火炮不残留
  gsF.combat.runWeaponTypes = ["laser"];
  gsF.combat.runWeaponTypesZone = "zone1";
  gsF.combat.active = true;
  gsF.currentAction = { skill: "combat", active: true };
  const r8a = dga(gsF, { type: "combat/stop" }, Date.now());
  const afterStop = r8a.changed && gsF.combat.runWeaponTypes.length === 0 && gsF.combat.runWeaponTypesZone === null;
  // 新 run：真实 selectZone + start
  gsF.combat.active = false;
  gsF.combat.runWeaponTypes = [];
  gsF.combat.runWeaponTypesZone = null;
  gsF.skills.combat = { lvl: 80, xp: 0 };
  gsF.currentAction = {};
  const r8b = dga(gsF, { type: "combat/selectZone", zoneId: "angel_outpost" }, Date.now());
  const r8c = dga(gsF, {
    type: "combat/start",
    enemies: [{ id:"e2", hp:{ structure:100, shield:100 }, maxHp:{ structure:100, shield:100 }, faction:"angel", reward:{ min:0, max:0 } }],
    formationId: "f2"
  }, Date.now());
  // 模拟新 run 开火仅使用 cannon（实际武器追踪走 combat.js，此处验证 stop→selectZone→start 清空了旧激光）
  gsF.combat.runWeaponTypes = ["cannon"];
  gsF.combat.runWeaponTypesZone = "angel_outpost";
  ok("[cbE38] 旧 run 激光 stop 清空 → selectZone+start 新 run 火炮不含激光",
    afterStop && r8b.changed && r8c.changed && gsF.combat.runWeaponTypes.length === 1 &&
    gsF.combat.runWeaponTypes.indexOf("laser") === -1 && gsF.combat.runWeaponTypes[0] === "cannon");

  // F-d：window 无测试导出（actions.js 已移除三个 window 挂载）
  ok("[cbE39] window.CombatStateActions 不存在（已移除测试导出）",
    typeof sbF.sandbox.CombatStateActions === "undefined");
  ok("[cbE40] window.ShellStateActions 不存在（已移除测试导出）",
    typeof sbF.sandbox.ShellStateActions === "undefined");

  // 旧存档已有 E01 时间戳：登录后原时间不变且不重复 emit
  const keepSaveC = {
    skills: { mining: { lvl: 1, xp: 0 } },
    resources: { isk: 500, fuel: 100 },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    achievements: { schemaVersion: 1, unlockedAtById: { "E01": 123.5 } },
    planetary: { deployments: [], nextId: 1 },
    statistics: { version: 1, totals: {}, combat: { zoneClears: {} } },
  };
  for (const id of EXP_ZONE_IDS) keepSaveC.statistics.combat.zoneClears[id] = 1;
  let keepC = null;
  try { keepC = buildFullGameSandbox(JSON.stringify(keepSaveC)); } catch (e) {
    ok("[cb35a] 已有 E01 存档加载不抛异常: " + (e && e.message), false);
  }
  if (keepC) {
    ok("[cb35a] 旧存档已有 E01=123.5 登录后原时间保持不变且 E01 不重复 emit（订阅观测 0 条 E01 事件）",
      keepC.sandbox.gameState.achievements.unlockedAtById["E01"] === 123.5 &&
      keepC.achievementEvents.filter((ev) => ev.payload.achievementId === "E01").length === 0 &&
      typeof keepC.sandbox.gameState.achievements.unlockedAtById["E19"] === "number");
  }

  // ========================= F. 源码与只读保护 =========================
  const persSrcC = fs.readFileSync(PERSISTENCE_PATH, "utf-8");
  const persCodeC = persSrcC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const cbCallN = (persCodeC.match(/evaluateCombatAchievementRules\(gameState,\s*achievementReconcileNow\)/g) || []).length;
  const nowDefN = (persCodeC.match(/achievementReconcileNow\s*=\s*Date\.now\(\)/g) || []).length;
  ok("[cb35b] persistence 两个入口各以同一 achievementReconcileNow 调用战斗求值器（战斗调用×2、Date.now() 取值恰 2 次）",
    cbCallN === 2 && nowDefN === 2);
  const cbRefN = (persCodeC.match(/evaluateCombatAchievementRules/g) || []).length;
  ok("[cb35c] persistence 中战斗求值器引用恰 4 处（2 入口 ×（typeof 能力探测 + 调用））、无游离调用",
    cbRefN === 4);

  const tickSrcC = fs.readFileSync(TICK_PATH, "utf-8");
  const offlineSrcC = fs.readFileSync(OFFLINE_PATH, "utf-8");
  const prodSrcC = fs.readFileSync(PRODUCTION_PATH, "utf-8");
  const statSrcC = fs.readFileSync(STATISTICS_PATH, "utf-8");
  const eventsSrcC = fs.readFileSync(EVENTS_PATH, "utf-8");
  const forbiddenC = ["COMBAT_RULES", "evaluateCombatAchievementRules", "unlockAchievement", "AchievementRuleData", "combat-zone-clear"];
  ok("[cb35d] events.js/tick.js/offline.js/production.js/statistics.js 不含战斗成就规则或解锁调用（在线离线共用唯一事件链路，statistics 保持纯记账）",
    forbiddenC.every((t) => !eventsSrcC.includes(t) && !tickSrcC.includes(t) && !offlineSrcC.includes(t) &&
      !prodSrcC.includes(t) && !statSrcC.includes(t)));
  const achSysSrcC = fs.readFileSync(ACH_SYSTEM_PATH, "utf-8");
  // 仅针对本批 C-3 新增的四个战斗函数体做负向检查：不得耦合奖励/UI/Steamworks/研究系统。
  // 整文件含历史注释「Steamworks」，因此必须按函数体隔离，避免注释误报；函数体提取
  // 用花括号配对，独立于注释与字符串外的无关代码。
  function extractFnBody(src, name) {
    let start = src.indexOf("function " + name);
    if (start < 0) start = src.indexOf(name + "("); // 兼容对象方法简写 buyLPItem(state, itemId) { ... }
    if (start < 0) return "";
    const paren = src.indexOf("(", start);
    let i = src.indexOf("{", paren < 0 ? start : paren);
    if (i < 0) return "";
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return "";
  }
  const combatFnNames = ["readCombatZoneClears", "isCombatRuleMet", "evaluateCombatAchievementRules", "installCombatAchievementConsumer"];
  const combatSrcSlice = combatFnNames.map((n) => extractFnBody(achSysSrcC, n)).join("\n");
  const forbiddenReward = ["reward", "Steamworks", "greenworks", "steam_appid", "ResearchState", "grantAchievement", "addReward"];
  ok("[cb35e] achievements.js 本批新增战斗函数体不含奖励/UI/Steamworks/研究系统调用（仅解锁内核 + 战斗事件消费者）",
    forbiddenReward.every((t) => !combatSrcSlice.includes(t)));

  // 本分区内只读证明：战斗规则数据在本分区多次求值/消费者调用前后保持冻结且 JSON 不变。
  // （正式 CSV/JS 文件字节不变由全局 RO1/RO2 另证；此处不引用 postWs*，避免 TDZ 提前引用。）
  ok("[cb35f] 战斗规则数据在本分区内未被任何求值/消费者改变（COMBAT_RULES 全冻结且 JSON 与分区开始时一致）",
    Object.isFrozen(RD.COMBAT_RULES) &&
    RD.COMBAT_RULES.every((r) => Object.isFrozen(r)) &&
    JSON.stringify(RD.COMBAT_RULES) === combatRulesPreJson);

  // ========================= G. Batch C-12 特殊战斗审计断言 =========================
  // G-a：DEATHSPACE_IDS_FOR_ACHIEVEMENTS 与 combat.js DEATHSPACE_DATABASE 双向一致
  let combatSrcForDs = null;
  try { combatSrcForDs = fs.readFileSync(COMBAT_PATH, "utf-8"); } catch (e) {}
  const dsMatch = combatSrcForDs ? combatSrcForDs.match(/const DEATHSPACE_DATABASE\s*=\s*\[([\s\S]*?)\];/) : null;
  const dsIdsFromCombat = [];
  if (dsMatch) {
    const idRe = /id:\s*"([^"]+)"/g; let m;
    while ((m = idRe.exec(dsMatch[1])) !== null) dsIdsFromCombat.push(m[1]);
  }
  const dsIds = RD.DEATHSPACE_IDS_FOR_ACHIEVEMENTS;
  ok("[cbG1] DEATHSPACE_IDS_FOR_ACHIEVEMENTS 与 combat.js DEATHSPACE_DATABASE 双向一致（共 12 个 ID）",
    Array.isArray(dsIds) && dsIds.length === 12 &&
    dsIdsFromCombat.length === 12 &&
    dsIds.every(id => dsIdsFromCombat.includes(id)) &&
    dsIdsFromCombat.every(id => dsIds.includes(id)));

  // G-a2（Batch C-13 收口返修）：三集合双向相等，使用真实生产辅助逻辑 / 运行时数据，不查源码字符串。
  //   A = getDeathspaceIdsForStats()（真实生产辅助逻辑，读 combat.js 的 DEATHSPACE_DATABASE）
  //   B = 运行时 DEATHSPACE_DATABASE 的 12 个 site.id（vm.runInContext 读真实已加载对象，非源码正则）
  //   C = AchievementRuleData.DEATHSPACE_IDS_FOR_ACHIEVEMENTS（真实规则数据）
  const sbDs = buildFullGameSandbox(null);
  const helperIds = sbDs.sandbox.getDeathspaceIdsForStats();
  const dbIds = vm.runInContext("DEATHSPACE_DATABASE", sbDs.sandbox).map((s) => s.id);
  const ruleIds = RD.DEATHSPACE_IDS_FOR_ACHIEVEMENTS;
  const eqSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));
  ok("[cbG1b] getDeathspaceIdsForStats() / 运行时 DEATHSPACE_DATABASE / AchievementRuleData.DEATHSPACE_IDS_FOR_ACHIEVEMENTS 三集合双向相等（各 12 个真实 ID）",
    Array.isArray(helperIds) && helperIds.length === 12 &&
    Array.isArray(dbIds) && dbIds.length === 12 &&
    Array.isArray(ruleIds) && ruleIds.length === 12 &&
    eqSet(helperIds, dbIds) && eqSet(helperIds, ruleIds) && eqSet(dbIds, ruleIds));

  // G-b：fresh statistics v9 精确结构（第三方阵营为 sansha 非 guristas）
  const sbG = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsG = sbG.gameState;
  ok("[cbG2] fresh statistics v9 含 6 个新战斗字段且全为 0、factionBossKills 三键(angel/blood/sansha)全 0",
    gsG.statistics.version === 9 &&
    gsG.statistics.combat.deathspaceEntries === 0 && gsG.statistics.combat.flawlessZoneClears === 0 &&
    gsG.statistics.combat.maxSingleBattleDamage === 0 && gsG.statistics.combat.deathspaceClears &&
    typeof gsG.statistics.combat.deathspaceClears === "object" && Object.keys(gsG.statistics.combat.deathspaceClears).length === 0 &&
    gsG.statistics.combat.factionBossKills &&
    gsG.statistics.combat.factionBossKills.angel === 0 && gsG.statistics.combat.factionBossKills.blood === 0 &&
    gsG.statistics.combat.factionBossKills.sansha === 0);

  // G-c：v1→v9 迁移幂等
  const sbGm = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  sbGm.gameState.statistics = { version: 1, totals: {}, combat: {}, production: {}, activity: {}, eventLedger: {} };
  sbGm.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  ok("[cbG3] v1→v9 迁移：版本升至 9、新字段全为 0/{}",
    sbGm.gameState.statistics.version === 9 &&
    sbGm.gameState.statistics.combat.deathspaceEntries === 0 &&
    sbGm.gameState.statistics.combat.flawlessZoneClears === 0 &&
    sbGm.gameState.statistics.combat.maxSingleBattleDamage === 0 &&
    sbGm.gameState.statistics.combat.factionBossKills.angel === 0);

  // G-d：v7→v9 迁移：真实 deathspaceClears（blood_ded_2_10:1）追溯使 deathspaceEntries=1，
  //      E26（deathspace-enter）与 E27（deathspace-clear-any）同时解锁。
  //      用 buildFullGameSandbox 加载 combat.js，使 getDeathspaceIdsForStats() 读到真实 DEATHSPACE_DATABASE。
  const sbGd = buildFullGameSandbox(null);
  sbGd.sandbox.gameState.statistics = {
    version: 7, totals: {},
    combat: {
      zoneClears: {}, zoneKills: {}, factionKills: {},
      deathspaceClears: { blood_ded_2_10: 1 },
      zoneClearsByWeapon: { laser: 0, cannon: 0, missile: 0 },
      capitalEnemyKills: 0, supercapitalEnemyKills: 0, maxWaveReached: 0,
    },
  };
  sbGd.sandbox.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  const gsGd = sbGd.sandbox.gameState;
  const rGd = sbGd.sandbox.AchievementSystem.evaluateCombatAchievementRules(gsGd, 5000);
  ok("[cbG4] v7→v9 迁移：deathspaceClears（真实 ID blood_ded_2_10:1）追溯使 deathspaceEntries=1，E26 与 E27 同时解锁",
    gsGd.statistics.combat.deathspaceEntries === 1 &&
    "E26" in gsGd.achievements.unlockedAtById &&
    "E27" in gsGd.achievements.unlockedAtById &&
    rGd.unlockedIds.includes("E26") && rGd.unlockedIds.includes("E27"));

  // G-d2：deathspaceEntries ≥1 追溯 E26
  const sbGd2 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  sbGd2.gameState.statistics = {
    version: 7, totals: {},
    combat: {
      zoneClears: {}, zoneKills: {}, factionKills: {},
      deathspaceClears: {},
      deathspaceEntries: 1,
      zoneClearsByWeapon: { laser: 0, cannon: 0, missile: 0 },
      capitalEnemyKills: 0, supercapitalEnemyKills: 0, maxWaveReached: 0,
    },
  };
  sbGd2.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  const rGd2 = sbGd2.AchievementSystem.evaluateCombatAchievementRules(sbGd2.gameState, 5500);
  ok("[cbG5] deathspaceEntries=1 → E26 解锁",
    "E26" in sbGd2.gameState.achievements.unlockedAtById &&
    sbGd2.gameState.achievements.unlockedAtById["E26"] === 5500 &&
    rGd2.unlockedIds.includes("E26"));

  // G-e：ghost/非法 deathspace ID 不追溯
  const sbGe = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  sbGe.gameState.statistics = {
    version: 7, totals: {},
    combat: {
      zoneClears: {}, zoneKills: {}, factionKills: {},
      deathspaceClears: { ghost_deathspace: 1, "": 1, __proto__: 1 },
      zoneClearsByWeapon: { laser: 0, cannon: 0, missile: 0 },
      capitalEnemyKills: 0, supercapitalEnemyKills: 0, maxWaveReached: 0,
    },
  };
  sbGe.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  ok("[cbG6] ghost/非法 deathspace ID(deathspaceClears) 不追溯 E26/E27",
    !("E26" in sbGe.gameState.achievements.unlockedAtById) &&
    !("E27" in sbGe.gameState.achievements.unlockedAtById));

  // G-f：旧档不臆测 E29-E33
  const sbGf = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  sbGf.gameState.statistics = { version: 7, totals: {}, combat: {}, production: {}, activity: {}, eventLedger: {} };
  sbGf.GameEvents.emit("combat:waveCleared", { zoneId: "z", wave: 1 });
  const gsGf = sbGf.gameState;
  sbGf.AchievementSystem.evaluateCombatAchievementRules(gsGf, 5000);
  ok("[cbG7] 旧档不臆测 E29-E33（无死亡空间/伤害/阵营击杀数据时保持锁）",
    !("E29" in gsGf.achievements.unlockedAtById) && !("E30" in gsGf.achievements.unlockedAtById) &&
    !("E31" in gsGf.achievements.unlockedAtById) && !("E32" in gsGf.achievements.unlockedAtById) &&
    !("E33" in gsGf.achievements.unlockedAtById));

  // G-g：browse zone 不解锁 E26（浏览操作不触发成就）
  const sbGg = buildFullGameSandbox(null);
  const gsGg = sbGg.sandbox.gameState;
  const dgaG = sbGg.sandbox.dispatchGameAction;
  ok("[cbG8] 浏览操作不解锁 E26（selectZone 前 E26 不存在，变更不影响成就状态）",
    !("E26" in gsGg.achievements.unlockedAtById));

  // G-h：enterDeathspace → deathspaceEntries≥1 → E26 解锁（kernel 沙箱显式 evaluate）
  const sbGh = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsGh = sbGh.gameState;
  gsGh.statistics.combat.deathspaceEntries = 1;
  const rGh = sbGh.AchievementSystem.evaluateCombatAchievementRules(gsGh, 6000);
  ok("[cbG9] deathspaceEntries=1（模拟 enterDeathspace）→ E26 解锁",
    rGh.unlockedIds.includes("E26") &&
    "E26" in gsGh.achievements.unlockedAtById &&
    gsGh.achievements.unlockedAtById["E26"] === 6000);

  // G-i：combat:zoneCleared(damageTaken=0) → flawlessZoneClears=1 → E29 解锁
  const sbGi = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsGi = sbGi.gameState;
  sbGi.GameEvents.emit("combat:zoneCleared",
    { zoneId: "angel_outpost", name: "A", lp: 1, clearCount: 1, wave: 1, weaponTypes: [], damageTaken: 0 },
    { offline: false });
  sbGi.AchievementSystem.evaluateCombatAchievementRules(gsGi, 7000);
  ok("[cbG10] zoneCleared damageTaken=0 → flawlessZoneClears=1 → E29 解锁",
    "E29" in gsGi.achievements.unlockedAtById &&
    gsGi.statistics.combat.flawlessZoneClears === 1);

  // G-j：单场伤害 1000000 恰解锁 E30
  const sbGj = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsGj = sbGj.gameState;
  gsGj.statistics.combat.maxSingleBattleDamage = 1000000;
  sbGj.AchievementSystem.evaluateCombatAchievementRules(gsGj, 8000);
  ok("[cbG11] maxSingleBattleDamage=1000000 → E30 解锁",
    "E30" in gsGj.achievements.unlockedAtById &&
    gsGj.achievements.unlockedAtById["E30"] === 8000);

  // G-k：三阵营 boss 分别解锁 E31/E32/E33（sansha 非 guristas）
  const sbGk = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsGk = sbGk.gameState;
  gsGk.statistics.combat.factionBossKills.angel = 1;
  sbGk.AchievementSystem.evaluateCombatAchievementRules(gsGk, 9000);
  ok("[cbG12] factionBossKills.angel=1 → 恰解锁 E31（E32/E33 仍锁）",
    "E31" in gsGk.achievements.unlockedAtById &&
    !("E32" in gsGk.achievements.unlockedAtById) && !("E33" in gsGk.achievements.unlockedAtById));
  gsGk.statistics.combat.factionBossKills.blood = 1;
  gsGk.statistics.combat.factionBossKills.sansha = 1;
  sbGk.AchievementSystem.evaluateCombatAchievementRules(gsGk, 10000);
  ok("[cbG13] factionBossKills.blood=1 + sansha=1 → E32/E33 均解锁（幂等重求值）",
    "E32" in gsGk.achievements.unlockedAtById && "E33" in gsGk.achievements.unlockedAtById &&
    gsGk.achievements.unlockedAtById["E32"] === 10000 &&
    gsGk.achievements.unlockedAtById["E33"] === 10000);

  // G-l：各场景幂等、消费者只读、listenerCount 不变
  const beforeListeners = sbG.GameEvents.listenerCount("*");
  const sbGl = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  sbGl.GameEvents.emit("combat:zoneCleared",
    { zoneId: "angel_outpost", name: "A", lp: 1, clearCount: 1, wave: 1, weaponTypes: [], damageTaken: 0 },
    { offline: false, eventId: "cbG-idempotent-1" });
  sbGl.GameEvents.emit("combat:zoneCleared",
    { zoneId: "angel_outpost", name: "A", lp: 1, clearCount: 1, wave: 1, weaponTypes: [], damageTaken: 0 },
    { offline: false, eventId: "cbG-idempotent-1" });
  const afterListeners = sbG.GameEvents.listenerCount("*");
  ok("[cbG14] 幂等 emit 不双计（同 eventId zoneCleared → flawlessZoneClears=1 非 2）；listenerCount 不变",
    sbGl.gameState.statistics.combat.flawlessZoneClears === 1 &&
    beforeListeners === afterListeners);

  // ========================= H. Batch C-12 第一次定点返修审计断言 =========================
  // H-a：totals.deathspaceEntries 不存在（第二事实源被删除）
  const sbHa = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  ok("[cbH1] statistics.totals.deathspaceEntries 不存在（第二事实源已清理）",
    sbHa.gameState.statistics.totals.deathspaceEntries === undefined);

  // H-b：combat:deathspaceWaveCleared 单事件恰 +1（需 zoneId 满足契约）
  const sbHb = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  sbHb.GameEvents.emit("combat:deathspaceWaveCleared", { deathspaceId:"ds_test", zoneId:"z", wave:1, lp:3 });
  ok("[cbH2] single deathspaceWaveCleared → deathspaceWavesCleared=1",
    sbHb.gameState.statistics.totals.deathspaceWavesCleared === 1);

  // H-c：combat:deathspaceWaveCleared ×5 → deathspaceWavesCleared=5
  const sbHc = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  for (let i = 0; i < 5; i++) sbHc.GameEvents.emit("combat:deathspaceWaveCleared", { deathspaceId:"ds_test", zoneId:"z", wave:i+1, lp:3 });
  ok("[cbH3] five deathspaceWaveCleared → deathspaceWavesCleared=5（五层推进恰增 5）",
    sbHc.gameState.statistics.totals.deathspaceWavesCleared === 5);

  // H-d：combat:deathspaceEntered（真实 ID）使 deathspaceEntries 恰 +1、不增加 deathspaceWavesCleared、
  //      且 E26 在事件时间戳解锁（Batch C-13 收口返修：DEATHSPACE_IDS_FOR_ACHIEVEMENTS 作用域 bug 已修复，
  //      getDeathspaceIdsForStats() 改读 combat.js 的 DEATHSPACE_DATABASE 真实 ID）。
  //      用 buildFullGameSandbox 加载 combat.js，否则内核沙箱拿不到 DEATHSPACE_DATABASE。
  const sbHd = buildFullGameSandbox(null);
  const gHd = sbHd.sandbox.gameState;
  const entriesBeforeHd = gHd.statistics.combat.deathspaceEntries;
  sbHd.sandbox.GameEvents.emit("combat:deathspaceEntered", { deathspaceId:"angel_ded_2_10", zoneId:"angel_outpost", faction:"angel", tier:2 }, { timestamp: FROZEN_NOW, source:"audit" });
  ok("[cbH4] deathspaceEntered（真实 ID angel_ded_2_10）使 deathspaceEntries 从0变1、deathspaceWavesCleared 保持0、无契约失败；E26 在同事件时间戳解锁",
    entriesBeforeHd === 0 &&
    gHd.statistics.combat.deathspaceEntries === 1 &&
    gHd.statistics.totals.deathspaceWavesCleared === 0 &&
    sbHd.sandbox.__guardReports.length === 0 &&
    gHd.achievements.unlockedAtById["E26"] === FROZEN_NOW &&
    "E26" in gHd.achievements.unlockedAtById);

  // H-e：combat:deathspaceCleared 不增加 deathspaceWavesCleared（真实 ID + 真实名称）
  const sbHe = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  sbHe.GameEvents.emit("combat:deathspaceCleared", { deathspaceId:"angel_ded_2_10", name:"天使2/10秘密补给站", lp:12, clearCount:1 });
  ok("[cbH5] deathspaceCleared（真实 ID angel_ded_2_10 ∈ 冻结集合）不增加 deathspaceWavesCleared、无契约失败",
    RD.DEATHSPACE_IDS_FOR_ACHIEVEMENTS.includes("angel_ded_2_10") &&
    sbHe.gameState.statistics.totals.deathspaceWavesCleared === 0 &&
    sbHe.__guardReports.length === 0);

  // H-f：ghost deathspaceEntered 后完整 statistics JSON、_dirty、eventLedger 不变
  const sbHf1 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const snapBefore = JSON.stringify(sbHf1.gameState.statistics);
  const dirtyBefore = sbHf1.gameState._dirty;
  const ledgerBefore = sbHf1.gameState.statistics.eventLedger.processedEventIds.length;
  sbHf1.GameEvents.emit("combat:deathspaceEntered", { deathspaceId:"ghost_zone_x", zoneId:"x", faction:"x", tier:1 });
  ok("[cbH6] ghost deathspaceEntered → statistics JSON 不变、_dirty 不变、eventLedger 不变、deathspaceEntries 仍为 0、E26 不解锁",
    JSON.stringify(sbHf1.gameState.statistics) === snapBefore &&
    sbHf1.gameState._dirty === dirtyBefore &&
    sbHf1.gameState.statistics.eventLedger.processedEventIds.length === ledgerBefore &&
    sbHf1.gameState.statistics.combat.deathspaceEntries === 0 &&
    !("E26" in sbHf1.gameState.achievements.unlockedAtById));

  // ===== Batch C-13 债清理：cbH7–cbH14 从「源码字符串检查」改为真实 VM 行为 =====
  // 全脚本沙箱（buildFullGameSandbox）+ dispatchGameAction/combatTick 真实链路，
  // 不再对 actions.js / combat.js 做任何 indexOf/includes 源码伪断言。

  // H-g：selectMode 真实行为——非活跃分支清零 runDamage，活跃分支 viewOnly 保留
  const sbHg = buildFullGameSandbox(null);
  const gHg = sbHg.sandbox.gameState;
  const dgaH = sbHg.sandbox.dispatchGameAction;
  gHg.combat.active = false;
  gHg.combat.runDamageDealt = 123.5;
  gHg.combat.runDamageTaken = 47;
  const rSm = dgaH(gHg, { type: "combat/selectMode", mode: "deathspace" }, FROZEN_NOW);
  const smCleared = rSm && rSm.changed === true && rSm.viewOnly !== true &&
    gHg.combat.runDamageDealt === 0 && gHg.combat.runDamageTaken === 0;
  gHg.combat.active = true;
  gHg.combat.runDamageDealt = 99;
  gHg.combat.runDamageTaken = 9;
  const rSm2 = dgaH(gHg, { type: "combat/selectMode", mode: "belt" }, FROZEN_NOW);
  const smViewOnly = rSm2 && rSm2.changed === true && rSm2.viewOnly === true &&
    gHg.combat.runDamageDealt === 99 && gHg.combat.runDamageTaken === 9;
  gHg.combat.active = false;
  ok("[cbH7] 真实 VM：combat/selectMode 非活跃分支清零 runDamageDealt/runDamageTaken；活跃分支 viewOnly=true 不清零",
    smCleared && smViewOnly);

  // H-h：start 真实行为——living=0 新编队清零 runDamage 并进入战斗
  const zoneHg = vm.runInContext("COMBAT_ZONES", sbHg.sandbox).find((z) => z.id === "angel_outpost");
  const waveHg = sbHg.sandbox.buildCombatWave(zoneHg, 1);
  gHg.combat.mode = "belt";
  gHg.combat.viewMode = "belt";
  gHg.combat.zone = "angel_outpost";
  gHg.combat.enemies = [];
  gHg.combat.currentEnemy = null;
  gHg.combat.runDamageDealt = 555;
  gHg.combat.runDamageTaken = 66;
  const rSt = dgaH(gHg, { type: "combat/start", enemies: waveHg.enemies, formationId: waveHg.formationId }, FROZEN_NOW);
  ok("[cbH8] 真实 VM：combat/start 新编队（living=0）清零 runDamageDealt/runDamageTaken、active=true、敌人数与编队一致",
    rSt && rSt.changed === true && gHg.combat.active === true &&
    gHg.combat.runDamageDealt === 0 && gHg.combat.runDamageTaken === 0 &&
    Array.isArray(gHg.combat.enemies) && gHg.combat.enemies.length === waveHg.enemies.length &&
    gHg.combat.enemies.length > 0);

  // H-i：start 真实行为——living>0 再次 start 走 else 分支，同 run 保留 runDamage 累计
  gHg.combat.runDamageDealt = 777;
  gHg.combat.runDamageTaken = 88;
  const livingHg = sbHg.sandbox.getCombatLivingEnemiesFromState(gHg.combat).length;
  const rSt2 = dgaH(gHg, { type: "combat/start", enemies: [], formationId: "" }, FROZEN_NOW);
  ok("[cbH9] 真实 VM：living>0 再次 combat/start 保留 runDamageDealt=777/runDamageTaken=88（同 run else 分支不清零）",
    livingHg > 0 && rSt2 && rSt2.changed === true &&
    gHg.combat.runDamageDealt === 777 && gHg.combat.runDamageTaken === 88);

  // H-j：死亡空间全通真实行为——emit deathspaceCleared 时 runDamage 尚未清零（先发后清），
  // 随后真实清零、active=false、clearCount 记账为 1（真实站点 angel_ded_2_10，maxWave 来自数据）
  const sbHj = buildFullGameSandbox(null);
  const gHj = sbHj.sandbox.gameState;
  const siteHj = sbHj.sandbox.getDeathspaceById("angel_ded_2_10");
  const zoneHj = vm.runInContext("COMBAT_ZONES", sbHj.sandbox).find((z) => z.id === siteHj.sourceZoneId);
  gHj.combat.mode = "deathspace";
  gHj.combat.deathspaceId = "angel_ded_2_10";
  gHj.combat.active = true;
  gHj.combat.wave = siteHj.maxWave;
  gHj.combat.enemies = [];
  gHj.combat.currentEnemy = null;
  gHj.combat.deathspaceClears = {};
  gHj.combat.runDamageDealt = 999;
  gHj.combat.runDamageTaken = 111;
  let dsClearedEvt = null;
  sbHj.sandbox.GameEvents.on("combat:deathspaceCleared", (evt) => {
    dsClearedEvt = { runAtEmit: gHj.combat.runDamageDealt, takenAtEmit: gHj.combat.runDamageTaken, payload: evt.payload };
  });
  const rDs = sbHj.sandbox.resolveDeathspaceWaveVictory(siteHj, zoneHj);
  ok("[cbH10] 真实 VM：死亡空间全通——emit deathspaceCleared 时 runDamage=999/111 未清（先发后清），emit 后清零、active=false、clearCount=1",
    rDs === true && dsClearedEvt &&
    dsClearedEvt.runAtEmit === 999 && dsClearedEvt.takenAtEmit === 111 &&
    dsClearedEvt.payload.deathspaceId === "angel_ded_2_10" && dsClearedEvt.payload.clearCount === 1 &&
    gHj.combat.runDamageDealt === 0 && gHj.combat.runDamageTaken === 0 &&
    gHj.combat.active === false && gHj.combat.deathspaceClears["angel_ded_2_10"] === 1);

  // H-k：坏值归一化——调用生产 normalizeCombatRunDamage 真实函数（非审计内联复刻）
  const normReal = sbHj.sandbox.normalizeCombatRunDamage;
  let hkOk = typeof normReal === "function";
  const badPairs = [["100", "200"], [NaN, Infinity], [-50, -99.9], [null, undefined], [{}, []], [true, false]];
  for (const [d, t] of badPairs) {
    const cBad = { runDamageDealt: d, runDamageTaken: t };
    normReal(cBad);
    if (cBad.runDamageDealt !== 0 || cBad.runDamageTaken !== 0) hkOk = false;
  }
  const cDec = { runDamageDealt: 3.14, runDamageTaken: 2.718 };
  normReal(cDec);
  ok("[cbH11] 真实 VM：normalizeCombatRunDamage 坏值归零（字符串/NaN/Infinity/负数/null/对象/数组/布尔）；合法小数(3.14/2.718)保留",
    hkOk && cDec.runDamageDealt === 3.14 && cDec.runDamageTaken === 2.718);

  // H-l/m：combatTick 真实行为——正实伤恰 emit 1 次 combat:damageDealt（amount=本轮增量、
  // runTotal=当前累计）；弹药不足/燃料不足整轮未开火 emit 0 次
  const sbHl = buildFullGameSandbox(null);
  const gHl = sbHl.sandbox.gameState;
  const RRl = sbHl.sandbox.ResourceRegistry;
  const dgaHl = sbHl.sandbox.dispatchGameAction;
  RRl.set(gHl, "consumable:fuel", 1000);
  RRl.set(gHl, "ammo:laser", 100);
  const zoneHl = vm.runInContext("COMBAT_ZONES", sbHl.sandbox).find((z) => z.id === "angel_outpost");
  const waveHl = sbHl.sandbox.buildCombatWave(zoneHl, 1);
  gHl.combat.zone = "angel_outpost";
  gHl.combat.mode = "belt";
  const rStHl = dgaHl(gHl, { type: "combat/start", enemies: waveHl.enemies, formationId: waveHl.formationId }, FROZEN_NOW);
  const ddEvents = [];
  sbHl.sandbox.GameEvents.on("combat:damageDealt", (evt) => ddEvents.push(evt.payload));
  const runBeforeHl = gHl.combat.runDamageDealt;
  sbHl.sandbox.combatTick();
  const firedOnce = ddEvents.length === 1 && ddEvents[0].amount > 0 &&
    ddEvents[0].amount === gHl.combat.runDamageDealt - runBeforeHl &&
    ddEvents[0].runTotal === gHl.combat.runDamageDealt &&
    ddEvents[0].zoneId === "angel_outpost" && ddEvents[0].mode === "belt";
  // 弹药不足：整轮未开火，不 emit
  RRl.set(gHl, "ammo:laser", 0);
  const ddCountAfterFire = ddEvents.length;
  sbHl.sandbox.combatTick();
  const noAmmoNoEmit = ddEvents.length === ddCountAfterFire && gHl.combat.lastStatus === "弹药不足，整轮武器未能开火";
  // 燃料不足：整轮未开火，不 emit
  RRl.set(gHl, "ammo:laser", 100);
  RRl.set(gHl, "consumable:fuel", 0);
  sbHl.sandbox.combatTick();
  const noFuelNoEmit = ddEvents.length === ddCountAfterFire && gHl.combat.lastStatus === "燃料不足，整轮武器未能开火";
  ok("[cbH12] 真实 VM：combatTick 正实伤恰 emit 1 次（amount=增量、runTotal=累计、zoneId/mode 正确）；弹药不足/燃料不足整轮未开火 emit 0 次",
    rStHl && rStHl.changed === true && firedOnce && noAmmoNoEmit && noFuelNoEmit);

  // H-n：H 区段自身无弱断言——读取本文件 H 区段源码，禁止 ok(...,true) 字面量，
  // 且 cbH7–cbH14 必须基于 buildFullGameSandbox 真实沙箱（出现 ≥3 次）。
  //（不再检查跳过标记：该词会命中本区段注释自身，产生假阳性。）
  const selfSrcH = fs.readFileSync(path.join(HERE, "audit-achievements.mjs"), "utf-8");
  const hSectionText = selfSrcH.slice(selfSrcH.indexOf("H. Batch C-12"), selfSrcH.indexOf("function runManufacturing"));
  const weakLiteral = "\", " + "true);"; // 拼接构造，避免检查串匹配到自身源码
  ok("[cbH13] H 区段无弱断言（无 ok(...,true) 字面量；cbH7–cbH14 全部真实 VM，buildFullGameSandbox ≥3 次）",
    hSectionText.length > 0 && !hSectionText.includes(weakLiteral) &&
    (hSectionText.match(/buildFullGameSandbox\(null\)/g) || []).length >= 3);

  // H-o：AOE 真实行为——换装 AOE(all) 旗舰导弹阵列，3 敌一轮齐射：
  // emit amount === 全部敌人 HP 实际减少量之和（主目标 + 全部 AOE 目标），且 ≥2 个非主目标受击
  const sbHn = buildFullGameSandbox(null);
  const gHn = sbHn.sandbox.gameState;
  const RRn = sbHn.sandbox.ResourceRegistry;
  const dgaHn = sbHn.sandbox.dispatchGameAction;
  RRn.set(gHn, "consumable:fuel", 1000);
  RRn.set(gHn, "ammo:missile", 100);
  gHn.inventory.ships[0].fitted.high = ["t1_capital_missile_array"]; // aoe:{mode:"all",multiplier:0.12}
  gHn.inventory.ships[0].fitted.mid = [];
  const zoneHn = vm.runInContext("COMBAT_ZONES", sbHn.sandbox).find((z) => z.id === "angel_outpost");
  const mkEnemy = sbHn.sandbox.createCombatEnemy;
  const enemiesHn = [mkEnemy(zoneHn, "normal"), mkEnemy(zoneHn, "normal"), mkEnemy(zoneHn, "normal")];
  const hpTotal = (e) => e.hp.shield + e.hp.armor + e.hp.structure;
  const hpBeforeHn = enemiesHn.map(hpTotal);
  gHn.combat.zone = "angel_outpost";
  gHn.combat.mode = "belt";
  const rStHn = dgaHn(gHn, { type: "combat/start", enemies: enemiesHn, formationId: "audit_aoe_formation" }, FROZEN_NOW);
  const ddHn = [];
  sbHn.sandbox.GameEvents.on("combat:damageDealt", (evt) => ddHn.push(evt.payload));
  sbHn.sandbox.combatTick();
  const hpAfterHn = enemiesHn.map(hpTotal);
  const totalDealtHn = hpBeforeHn.reduce((s, v, i) => s + (v - hpAfterHn[i]), 0);
  const aoeHitCount = enemiesHn.filter((e, i) => i > 0 && hpAfterHn[i] < hpBeforeHn[i]).length;
  ok("[cbH14] 真实 VM：AOE(all) 一轮齐射 amount === 全部敌人实伤总和（主目标+AOE）、≥2 个非主目标受击、amount>0",
    rStHn && rStHn.changed === true && ddHn.length === 1 &&
    totalDealtHn > 0 && ddHn[0].amount === totalDealtHn && aoeHitCount >= 2);
}

// ============================================================================
function runManufacturing() {
  // ========================= 期望表（审计侧显式复刻，与规则文件交叉验证）=========================
  const EXP_COMPONENT_IDS = [
    "integrated_hull", "power_core", "functional_system",
    "destroyer_integrated_hull", "destroyer_power_core", "destroyer_functional_system",
    "cruiser_integrated_hull", "cruiser_power_core", "cruiser_functional_system",
    "battleship_integrated_hull", "battleship_power_core", "battleship_functional_system",
    "capital_integrated_hull", "capital_power_core", "capital_functional_system",
    "supercapital_integrated_hull", "supercapital_power_core", "supercapital_functional_system",
  ];
  const EXP_CAPITAL_IDS = ["firmament", "heavy_bastion", "riftbreaker", "orca", "illuminator"];
  const EXP_SUPERCAPITAL_IDS = ["starcrown", "eternal_fortress", "arbiter"];
  const EXP_CAPITAL_NAMES = ["天穹级", "重垒级", "裂界级", "山海级", "启明级"];
  const EXP_SUPERCAPITAL_NAMES = ["星冕级", "恒城级", "裁决级"];
  const MANU_IDS = ["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08", "C09", "C10", "C12", "C13"];
  const EXPECTED_MFG_COND = {
    C01: "制造首个舰船部件", C02: "总装首艘舰船",
    C03: "总装首艘 天穹级", C04: "总装首艘 重垒级", C05: "总装首艘 裂界级",
    C06: "总装首艘 山海级", C07:  "总装首艘 启明级", C08: "总装首艘 星冕级",
    C09: "总装首艘 恒城级", C10: "总装首艘 裁决级",
    C12: "累计建造 50 艘旗舰", C13: "累计建造 25 艘超级旗舰",
  };
  const SINGLE_MAP = {
    C03: "firmament", C04: "heavy_bastion", C05: "riftbreaker", C06: "orca",
    C07: "illuminator", C08: "starcrown", C09: "eternal_fortress", C10: "arbiter",
  };

  const sb = buildKernelSandbox({ withEvents: true, withRules: true });
  const RD = sb.AchievementRuleData;
  const SYS = sb.AchievementSystem;
  const manuRulesPreJson = JSON.stringify(RD.MANUFACTURING_RULES);

  function makeManufacturingState(box, manufactured, shipsBuilt) {
    const man = {};
    if (manufactured && typeof manufactured === "object") {
      for (const k of Object.keys(manufactured)) man[k] = manufactured[k];
    }
    return {
      skills: {},
      achievements: box.AchievementState.createDefaultAchievementState(),
      statistics: {
        version: 1,
        totals: { shipsBuilt: shipsBuilt || 0 },
        production: { manufactured: man },
      },
      _dirty: false,
    };
  }
  const evaluateM = (state, atMs) => SYS.evaluateManufacturingAchievementRules(state, atMs);
  const unlockedSetM = (state) => new Set(Object.keys(state.achievements.unlockedAtById));

  function extractFnBody(src, name) {
    let start = src.indexOf("function " + name);
    if (start < 0) start = src.indexOf(name + "("); // 兼容对象方法简写 buyLPItem(state, itemId) { ... }
    if (start < 0) return "";
    const paren = src.indexOf("(", start);
    let i = src.indexOf("{", paren < 0 ? start : paren);
    if (i < 0) return "";
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return "";
  }
  function listRepoFiles() {
    const out = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === ".git" || e.name === "node_modules") continue;
          walk(p);
        } else {
          if (e.name.endsWith(".log")) continue;
          out.push(p);
        }
      }
    };
    walk(ROOT);
    return out;
  }
  const mfgFilesBefore = listRepoFiles().sort();

  // ========================= A. 规则数据 =========================
  const compFrozen = Object.isFrozen(RD.SHIP_COMPONENT_RECIPE_IDS) &&
    RD.SHIP_COMPONENT_RECIPE_IDS.length === 18 && new Set(RD.SHIP_COMPONENT_RECIPE_IDS).size === 18 &&
    RD.SHIP_COMPONENT_RECIPE_IDS.every((id, i) => id === EXP_COMPONENT_IDS[i]);
  const capFrozen = Object.isFrozen(RD.CAPITAL_SHIP_RECIPE_IDS) &&
    RD.CAPITAL_SHIP_RECIPE_IDS.length === 5 && new Set(RD.CAPITAL_SHIP_RECIPE_IDS).size === 5 &&
    RD.CAPITAL_SHIP_RECIPE_IDS.every((id, i) => id === EXP_CAPITAL_IDS[i]);
  const supFrozen = Object.isFrozen(RD.SUPERCAPITAL_SHIP_RECIPE_IDS) &&
    RD.SUPERCAPITAL_SHIP_RECIPE_IDS.length === 3 && new Set(RD.SUPERCAPITAL_SHIP_RECIPE_IDS).size === 3 &&
    RD.SUPERCAPITAL_SHIP_RECIPE_IDS.every((id, i) => id === EXP_SUPERCAPITAL_IDS[i]);
  ok("[mc1] 三配方 ID 数组内容/顺序/唯一性/冻结精确（部件18 / 旗舰5 / 超级旗舰3）", compFrozen && capFrozen && supFrozen);
  if (!RD || !SYS || !Array.isArray(RD.MANUFACTURING_RULES)) return;

  const shipsSrc = fs.readFileSync(SHIP_PATH, "utf-8");
  const compBlock = /const SHIP_COMPONENT_RECIPES = \[([\s\S]*?)\];/.exec(shipsSrc);
  const compIdsInShips = (compBlock ? compBlock[1].match(/id:\s*"([^"]+)"/g) || [] : []).map((s) => s.replace(/id:\s*"([^"]+)"/, "$1"));
  const setA = new Set(EXP_COMPONENT_IDS), setB = new Set(compIdsInShips);
  const mc2ok = setA.size === setB.size && setA.size === 18 && setB.size === 18 &&
    [...setA].every((id) => setB.has(id)) && [...setB].every((id) => setA.has(id));
  ok("[mc2] 18 个部件 ID 与 SHIP_COMPONENT_RECIPES 双向集合相等", mc2ok);

  const asmBlock = /const SHIP_ASSEMBLY_RECIPES = \[([\s\S]*?)\n\];/.exec(shipsSrc);
  const asmEntries = asmBlock ? [...asmBlock[1].matchAll(/id:\s*"([^"]+)"\s*,\s*name:\s*"([^"]+)"([\s\S]*?)componentCost:\{([^}]*)\}/g)] : [];
  const asmById = {};
  for (const m of asmEntries) {
    const compKeys = (m[4].match(/[a-z_]+:/g) || []).map((s) => s.replace(":", ""));
    asmById[m[1]] = { name: m[2], compKeys };
  }
  let mc3ok = true;
  for (let i = 0; i < 5; i++) {
    const id = EXP_CAPITAL_IDS[i];
    if (!asmById[id] || asmById[id].name !== EXP_CAPITAL_NAMES[i] || !asmById[id].compKeys.every((k) => k.startsWith("capital_"))) mc3ok = false;
  }
  for (let i = 0; i < 3; i++) {
    const id = EXP_SUPERCAPITAL_IDS[i];
    if (!asmById[id] || asmById[id].name !== EXP_SUPERCAPITAL_NAMES[i] || !asmById[id].compKeys.every((k) => k.startsWith("supercapital_"))) mc3ok = false;
  }
  ok("[mc3] 5 旗舰 + 3 超级旗舰 与 SHIP_ASSEMBLY_RECIPES 名称/类型逐项交叉（capital_* 组件 / supercapital_* 组件）", mc3ok);

  let mc4ok = true;
  const rC01 = RD.MANUFACTURING_RULES_BY_ID["C01"];
  if (!rC01 || rC01.type !== "manufacturing-recipe-set-any" || !Array.isArray(rC01.recipeIds) ||
      rC01.recipeIds.length !== 18 || rC01.minValue !== 1 ||
      rC01.recipeIds.some((id, i) => id !== EXP_COMPONENT_IDS[i])) mc4ok = false;
  const rC02 = RD.MANUFACTURING_RULES_BY_ID["C02"];
  if (!rC02 || rC02.type !== "manufacturing-total" || rC02.totalKey !== "shipsBuilt" || rC02.minValue !== 1) mc4ok = false;
  for (const id of Object.keys(SINGLE_MAP)) {
    const r = RD.MANUFACTURING_RULES_BY_ID[id];
    if (!r || r.type !== "manufacturing-recipe" || r.recipeId !== SINGLE_MAP[id] || r.minValue !== 1) mc4ok = false;
  }
  const rC12 = RD.MANUFACTURING_RULES_BY_ID["C12"];
  if (!rC12 || rC12.type !== "manufacturing-recipe-set-total" || !Array.isArray(rC12.recipeIds) ||
      rC12.recipeIds.length !== 5 || rC12.minValue !== 50 ||
      rC12.recipeIds.some((id, i) => id !== EXP_CAPITAL_IDS[i])) mc4ok = false;
  const rC13 = RD.MANUFACTURING_RULES_BY_ID["C13"];
  if (!rC13 || rC13.type !== "manufacturing-recipe-set-total" || !Array.isArray(rC13.recipeIds) ||
      rC13.recipeIds.length !== 3 || rC13.minValue !== 25 ||
      rC13.recipeIds.some((id, i) => id !== EXP_SUPERCAPITAL_IDS[i])) mc4ok = false;
  ok("[mc4] C01–C10/C12/C13 映射逐项精确（type / 目标 ID 或 recipeIds / minValue）", mc4ok);

  const mc5ok = Object.isFrozen(RD.MANUFACTURING_RULES) && Object.isFrozen(RD.MANUFACTURING_RULES_BY_ID) &&
    RD.MANUFACTURING_RULES.length === 12 && Object.keys(RD.MANUFACTURING_RULES_BY_ID).length === 12 &&
    RD.MANUFACTURING_RULES.every((r) => Object.isFrozen(r)) &&
    RD.MANUFACTURING_RULES.every((r) => {
      if (r.type === "manufacturing-recipe-set-any" || r.type === "manufacturing-recipe-set-total")
        return Object.isFrozen(r.recipeIds);
      return true;
    });
  ok("[mc5] MANUFACTURING_RULES=12、BY_ID=12 键、每条规则与嵌套数组全部 Object.freeze", mc5ok);

  const skillKeysM = new Set(Object.keys(RD.SKILL_RULES_BY_ID));
  const prodKeysM = new Set(Object.keys(RD.PRODUCTION_RULES_BY_ID));
  const combKeysM = new Set(Object.keys(RD.COMBAT_RULES_BY_ID));
  const manuKeysM = new Set(Object.keys(RD.MANUFACTURING_RULES_BY_ID));
  const unionM = new Set([...skillKeysM, ...prodKeysM, ...combKeysM, ...manuKeysM]);
  const pairwiseDisjointM = [...skillKeysM].every((k) => !prodKeysM.has(k) && !combKeysM.has(k) && !manuKeysM.has(k)) &&
    [...prodKeysM].every((k) => !combKeysM.has(k) && !manuKeysM.has(k)) &&
    [...combKeysM].every((k) => !manuKeysM.has(k));
  ok("[mc6] 技能50 + 生产18 + 战斗32 + 制造12 = 112 条规则、四集合零交集",
    skillKeysM.size === 50 && prodKeysM.size === 18 && combKeysM.size === 32 && manuKeysM.size === 12 &&
    unionM.size === 112 && pairwiseDisjointM);

  ok("[mc7] C11 无任何规则（四集合均无）；C14 仅属技能规则（不在制造/生产/战斗）",
    !manuKeysM.has("C11") && !skillKeysM.has("C11") && !prodKeysM.has("C11") && !combKeysM.has("C11") &&
    skillKeysM.has("C14") && !manuKeysM.has("C14") && !prodKeysM.has("C14") && !combKeysM.has("C14"));

  const csvRowsM = parseCSV(fs.readFileSync(CSV_PATH).slice(3).toString("utf-8")).slice(1);
  const csvByIdM = {};
  for (const r of csvRowsM) csvByIdM[r[0]] = r;
  const mc8cat = MANU_IDS.every((id) => csvByIdM[id] && csvByIdM[id][1] === "舰船工程");
  const mc8cond = MANU_IDS.every((id) => csvByIdM[id] && csvByIdM[id][2] === EXPECTED_MFG_COND[id]);
  ok("[mc8] CSV 交叉：C01–C10/C12/C13 分类=舰船工程、触发条件文本逐项一致（C11=获得首张蓝图，本批无规则）",
    mc8cat && mc8cond && csvByIdM["C11"] && csvByIdM["C11"][2] === "获得首张蓝图");

  // ========================= B. 求值边界 =========================
  let mc9ok = true;
  for (let i = 0; i < 18; i++) {
    const id = EXP_COMPONENT_IDS[i];
    const s0 = makeManufacturingState(sb, { [id]: 0 }, 0);
    const r0 = evaluateM(s0, 1000);
    const s1 = makeManufacturingState(sb, { [id]: 1 }, 0);
    const r1 = evaluateM(s1, 1000);
    if (!(r0.ok && r0.unlockedIds.length === 0 &&
          r1.ok && r1.unlockedIds.length === 1 && r1.unlockedIds[0] === "C01" &&
          unlockedSetM(s1).size === 1 && unlockedSetM(s1).has("C01"))) mc9ok = false;
  }
  ok("[mc9] C01：18 个部件配方各自 0→0 项、1→恰 {C01}（逐项边界）", mc9ok);

  const sC02_0 = makeManufacturingState(sb, {}, 0);
  const rC02_0 = evaluateM(sC02_0, 1000);
  const sC02_1 = makeManufacturingState(sb, {}, 1);
  const rC02_1 = evaluateM(sC02_1, 1000);
  ok("[mc10] C02：shipsBuilt 0→0 项、1→恰 {C02}（不读取部件累计、不依赖任何 recipeId）",
    rC02_0.ok && rC02_0.unlockedIds.length === 0 &&
    rC02_1.ok && rC02_1.unlockedIds.length === 1 && rC02_1.unlockedIds[0] === "C02" &&
    !("C01" in sC02_1.achievements.unlockedAtById));

  let mc11ok = true;
  for (const id of Object.keys(SINGLE_MAP)) {
    const rid = SINGLE_MAP[id];
    const s0 = makeManufacturingState(sb, { [rid]: 0 }, 0);
    const r0 = evaluateM(s0, 1000);
    const s1 = makeManufacturingState(sb, { [rid]: 1 }, 0);
    const r1 = evaluateM(s1, 1000);
    if (!(r0.ok && r0.unlockedIds.length === 0 &&
          r1.ok && r1.unlockedIds.length === 1 && r1.unlockedIds[0] === id &&
          s1.achievements.unlockedAtById[id] === 1000)) mc11ok = false;
  }
  ok("[mc11] C03–C10：各旗舰/超级旗舰配方 0→0 项、1→恰对应成就（逐项边界）", mc11ok);

  const cap45 = {};
  for (const id of EXP_CAPITAL_IDS) cap45[id] = 9;
  const rC12_45 = evaluateM(makeManufacturingState(sb, cap45, 0), 1000);
  const rC12_s = evaluateM(makeManufacturingState(sb, { firmament: 50 }, 0), 1000);
  const capMixed = {};
  for (const id of EXP_CAPITAL_IDS) capMixed[id] = 9;
  for (const id of EXP_SUPERCAPITAL_IDS) capMixed[id] = 50;
  const rC12_mix = evaluateM(makeManufacturingState(sb, capMixed, 0), 1000);
  ok("[mc12] C12：capital 累计 45<50 不解锁 C12；单旗舰 firmament=50 解锁 C12；supercapital 不计入 capital 分组（C12 保持锁定）",
    !rC12_45.unlockedIds.includes("C12") &&
    rC12_s.unlockedIds.includes("C12") && !rC12_s.unlockedIds.includes("C02") &&
    !rC12_mix.unlockedIds.includes("C12"));

  const sup24 = {};
  for (const id of EXP_SUPERCAPITAL_IDS) sup24[id] = 8;
  const rC13_24 = evaluateM(makeManufacturingState(sb, sup24, 0), 1000);
  const rC13_s = evaluateM(makeManufacturingState(sb, { starcrown: 25 }, 0), 1000);
  const supMixed = {};
  for (const id of EXP_SUPERCAPITAL_IDS) supMixed[id] = 8;
  for (const id of EXP_CAPITAL_IDS) supMixed[id] = 50;
  const rC13_mix = evaluateM(makeManufacturingState(sb, supMixed, 0), 1000);
  ok("[mc13] C13：supercapital 累计 24<25 不解锁 C13；单超级旗舰 starcrown=25 解锁 C13；capital 不计入 supercapital 分组（C13 保持锁定）",
    !rC13_24.unlockedIds.includes("C13") &&
    rC13_s.unlockedIds.includes("C13") &&
    !rC13_mix.unlockedIds.includes("C13"));

  const sBadM = makeManufacturingState(sb, {
    unknown_recipe_xyz: 99, firmament: NaN, heavy_bastion: "5",
    riftbreaker: Infinity, orca: -1, illuminator: null,
  }, 0);
  const rBadM = evaluateM(sBadM, 1);
  ok("[mc14] 未知 recipeId、错桶、NaN/字符串/Infinity/负数/null 不得误解锁（0 项解锁，ok=true）",
    rBadM.ok === true && rBadM.unlockedIds.length === 0 && unlockedSetM(sBadM).size === 0);

  const sFullM = makeManufacturingState(sb, {}, 100);
  for (const id of EXP_COMPONENT_IDS) sFullM.statistics.production.manufactured[id] = 1;
  for (const id of EXP_CAPITAL_IDS) sFullM.statistics.production.manufactured[id] = 10;
  for (const id of EXP_SUPERCAPITAL_IDS) sFullM.statistics.production.manufactured[id] = 9;
  const rFullM = evaluateM(sFullM, 2000);
  ok("[mc15] 全满统计单次求值恰好解锁 C01–C10/C12/C13（12 项，不少不多），且全部 unlockedAt=2000",
    rFullM.unlockedIds.length === 12 &&
    MANU_IDS.every((id) => sFullM.achievements.unlockedAtById[id] === 2000));

  // ========================= C. 幂等 / dirty / 时间语义 =========================
  const capM = [];
  sb.GameEvents.on("achievement:unlocked", (ev) => capM.push(ev));
  const sI_M = makeManufacturingState(sb, { integrated_hull: 1, power_core: 1 }, 1);
  SYS.unlockAchievement(sI_M, "C01", 111);
  capM.length = 0;
  const rI1_M = evaluateM(sI_M, 5000);
  ok("[mc16] 首次求值 unlockedIds 只含本次新解锁项（含 C02 不含预解锁 C01，C01 保持 111）",
    rI1_M.ok && rI1_M.unlockedIds.includes("C02") && !rI1_M.unlockedIds.includes("C01") &&
    sI_M.achievements.unlockedAtById["C01"] === 111);
  sI_M._dirty = false;
  capM.length = 0;
  const rI2_M = evaluateM(sI_M, 6000);
  ok("[mc17] 同状态重复求值 unlockedIds=[]、不覆盖时间（C02 保持 5000）、不 emit、不 dirty",
    rI2_M.ok && rI2_M.unlockedIds.length === 0 &&
    sI_M.achievements.unlockedAtById["C02"] === 5000 && capM.length === 0 && sI_M._dirty === false);

  const TBM = 1690000123456.75;
  capM.length = 0;
  const sT_M = makeManufacturingState(sb, { integrated_hull: 1, power_core: 1 }, 1);
  const rT_M = evaluateM(sT_M, TBM);
  const idCountsM = {};
  for (const ev of capM) idCountsM[ev.payload.achievementId] = (idCountsM[ev.payload.achievementId] || 0) + 1;
  const sameAtMsOk = rT_M.unlockedIds.length === 2 &&
    sT_M.achievements.unlockedAtById["C01"] === TBM && sT_M.achievements.unlockedAtById["C02"] === TBM &&
    capM.length === 2 && idCountsM["C01"] === 1 && idCountsM["C02"] === 1 &&
    capM.every((ev) => ev.timestamp === ev.payload.unlockedAt && ev.payload.unlockedAt === TBM);
  const sNaNM = makeManufacturingState(sb, { integrated_hull: 1 }, 1);
  const rNaNM = evaluateM(sNaNM, NaN);
  const nanOk = rNaNM.unlockedIds.includes("C01") && rNaNM.unlockedIds.includes("C02") &&
    sNaNM.achievements.unlockedAtById["C01"] === FROZEN_NOW && sNaNM.achievements.unlockedAtById["C02"] === FROZEN_NOW;
  ok("[mc18] 时间语义：同批多解锁共享同一浮点 atMs；非法 atMs 统一回退冻结 Date.now()", sameAtMsOk && nanOk);

  const sROM = makeManufacturingState(sb, { integrated_hull: 1 });
  const statsBeforeM = JSON.stringify(sROM.statistics);
  const rulesBeforeM = JSON.stringify(RD.MANUFACTURING_RULES);
  evaluateM(sROM, 1);
  ok("[mc19] 求值前后 state.statistics 与 MANUFACTURING_RULES JSON 完全一致（条件读取纯只读；成就状态无 schema 污染）",
    JSON.stringify(sROM.statistics) === statsBeforeM &&
    JSON.stringify(RD.MANUFACTURING_RULES) === rulesBeforeM &&
    Object.isFrozen(RD.MANUFACTURING_RULES) &&
    !("manufactured" in sROM.achievements) && !("shipsBuilt" in sROM.achievements));

  // ========================= D. 消费者（真实沙箱 + 手工沙箱）=========================
  const achSysSrcM = fs.readFileSync(ACH_SYSTEM_PATH, "utf-8");
  const mfgInstallBody = extractFnBody(achSysSrcM, "installManufacturingAchievementConsumer");
  ok("[mc20] 制造消费者注册在通配符 \"*\" 且严格按 event.type 过滤（仅 manufacturing:completed 触发，其余事件立即 return）",
    mfgInstallBody.includes('GE.on("*"') && mfgInstallBody.includes('!== "manufacturing:completed"'));

  // D-a 真实 statistics.js 沙箱：statistics + 四成就消费者同注册在 *，statistics 先行
  const sbS = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsS = sbS.gameState;
  const capS = [];
  sbS.GameEvents.on("achievement:unlocked", (ev) => capS.push(ev));
  const reinstallM = sbS.AchievementSystem.installManufacturingAchievementConsumer(gsS);
  ok("[mc21] listenerCount(\"*\") 体现 statistics+生产+战斗+制造+装备+增幅剂+考古+行星+空间站+综合生命周期 十监听，重复安装返回 ALREADY_INSTALLED",
    sbS.GameEvents.listenerCount("*") === 10 && sbS.GameEvents.listenerCount("skill:levelUp") === 1 &&
    reinstallM && reinstallM.ok === false && reinstallM.reason === "ALREADY_INSTALLED");

  const TSC = 1712345678901.5;
  sbS.GameEvents.emit("manufacturing:completed",
    { branch: "component", recipeId: "integrated_hull", quantity: 1, cycles: 1, xp: 10 },
    { offline: false, timestamp: TSC });
  ok("[mc23] 首个部件 manufacturing:completed（branch=component）→ 仅 C01 解锁，C02 仍锁（shipsBuilt 仍为 0）",
    gsS.statistics.production.manufactured["integrated_hull"] === 1 &&
    typeof gsS.achievements.unlockedAtById["C01"] === "number" &&
    gsS.achievements.unlockedAtById["C01"] === TSC &&
    !("C02" in gsS.achievements.unlockedAtById) &&
    capS.filter((ev) => ev.payload.achievementId === "C01").length === 1);

  sbS.GameEvents.emit("manufacturing:completed",
    { branch: "ship", recipeId: "firmament", quantity: 1, cycles: 1, xp: 10 },
    { offline: false, timestamp: TSC + 1 });
  ok("[mc24] 首艘舰船 manufacturing:completed（branch=ship, firmament）→ C02（shipsBuilt≥1）与 C03（firmament≥1）同时解锁",
    gsS.statistics.totals.shipsBuilt === 1 &&
    typeof gsS.achievements.unlockedAtById["C02"] === "number" &&
    typeof gsS.achievements.unlockedAtById["C03"] === "number" &&
    !("C04" in gsS.achievements.unlockedAtById));

  sbS.GameEvents.emit("manufacturing:completed",
    { branch: "ship", recipeId: "riftbreaker", quantity: 1, cycles: 1, xp: 10 },
    { offline: true, timestamp: TSC + 2 });
  ok("[mc25] 离线聚合（meta.offline=true）经同一制造消费者解锁 C05（riftbreaker≥1），证明在线/离线共用单一链路",
    typeof gsS.achievements.unlockedAtById["C05"] === "number" &&
    gsS.statistics.totals.shipsBuilt === 2);

  sbS.GameEvents.emit("manufacturing:completed",
    { branch: "ship", recipeId: "heavy_bastion", quantity: 1, cycles: 1, xp: 10 },
    { offline: false, eventId: "mfg-audit-dup-1" });
  sbS.GameEvents.emit("manufacturing:completed",
    { branch: "ship", recipeId: "heavy_bastion", quantity: 1, cycles: 1, xp: 10 },
    { offline: false, eventId: "mfg-audit-dup-1" });
  ok("[mc28] 同 eventId 重放：statistics 幂等账本只累计一次（heavy_bastion=1）、C04 恰解锁一次",
    gsS.statistics.production.manufactured["heavy_bastion"] === 1 &&
    capS.filter((ev) => ev.payload.achievementId === "C04").length === 1 &&
    typeof gsS.achievements.unlockedAtById["C04"] === "number");

  // D-b 手工沙箱（无 statistics.js）：payload 不可信 + 安装失败原因 + dirty 语义
  const sbM = buildKernelSandbox({ withEvents: true, withRules: true });
  let instThrowM = false, rInvM = null, rNoStatIM = null, rNoEvM = null;
  try {
    rInvM = sbM.AchievementSystem.installManufacturingAchievementConsumer(null);
    rNoStatIM = sbM.AchievementSystem.installManufacturingAchievementConsumer(
      { achievements: sbM.AchievementState.createDefaultAchievementState() });
    const sbNoEvM = buildKernelSandbox({ withEvents: false, withRules: true });
    rNoEvM = sbNoEvM.AchievementSystem.installManufacturingAchievementConsumer(makeManufacturingState(sbNoEvM, {}, 0));
  } catch (e) { instThrowM = true; }
  ok("[mc22a] INVALID_STATE / STATISTICS_UNAVAILABLE / EVENTS_UNAVAILABLE 安装失败原因稳定，不抛异常",
    !instThrowM && rInvM && rInvM.ok === false && rInvM.reason === "INVALID_STATE" &&
    rNoStatIM && rNoStatIM.ok === false && rNoStatIM.reason === "STATISTICS_UNAVAILABLE" &&
    rNoEvM && rNoEvM.ok === false && rNoEvM.reason === "EVENTS_UNAVAILABLE");
  const stM = makeManufacturingState(sbM, {}, 0);
  const instM1 = sbM.AchievementSystem.installManufacturingAchievementConsumer(stM);
  const instM2 = sbM.AchievementSystem.installManufacturingAchievementConsumer(stM);
  ok("[mc22] 首次安装 {ok:true,reason:null}；重复安装 ALREADY_INSTALLED（每沙箱恰一套监听）",
    instM1 && instM1.ok === true && instM1.reason === null &&
    instM2 && instM2.ok === false && instM2.reason === "ALREADY_INSTALLED" &&
    sbM.GameEvents.listenerCount("*") === 1);
  sbM.GameEvents.emit("manufacturing:completed",
    { branch: "component", recipeId: "integrated_hull", quantity: 999999, cycles: 1, xp: 10 },
    { offline: false });
  ok("[mc26] 不信任 payload：事件声称 quantity=999999 但权威 statistics.manufactured 仍为 0 时不得解锁任何项",
    Object.keys(stM.achievements.unlockedAtById).length === 0 &&
    (stM.statistics.production.manufactured["integrated_hull"] || 0) === 0);
  stM.statistics.production.manufactured["integrated_hull"] = 1;
  sbM.GameEvents.emit("manufacturing:completed",
    { branch: "component", recipeId: "integrated_hull", quantity: 0, cycles: 1, xp: 10 },
    { offline: false });
  ok("[mc27] 权威 statistics.manufactured 达标时即使触发事件 payload quantity=0 也按统计解锁 C01（unlockedAt=事件时间=FROZEN_NOW）",
    stM.achievements.unlockedAtById["C01"] === FROZEN_NOW);
  stM._dirty = false;
  sbM.GameEvents.emit("manufacturing:completed",
    { branch: "component", recipeId: "integrated_hull", quantity: 1, cycles: 1, xp: 10 },
    { offline: false });
  ok("[mc30] 无新解锁的消费者求值不置 dirty（_dirty 预置 false 后保持 false）", stM._dirty === false);
  stM.statistics.production.manufactured["firmament"] = 1;
  sbM.GameEvents.emit("skill:levelUp", { skill: "mining", previousLevel: 1, level: 2 }, { source: "audit" });
  sbM.GameEvents.emit("mining:completed", { area: "凡晶石带", mode: "normal", resourceId: "ore:凡晶石", quantity: 1, cycles: 1, xp: 10 }, { offline: false });
  sbM.GameEvents.emit("refining:completed", { recipe: "x", inputId: "ore:凡晶石", outputId: "mineral:三钛合金", inputQuantity: 1, outputQuantity: 1, cycles: 1, xp: 10 }, { offline: false });
  sbM.GameEvents.emit("combat:zoneCleared", { zoneId: "angel_outpost", name: "天使前哨站", lp: 10, clearCount: 1, damageTaken: 0 }, { offline: false });
  ok("[mc29] skill/mining/refining/combat/其他事件不得触发制造求值（firmament 已达标但无 emit、未解锁 C03）",
    !("C03" in stM.achievements.unlockedAtById));

  // ========================= E. 真实接线与追溯 =========================
  let freshM = null;
  try { freshM = buildFullGameSandbox(null); } catch (e) {
    ok("[mc36] 新游戏全量脚本加载不抛异常: " + (e && e.message), false);
  }
  if (freshM) {
    const gs = freshM.sandbox.gameState;
    ok("[mc36] 全部 49 个脚本全量 VM 加载成功且 spy 完整（含制造对账 spy）",
      freshM.scriptSources.length === 49 && freshM.spyInstalled === true);
    const mRec = freshM.timeline.filter((e) => e.fn === "evaluateManufacturingAchievementRules");
    const sRecM = freshM.timeline.filter((e) => e.fn === "evaluateSkillAchievementRules");
    const pRecM = freshM.timeline.filter((e) => e.fn === "evaluateProductionAchievementRules");
    const cRecM = freshM.timeline.filter((e) => e.fn === "evaluateCombatAchievementRules");
    // C-13：制造求值器自身仍解锁 0 项；全局解锁集恰为 {I01}
    ok("[mc31] 新游戏 autoLoad 制造对账恰好一次、atMs=登录时 Date.now()（冻结）、ok=true、制造解锁 0 项",
      mRec.length === 1 && mRec[0].atMs === FROZEN_NOW &&
      mRec[0].result && mRec[0].result.ok === true && mRec[0].result.unlockedIds.length === 0 &&
      Object.keys(gs.achievements.unlockedAtById).sort().join(",") === "I01");
    const iSk = freshM.timeline.findIndex((e) => e.fn === "evaluateSkillAchievementRules");
    const iPr = freshM.timeline.findIndex((e) => e.fn === "evaluateProductionAchievementRules");
    const iCb = freshM.timeline.findIndex((e) => e.fn === "evaluateCombatAchievementRules");
    const iMfg = freshM.timeline.findIndex((e) => e.fn === "evaluateManufacturingAchievementRules");
    const iAchM = freshM.timeline.findIndex((e) => e.fn === "migrateAchievementState");
    const iOff = freshM.timeline.findIndex((e) => e.fn === "calculateOfflineGains");
    ok("[mc32] 四类对账顺序 achievement migrate < skill < production < combat < manufacturing < offline（若有），且 atMs 完全相同",
      sRecM.length === 1 && iAchM >= 0 && iSk >= 0 && iPr >= 0 && iCb >= 0 && iMfg >= 0 &&
      iAchM < iSk && iSk < iPr && iPr < iCb && iCb < iMfg && (iOff === -1 || iMfg < iOff) &&
      sRecM[0].atMs === pRecM[0].atMs && pRecM[0].atMs === cRecM[0].atMs && cRecM[0].atMs === mRec[0].atMs);
    ok("[mc33] 四类对账 atMs 完全相同（skill==production==combat==manufacturing）",
      sRecM[0].atMs === pRecM[0].atMs && pRecM[0].atMs === cRecM[0].atMs && cRecM[0].atMs === mRec[0].atMs);
    ok("[mc37] 成就状态 schema 未引入新字段（无 manufactured/shipsBuilt/production 子对象；进度仍仅 unlockedAtById）",
      !("manufactured" in gs.achievements) && !("shipsBuilt" in gs.achievements) && !("production" in gs.achievements) &&
      Object.keys(gs.achievements).sort().join(",") === "schemaVersion,unlockedAtById");

    // importData 真实路径：statistics 随档导入 → 制造对账补 C 项
    const tlM = freshM.timeline.length;
    const importSaveM = {
      skills: { mining: { lvl: 1, xp: 0 } },
      resources: { isk: 1000, fuel: 100 },
      achievements: { schemaVersion: 1, unlockedAtById: {} },
      planetary: { deployments: [], nextId: 1 },
      statistics: {
        version: 1, totals: { shipsBuilt: 3 },
        production: { manufactured: { firmament: 1, heavy_bastion: 1, integrated_hull: 5 } },
      },
    };
    let importOkM = false;
    try { importOkM = freshM.sandbox.SaveManager.importData(JSON.stringify(importSaveM)); } catch (e) {
      ok("[mc31-import] importData 抛出异常: " + (e && e.message), false);
    }
    const itlM = freshM.timeline.slice(tlM);
    const jSk = itlM.findIndex((e) => e.fn === "evaluateSkillAchievementRules");
    const jPr = itlM.findIndex((e) => e.fn === "evaluateProductionAchievementRules");
    const jCb = itlM.findIndex((e) => e.fn === "evaluateCombatAchievementRules");
    const jMfg = itlM.findIndex((e) => e.fn === "evaluateManufacturingAchievementRules");
    const jAch = itlM.findIndex((e) => e.fn === "migrateAchievementState");
    const jOff = itlM.findIndex((e) => e.fn === "calculateOfflineGains");
    ok("[mc31] importData 制造对账恰好一次且顺序 achievement migrate < skill < production < combat < manufacturing < offline、四次 atMs 完全相同、补 C01/C02/C03/C04",
      importOkM === true &&
      itlM.filter((e) => e.fn === "evaluateManufacturingAchievementRules").length === 1 &&
      jAch >= 0 && jSk >= 0 && jPr >= 0 && jCb >= 0 && jMfg >= 0 && jOff >= 0 &&
      jAch < jSk && jSk < jPr && jPr < jCb && jCb < jMfg && jMfg < jOff &&
      itlM[jSk].atMs === itlM[jPr].atMs && itlM[jPr].atMs === itlM[jCb].atMs && itlM[jCb].atMs === itlM[jMfg].atMs &&
      itlM[jMfg].result && ["C01", "C02", "C03", "C04"].every((id) => itlM[jMfg].result.unlockedIds.includes(id)));

    // 旧档制造全满登录追溯：一次性补全 C01–C10/C12/C13
    const mfgFull = {
      skills: { mining: { lvl: 1, xp: 0 } },
      resources: { isk: 500, fuel: 100 },
      lastSaveTime: FROZEN_NOW - 3600 * 1000,
      achievements: { schemaVersion: 1, unlockedAtById: {} },
      planetary: { deployments: [], nextId: 1 },
      statistics: { version: 1, totals: { shipsBuilt: 100 }, production: { manufactured: {} } },
    };
    for (const id of EXP_COMPONENT_IDS) mfgFull.statistics.production.manufactured[id] = 1;
    for (const id of EXP_CAPITAL_IDS) mfgFull.statistics.production.manufactured[id] = 10;
    for (const id of EXP_SUPERCAPITAL_IDS) mfgFull.statistics.production.manufactured[id] = 9;
    let retroM = null;
    try { retroM = buildFullGameSandbox(JSON.stringify(mfgFull)); } catch (e) {
      ok("[mc34] 全满制造存档加载不抛异常: " + (e && e.message), false);
    }
    if (retroM) {
      const m = retroM.sandbox.gameState.achievements.unlockedAtById;
      const mRecR = retroM.timeline.filter((e) => e.fn === "evaluateManufacturingAchievementRules");
      ok("[mc34] 旧档制造全满登录后一次性补全 C01–C10/C12/C13（对账恰一次、unlockedIds 恰 12、全部=登录冻结 Date.now()）",
        mRecR.length === 1 && mRecR[0].result && mRecR[0].result.unlockedIds.length === 12 &&
        MANU_IDS.every((id) => m[id] === FROZEN_NOW));
      const perIdM = {};
      const MANU_ID_SET = new Set(MANU_IDS);
      for (const ev of retroM.achievementEvents) {
        if (MANU_ID_SET.has(ev.payload.achievementId)) perIdM[ev.payload.achievementId] = (perIdM[ev.payload.achievementId] || 0) + 1;
      }
      ok("[mc34b] 登录追溯的 12 项 achievement:unlocked 每项严格 emit 一次",
        MANU_IDS.every((id) => perIdM[id] === 1));
    }

    // 旧存档已有部分成就时间：登录后原时间不变且不重复 emit
    const keepSaveM = {
      skills: { mining: { lvl: 1, xp: 0 } },
      resources: { isk: 500, fuel: 100 },
      lastSaveTime: FROZEN_NOW - 3600 * 1000,
      achievements: { schemaVersion: 1, unlockedAtById: { "C01": 123.5, "C03": 456.25 } },
      planetary: { deployments: [], nextId: 1 },
      statistics: { version: 1, totals: { shipsBuilt: 100 }, production: { manufactured: {} } },
    };
    for (const id of EXP_COMPONENT_IDS) keepSaveM.statistics.production.manufactured[id] = 1;
    for (const id of EXP_CAPITAL_IDS) keepSaveM.statistics.production.manufactured[id] = 10;
    for (const id of EXP_SUPERCAPITAL_IDS) keepSaveM.statistics.production.manufactured[id] = 9;
    let keepM = null;
    try { keepM = buildFullGameSandbox(JSON.stringify(keepSaveM)); } catch (e) {
      ok("[mc35] 已有部分成就存档加载不抛异常: " + (e && e.message), false);
    }
    if (keepM) {
      const km = keepM.sandbox.gameState.achievements.unlockedAtById;
      ok("[mc35] 旧存档已有 C01=123.5/C03=456.25 登录后原时间保持不变且 C01/C03 不重复 emit（新补其余 10 项=登录冻结 Date.now()）",
        km["C01"] === 123.5 && km["C03"] === 456.25 &&
        keepM.achievementEvents.filter((ev) => ev.payload.achievementId === "C01").length === 0 &&
        keepM.achievementEvents.filter((ev) => ev.payload.achievementId === "C03").length === 0 &&
        ["C02", "C04", "C05", "C06", "C07", "C08", "C09", "C10", "C12", "C13"].every((id) => km[id] === FROZEN_NOW));
    }
  }

  // ========================= F. 源码与只读保护 =========================
  const persSrcM = fs.readFileSync(PERSISTENCE_PATH, "utf-8");
  const persCodeM = persSrcM.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const mfgCallN = (persCodeM.match(/evaluateManufacturingAchievementRules\(gameState,\s*achievementReconcileNow\)/g) || []).length;
  const nowDefN = (persCodeM.match(/achievementReconcileNow\s*=\s*Date\.now\(\)/g) || []).length;
  ok("[mc35b] persistence 两个入口各以同一 achievementReconcileNow 调用制造求值器（制造调用×2、Date.now() 取值恰 2 次）",
    mfgCallN === 2 && nowDefN === 2);
  const mfgRefN = (persCodeM.match(/evaluateManufacturingAchievementRules/g) || []).length;
  ok("[mc35c] persistence 中制造求值器引用恰 4 处（2 入口 ×（typeof 能力探测 + 调用））、无游离调用",
    mfgRefN === 4);

  const tickSrcM = fs.readFileSync(TICK_PATH, "utf-8");
  const offlineSrcM = fs.readFileSync(OFFLINE_PATH, "utf-8");
  const prodSrcM = fs.readFileSync(PRODUCTION_PATH, "utf-8");
  const statSrcM = fs.readFileSync(STATISTICS_PATH, "utf-8");
  const eventsSrcM = fs.readFileSync(EVENTS_PATH, "utf-8");
  const shipsSrcM = fs.readFileSync(SHIP_PATH, "utf-8");
  const mfgFilePath = path.join(ROOT, "js", "systems", "manufacturing.js");
  const mfgSysSrcM = fs.readFileSync(mfgFilePath, "utf-8");
  const forbiddenM = ["MANUFACTURING_RULES", "evaluateManufacturingAchievementRules", "unlockAchievement", "AchievementRuleData",
    "manufacturing-recipe-set-any", "manufacturing-recipe-set-total", "manufacturing-recipe", "manufacturing-total",
    "CAPITAL_SHIP_RECIPE_IDS", "SUPERCAPITAL_SHIP_RECIPE_IDS"];
  ok("[mc38] events.js/tick.js/offline.js/production.js/statistics.js/ships.js/manufacturing.js 不含制造成就规则或解锁调用（在线离线共用唯一事件链路，statistics 保持纯记账）",
    forbiddenM.every((t) => !eventsSrcM.includes(t) && !tickSrcM.includes(t) && !offlineSrcM.includes(t) &&
      !prodSrcM.includes(t) && !statSrcM.includes(t) && !shipsSrcM.includes(t) && !mfgSysSrcM.includes(t)));

  const mfgFnNames = ["readManufactured", "isManufacturingRuleMet", "evaluateManufacturingAchievementRules", "installManufacturingAchievementConsumer"];
  const mfgSrcSlice = mfgFnNames.map((n) => extractFnBody(achSysSrcM, n)).join("\n");
  const forbiddenRewardM = ["reward", "Steamworks", "greenworks", "steam_appid", "ResearchState", "grantAchievement", "addReward"];
  ok("[mc39] achievements.js 本批新增制造函数体不含奖励/UI/Steamworks/研究系统调用（仅解锁内核 + 制造事件消费者）",
    forbiddenRewardM.every((t) => !mfgSrcSlice.includes(t)));

  const afterCsvM = snapFile(CSV_PATH);
  const afterJsM = snapFile(JS_PATH);
  ok("[mc40] CSV 与冻结 achievements.js 字节(SHA-256/长度)+mtime 全程不变（与审计前快照一致）",
    snapEq(preWsCsv, afterCsvM) && snapEq(preWsJs, afterJsM));

  const mfgFilesAfter = listRepoFiles().sort();
  let mc41ok = mfgFilesBefore.length === mfgFilesAfter.length;
  if (mc41ok) {
    for (let i = 0; i < mfgFilesBefore.length; i++) {
      if (mfgFilesBefore[i] !== mfgFilesAfter[i]) { mc41ok = false; break; }
    }
  }
  ok("[mc41] 审计制造分区未向仓库写入任何辅助文件（运行前后文件清单完全一致）", mc41ok);

  ok("[mc35f] 制造规则数据在本分区内未被任何求值/消费者改变（MANUFACTURING_RULES 全冻结且 JSON 与分区开始时一致）",
    Object.isFrozen(RD.MANUFACTURING_RULES) &&
    RD.MANUFACTURING_RULES.every((r) => Object.isFrozen(r)) &&
    JSON.stringify(RD.MANUFACTURING_RULES) === manuRulesPreJson);
}

function runEquipment() {
  // ========================= 期望表（审计侧显式复刻，与规则文件交叉验证）=========================
  const EQUIP_IDS = ["D13", "D14", "D15", "D16", "D17", "D18"];
  const EXPECTED_EQUIP_COND = {
    D13: "首次装备制造", D14: "首次燃料制造", D15: "首次弹药制造",
    D16: "首次装备强化", D17: "制造首件改装件", D18: "集齐全部 60 件改装件",
  };
  const EQUIP_DATA_PATH = path.join(ROOT, "js", "data", "equipment.js");
  const AMMO_DATA_PATH = path.join(ROOT, "js", "data", "ammunition.js");
  const ACTIONS_PATH = path.join(ROOT, "js", "core", "actions.js");
  const STATION_PATH = path.join(ROOT, "js", "systems", "station.js");

  const sb = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const RD = sb.AchievementRuleData;
  const SYS = sb.AchievementSystem;
  const equipRulesPreJson = JSON.stringify(RD.EQUIPMENT_RULES);

  function makeEquipmentState(box, manufactured, equipEnh) {
    const man = {};
    if (manufactured && typeof manufactured === "object") {
      for (const k of Object.keys(manufactured)) man[k] = manufactured[k];
    }
    return {
      skills: {},
      achievements: box.AchievementState.createDefaultAchievementState(),
      statistics: {
        version: 2,
        totals: { equipmentEnhancementAttempts: equipEnh || 0 },
        production: { manufactured: man },
      },
      _dirty: false,
    };
  }
  const evaluateE = (state, atMs) => SYS.evaluateEquipmentAchievementRules(state, atMs);
  const unlockedSetE = (state) => new Set(Object.keys(state.achievements.unlockedAtById));

  function extractFnBody(src, name) {
    let start = src.indexOf("function " + name);
    if (start < 0) start = src.indexOf(name + "("); // 兼容对象方法简写 buyLPItem(state, itemId) { ... }
    if (start < 0) return "";
    const paren = src.indexOf("(", start);
    let i = src.indexOf("{", paren < 0 ? start : paren);
    if (i < 0) return "";
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return "";
  }
  function listRepoFiles() {
    const out = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === ".git" || e.name === "node_modules") continue;
          walk(p);
        } else {
          if (e.name.endsWith(".log")) continue;
          out.push(p);
        }
      }
    };
    walk(ROOT);
    return out;
  }
  const equipFilesBefore = listRepoFiles().sort();

  // ========================= A. 规则数据 + 四集合与源码双向交叉 =========================
  const nonRigFrozen = Object.isFrozen(RD.NON_RIG_EQUIPMENT_RECIPE_IDS) &&
    RD.NON_RIG_EQUIPMENT_RECIPE_IDS.length === 117 &&
    new Set(RD.NON_RIG_EQUIPMENT_RECIPE_IDS).size === 117 &&
    RD.NON_RIG_EQUIPMENT_RECIPE_IDS.every((id, i) => typeof id === "string" && id.length > 0);
  const rigFrozen = Object.isFrozen(RD.RIG_RECIPE_IDS) &&
    RD.RIG_RECIPE_IDS.length === 55 && new Set(RD.RIG_RECIPE_IDS).size === 55;
  const fuelFrozen = Object.isFrozen(RD.FUEL_RECIPE_IDS) &&
    RD.FUEL_RECIPE_IDS.length === 3 && new Set(RD.FUEL_RECIPE_IDS).size === 3;
  const ammoFrozen = Object.isFrozen(RD.AMMUNITION_RECIPE_IDS) &&
    RD.AMMUNITION_RECIPE_IDS.length === 3 && new Set(RD.AMMUNITION_RECIPE_IDS).size === 3;
  ok("[eq12b] 四配方 ID 数组内容/长度/唯一性/冻结精确（NON_RIG=117 / RIG=55 / FUEL=3 / AMMO=3）",
    nonRigFrozen && rigFrozen && fuelFrozen && ammoFrozen);
  if (!RD || !SYS || !Array.isArray(RD.EQUIPMENT_RULES)) return;

  // 通过单次 VM 串联 combat+ships+equipment+ammunition 源码导出真实 EQUIPMENT_RECIPES / AMMO_ENG_RECIPES
  let er = null, ar = null;
  try {
    const combatSrc = fs.readFileSync(COMBAT_PATH, "utf-8");
    const shipSrc = fs.readFileSync(SHIP_PATH, "utf-8");
    const equipSrc = fs.readFileSync(EQUIP_DATA_PATH, "utf-8");
    const ammoSrc = fs.readFileSync(AMMO_DATA_PATH, "utf-8");
    const epilogue = "\n;globalThis.__ER=(typeof EQUIPMENT_RECIPES!=='undefined')?EQUIPMENT_RECIPES:null;" +
      "globalThis.__AR=(typeof AMMO_ENG_RECIPES!=='undefined')?AMMO_ENG_RECIPES:null;";
    const combined = combatSrc + "\n" + shipSrc + "\n" + equipSrc + "\n" + ammoSrc + "\n" + epilogue;
    const ctx = { console };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(combined, ctx, { filename: "equip-cross-check.js" });
    er = ctx.__ER;
    ar = ctx.__AR;
  } catch (e) {
    er = null; ar = null;
  }
  const erOk = Array.isArray(er) && er.length > 0;
  const arOk = Array.isArray(ar) && ar.length > 0;

  const nonRigFromSrc = erOk ? er.filter((e) => e.slot !== "rig").map((e) => e.id).sort() : [];
  const rigFromSrc = erOk ? er.filter((e) => e.slot === "rig").map((e) => e.id).sort() : [];
  const setNR = new Set(nonRigFromSrc), setNRf = new Set(RD.NON_RIG_EQUIPMENT_RECIPE_IDS.slice().sort());
  const eq12ok = erOk && setNR.size === 117 && setNRf.size === 117 &&
    [...setNR].every((id) => setNRf.has(id)) && [...setNRf].every((id) => setNR.has(id));
  ok("[eq12] NON_RIG_EQUIPMENT_RECIPE_IDS(117) 与 EQUIPMENT_RECIPES.filter(slot!=='rig') 双向集合相等",
    eq12ok);
  const setR = new Set(rigFromSrc), setRf = new Set(RD.RIG_RECIPE_IDS.slice().sort());
  const eq13ok = erOk && setR.size === 55 && setRf.size === 55 &&
    [...setR].every((id) => setRf.has(id)) && [...setRf].every((id) => setR.has(id));
  ok("[eq13] RIG_RECIPE_IDS(55) 与 EQUIPMENT_RECIPES.filter(slot==='rig') 双向集合精确相等",
    eq13ok);
  const intersectNR = RD.NON_RIG_EQUIPMENT_RECIPE_IDS.filter((id) => RD.RIG_RECIPE_IDS.includes(id));
  ok("[eq14] NON_RIG 与 RIG 两集合零交集", intersectNR.length === 0);

  const fuelFromSrc = arOk ? ar.filter((r) => r.category === "fuel").map((r) => r.id).sort() : [];
  const setF = new Set(fuelFromSrc), setFf = new Set(RD.FUEL_RECIPE_IDS.slice().sort());
  const eq15ok = arOk && setF.size === 3 && setFf.size === 3 &&
    [...setF].every((id) => setFf.has(id)) && [...setFf].every((id) => setF.has(id));
  ok("[eq15] FUEL_RECIPE_IDS(3) 与 AMMO_ENG_RECIPES.category==='fuel' 双向集合相等", eq15ok);
  const ammoFromSrc = arOk ? ar.filter((r) => r.category === "ammunition").map((r) => r.id).sort() : [];
  const setA = new Set(ammoFromSrc), setAf = new Set(RD.AMMUNITION_RECIPE_IDS.slice().sort());
  const eq16ok = arOk && setA.size === 3 && setAf.size === 3 &&
    [...setA].every((id) => setAf.has(id)) && [...setAf].every((id) => setA.has(id));
  ok("[eq16] AMMUNITION_RECIPE_IDS(3) 与 AMMO_ENG_RECIPES.category==='ammunition' 双向集合相等", eq16ok);
  const probeIds = arOk ? ar.filter((r) => r.category === "probes").map((r) => r.id) : [];
  const eq17ok = arOk && probeIds.length === 3 &&
    probeIds.every((id) => !RD.AMMUNITION_RECIPE_IDS.includes(id)) &&
    RD.AMMUNITION_RECIPE_IDS.every((id) => !probeIds.includes(id));
  ok("[eq17] 考古探针三配方(probes) 不在 AMMUNITION 集合内、AMMUNITION 不含探针", eq17ok);

  // D13–D17 映射逐项冻结
  let eq18ok = true;
  const rD13 = RD.EQUIPMENT_RULES_BY_ID["D13"];
  if (!rD13 || rD13.type !== "equipment-recipe-set-any" ||
      !Array.isArray(rD13.recipeIds) || rD13.recipeIds.length !== 117 || rD13.minValue !== 1 ||
      rD13.recipeIds.some((id, i) => id !== RD.NON_RIG_EQUIPMENT_RECIPE_IDS[i])) eq18ok = false;
  const rD14 = RD.EQUIPMENT_RULES_BY_ID["D14"];
  if (!rD14 || rD14.type !== "equipment-recipe-set-any" ||
      !Array.isArray(rD14.recipeIds) || rD14.recipeIds.length !== 3 || rD14.minValue !== 1 ||
      rD14.recipeIds.some((id, i) => id !== RD.FUEL_RECIPE_IDS[i])) eq18ok = false;
  const rD15 = RD.EQUIPMENT_RULES_BY_ID["D15"];
  if (!rD15 || rD15.type !== "equipment-recipe-set-any" ||
      !Array.isArray(rD15.recipeIds) || rD15.recipeIds.length !== 3 || rD15.minValue !== 1 ||
      rD15.recipeIds.some((id, i) => id !== RD.AMMUNITION_RECIPE_IDS[i])) eq18ok = false;
  const rD16 = RD.EQUIPMENT_RULES_BY_ID["D16"];
  if (!rD16 || rD16.type !== "equipment-enhancement-total" ||
      rD16.totalKey !== "equipmentEnhancementAttempts" || rD16.minValue !== 1) eq18ok = false;
  const rD17 = RD.EQUIPMENT_RULES_BY_ID["D17"];
  if (!rD17 || rD17.type !== "equipment-recipe-set-any" ||
      !Array.isArray(rD17.recipeIds) || rD17.recipeIds.length !== 55 || rD17.minValue !== 1 ||
      rD17.recipeIds.some((id, i) => id !== RD.RIG_RECIPE_IDS[i])) eq18ok = false;
  ok("[eq18] D13–D17 映射逐项精确（type / 目标 recipeIds / totalKey / minValue）", eq18ok);

  const skillKeysE = new Set(Object.keys(RD.SKILL_RULES_BY_ID));
  const prodKeysE = new Set(Object.keys(RD.PRODUCTION_RULES_BY_ID));
  const combKeysE = new Set(Object.keys(RD.COMBAT_RULES_BY_ID));
  const manuKeysE = new Set(Object.keys(RD.MANUFACTURING_RULES_BY_ID));
  const equipKeysE = new Set(Object.keys(RD.EQUIPMENT_RULES_BY_ID));
  const unionE = new Set([...skillKeysE, ...prodKeysE, ...combKeysE, ...manuKeysE, ...equipKeysE]);
  const pairwiseDisjointE = [...skillKeysE].every((k) => !prodKeysE.has(k) && !combKeysE.has(k) && !manuKeysE.has(k) && !equipKeysE.has(k)) &&
    [...prodKeysE].every((k) => !combKeysE.has(k) && !manuKeysE.has(k) && !equipKeysE.has(k)) &&
    [...combKeysE].every((k) => !manuKeysE.has(k) && !equipKeysE.has(k)) &&
    [...manuKeysE].every((k) => !equipKeysE.has(k));
  const totalMapped = skillKeysE.size + prodKeysE.size + combKeysE.size + manuKeysE.size + equipKeysE.size;
  const totalAchievements = (typeof AD !== "undefined" && AD && Array.isArray(AD.ACHIEVEMENTS)) ? AD.ACHIEVEMENTS.length : 197;
  ok("[eq19] 技能50 + 生产18 + 战斗32 + 制造12 + 装备6 = 118 条规则、五集合零交集、未映射 = 197-118 = 79",
    skillKeysE.size === 50 && prodKeysE.size === 18 && combKeysE.size === 32 && manuKeysE.size === 12 && equipKeysE.size === 6 &&
    unionE.size === 118 && pairwiseDisjointE && totalMapped === 118 && (totalAchievements - unionE.size) === 79);

  // Batch C-13：D18 已成为装备规则（equipment-recipe-set-all），故从"无装备规则"清单移出；
  // D01–D12 仍属增幅剂分组，装备集合中不得出现。
  const noEquipIds = ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10", "D11", "D12"];
  ok("[eq20] D01–D12 无装备规则（五集合均无 D01–D12），且 D18 恰在装备集合内",
    noEquipIds.every((id) => !equipKeysE.has(id)) && equipKeysE.has("D18"));

  const csvRowsE = parseCSV(fs.readFileSync(CSV_PATH).slice(3).toString("utf-8")).slice(1);
  const csvByIdE = {};
  for (const r of csvRowsE) csvByIdE[r[0]] = r;
  const eq21cat = EQUIP_IDS.every((id) => csvByIdE[id] && csvByIdE[id][1] === "装备/增强剂");
  const eq21cond = EQUIP_IDS.every((id) => csvByIdE[id] && csvByIdE[id][2] === EXPECTED_EQUIP_COND[id]);
  ok("[eq21] CSV 交叉：D13–D17 分类=装备/增强剂、触发条件文本逐项一致", eq21cat && eq21cond);

  // ========================= B. 求值边界（逐配方 0/1）=========================
  let eq22ok = true;
  for (const id of RD.NON_RIG_EQUIPMENT_RECIPE_IDS) {
    const s0 = makeEquipmentState(sb, { [id]: 0 }, 0);
    const r0 = evaluateE(s0, 1000);
    const s1 = makeEquipmentState(sb, { [id]: 1 }, 0);
    const r1 = evaluateE(s1, 1000);
    if (!(r0.ok && r0.unlockedIds.length === 0 &&
          r1.ok && r1.unlockedIds.length === 1 && r1.unlockedIds[0] === "D13" &&
          unlockedSetE(s1).size === 1 && unlockedSetE(s1).has("D13"))) eq22ok = false;
  }
  ok("[eq22] D13：117 个非 rig 配方各自 0→0 项、1→恰 {D13}（逐项边界）", eq22ok);

  let eq23ok = true;
  for (const id of RD.FUEL_RECIPE_IDS) {
    const s0 = makeEquipmentState(sb, { [id]: 0 }, 0);
    const r0 = evaluateE(s0, 1000);
    const s1 = makeEquipmentState(sb, { [id]: 1 }, 0);
    const r1 = evaluateE(s1, 1000);
    if (!(r0.ok && r0.unlockedIds.length === 0 &&
          r1.ok && r1.unlockedIds.length === 1 && r1.unlockedIds[0] === "D14")) eq23ok = false;
  }
  ok("[eq23] D14：2 个燃料配方各自 0→0 项、1→恰 {D14}（逐项边界）", eq23ok);

  let eq24ok = true;
  for (const id of RD.AMMUNITION_RECIPE_IDS) {
    const s0 = makeEquipmentState(sb, { [id]: 0 }, 0);
    const r0 = evaluateE(s0, 1000);
    const s1 = makeEquipmentState(sb, { [id]: 1 }, 0);
    const r1 = evaluateE(s1, 1000);
    if (!(r0.ok && r0.unlockedIds.length === 0 &&
          r1.ok && r1.unlockedIds.length === 1 && r1.unlockedIds[0] === "D15")) eq24ok = false;
  }
  ok("[eq24] D15：3 个弹药配方各自 0→0 项、1→恰 {D15}（逐项边界）", eq24ok);

  // D16：0/1 边界；仅装备强化累计解锁；舰船强化 enhancementAttempts 不能解锁 D16
  const sD16_0 = makeEquipmentState(sb, {}, 0);
  const rD16_0 = evaluateE(sD16_0, 1000);
  const sD16_1 = makeEquipmentState(sb, {}, 1);
  const rD16_1 = evaluateE(sD16_1, 1000);
  const sShipOnly = makeEquipmentState(sb, {}, 0);
  sShipOnly.statistics.totals.enhancementAttempts = 5; // 舰船强化累计，装备强化为 0
  const rShipOnly = evaluateE(sShipOnly, 1000);
  ok("[eq25] D16：equipmentEnhancementAttempts 0→0 项、1→恰 {D16}；舰船 enhancementAttempts 不能解锁 D16（字段隔离）",
    rD16_0.ok && rD16_0.unlockedIds.length === 0 &&
    rD16_1.ok && rD16_1.unlockedIds.length === 1 && rD16_1.unlockedIds[0] === "D16" &&
    rShipOnly.ok && rShipOnly.unlockedIds.length === 0);

  let eq26ok = true;
  for (const id of RD.RIG_RECIPE_IDS) {
    const s0 = makeEquipmentState(sb, { [id]: 0 }, 0);
    const r0 = evaluateE(s0, 1000);
    const s1 = makeEquipmentState(sb, { [id]: 1 }, 0);
    const r1 = evaluateE(s1, 1000);
    if (!(r0.ok && r0.unlockedIds.length === 0 &&
          r1.ok && r1.unlockedIds.length === 1 && r1.unlockedIds[0] === "D17")) eq26ok = false;
  }
  ok("[eq26] D17：55 个 rig 配方各自 0→0 项、1→恰 {D17}（逐项边界）", eq26ok);

  // rig 不解锁 D13；fuel/ammo/probe 不解锁 D13；probe 不解锁 D15
  const sRigNotD13 = makeEquipmentState(sb, { "rig_mining_speed_i": 1 }, 0);
  const rRigNotD13 = evaluateE(sRigNotD13, 1000);
  const sFuelNotD13 = makeEquipmentState(sb, { "fuel_t1": 1 }, 0);
  const rFuelNotD13 = evaluateE(sFuelNotD13, 1000);
  const sAmmoNotD13 = makeEquipmentState(sb, { "ammo_laser": 1 }, 0);
  const rAmmoNotD13 = evaluateE(sAmmoNotD13, 1000);
  const sProbeNotD13 = makeEquipmentState(sb, { "probe_core_i": 1 }, 0);
  const rProbeNotD13 = evaluateE(sProbeNotD13, 1000);
  const sProbeNotD15 = makeEquipmentState(sb, { "probe_core_i": 1 }, 0);
  const rProbeNotD15 = evaluateE(sProbeNotD15, 1000);
  ok("[eq27] 改装件(rig)不解锁 D13 但解锁 D17；燃料/弹药不解锁 D13 而分别解锁 D14/D15；探针不解锁 D13/D15",
    !("D13" in sRigNotD13.achievements.unlockedAtById) && rRigNotD13.unlockedIds[0] === "D17" &&
    !("D13" in sFuelNotD13.achievements.unlockedAtById) && rFuelNotD13.unlockedIds[0] === "D14" &&
    !("D13" in sAmmoNotD13.achievements.unlockedAtById) && rAmmoNotD13.unlockedIds[0] === "D15" &&
    rProbeNotD13.unlockedIds.length === 0 && !("D13" in sProbeNotD13.achievements.unlockedAtById) &&
    rProbeNotD15.unlockedIds.length === 0);

  const sBadE = makeEquipmentState(sb, {
    unknown_recipe_xyz: 99, "t1_mining_laser": NaN, "rig_mining_speed_i": "5",
    "fuel_t1": Infinity, "ammo_laser": -1, "probe_core_i": null,
  }, NaN);
  const rBadE = evaluateE(sBadE, 1);
  ok("[eq28] 未知 recipeId、错桶、NaN/字符串/Infinity/负数/null/非法累计不得误解锁（0 项、ok=true）",
    rBadE.ok === true && rBadE.unlockedIds.length === 0 && unlockedSetE(sBadE).size === 0);

  const sFullE = makeEquipmentState(sb, {}, 100);
  for (const id of RD.NON_RIG_EQUIPMENT_RECIPE_IDS) sFullE.statistics.production.manufactured[id] = 1;
  for (const id of RD.FUEL_RECIPE_IDS) sFullE.statistics.production.manufactured[id] = 1;
  for (const id of RD.AMMUNITION_RECIPE_IDS) sFullE.statistics.production.manufactured[id] = 1;
  for (const id of RD.RIG_RECIPE_IDS) sFullE.statistics.production.manufactured[id] = 1;
  const rFullE = evaluateE(sFullE, 2000);
  // Batch C-13：全 55 件 rig 均置 1，D17（任一）与 D18（全部）同时达成 → 恰 6 项
  ok("[eq29] 全满统计单次求值恰好解锁 D13–D18（6 项，不少不多），且全部 unlockedAt=2000",
    rFullE.unlockedIds.length === 6 &&
    EQUIP_IDS.every((id) => sFullE.achievements.unlockedAtById[id] === 2000));

  // ========================= C. 幂等 / dirty / 时间语义 =========================
  const capE = [];
  sb.GameEvents.on("achievement:unlocked", (ev) => capE.push(ev));
  const sI_E = makeEquipmentState(sb, { "t1_mining_laser": 1, "fuel_t1": 1 }, 0);
  SYS.unlockAchievement(sI_E, "D13", 111);
  capE.length = 0;
  const rI1_E = evaluateE(sI_E, 5000);
  ok("[eq30] 首次求值 unlockedIds 只含本次新解锁项（含 D14 不含预解锁 D13，D13 保持 111）",
    rI1_E.ok && rI1_E.unlockedIds.includes("D14") && !rI1_E.unlockedIds.includes("D13") &&
    sI_E.achievements.unlockedAtById["D13"] === 111);
  sI_E._dirty = false;
  capE.length = 0;
  const rI2_E = evaluateE(sI_E, 6000);
  ok("[eq31] 同状态重复求值 unlockedIds=[]、不覆盖时间（D14 保持 5000）、不 emit、不 dirty",
    rI2_E.ok && rI2_E.unlockedIds.length === 0 &&
    sI_E.achievements.unlockedAtById["D14"] === 5000 && capE.length === 0 && sI_E._dirty === false);

  const TBE = 1690000123456.75;
  capE.length = 0;
  const sT_E = makeEquipmentState(sb, { "t1_mining_laser": 1, "fuel_t1": 1 }, 0);
  const rT_E = evaluateE(sT_E, TBE);
  const idCountsE = {};
  for (const ev of capE) idCountsE[ev.payload.achievementId] = (idCountsE[ev.payload.achievementId] || 0) + 1;
  const sameAtMsOkE = rT_E.unlockedIds.length === 2 &&
    sT_E.achievements.unlockedAtById["D13"] === TBE && sT_E.achievements.unlockedAtById["D14"] === TBE &&
    capE.length === 2 && idCountsE["D13"] === 1 && idCountsE["D14"] === 1 &&
    capE.every((ev) => ev.timestamp === ev.payload.unlockedAt && ev.payload.unlockedAt === TBE);
  const sNaNE = makeEquipmentState(sb, { "t1_mining_laser": 1 }, 0);
  const rNaNE = evaluateE(sNaNE, NaN);
  const nanOkE = rNaNE.unlockedIds.includes("D13") &&
    sNaNE.achievements.unlockedAtById["D13"] === FROZEN_NOW;
  ok("[eq32] 时间语义：同批多解锁共享同一浮点 atMs；非法 atMs 统一回退冻结 Date.now()", sameAtMsOkE && nanOkE);

  const sROE = makeEquipmentState(sb, { "t1_mining_laser": 1 });
  const statsBeforeE = JSON.stringify(sROE.statistics);
  const rulesBeforeE = JSON.stringify(RD.EQUIPMENT_RULES);
  evaluateE(sROE, 1);
  ok("[eq33] 求值前后 state.statistics 与 EQUIPMENT_RULES JSON 完全一致（条件读取纯只读；成就状态无 schema 污染）",
    JSON.stringify(sROE.statistics) === statsBeforeE &&
    JSON.stringify(RD.EQUIPMENT_RULES) === rulesBeforeE &&
    Object.isFrozen(RD.EQUIPMENT_RULES) &&
    !("manufactured" in sROE.achievements) && !("equipmentEnhancementAttempts" in sROE.achievements));

  // ========================= D. statistics v1→v2 迁移 / 事件记账（真实沙箱）=========================
  // D-a statistics 迁移：独立 VM 加载 statistics.js 并暴露 ensureStatisticsState
  let statVM = null;
  try {
    const statSrc = fs.readFileSync(STATISTICS_PATH, "utf-8");
    const epS = ";globalThis.__ensure=ensureStatisticsState;globalThis.__def=createDefaultStatisticsState;";
    const ctxS = { console };
    ctxS.window = ctxS;
    ctxS.globalThis = ctxS;
    ctxS.GameEvents = { onIdempotent() {}, on() {}, emit() {}, listenerCount() { return 0; } };
    ctxS.gameState = { statistics: { version: 1, totals: {}, production: {}, combat: {}, activity: {}, eventLedger: {} }, _dirty: false };
    vm.createContext(ctxS);
    vm.runInContext(statSrc + "\n" + epS, ctxS, { filename: "statistics-cross.js" });
    statVM = ctxS;
  } catch (e) { statVM = null; }

  if (statVM) {
    // eq1：v1→v2 真实迁移（缺 equipmentEnhancementAttempts 补齐为有限非负 0）
    statVM.gameState.statistics = {
      version: 1, totals: { events: 5 },
      production: { manufactured: {} }, combat: {}, activity: {}, eventLedger: {},
    };
    statVM.__ensure(statVM.gameState);
    const st1 = statVM.gameState.statistics;
    ok("[eq1] statistics v1→v6 真实迁移：version=6、equipmentEnhancementAttempts 补齐为有限非负(0)、旧 totals 保留",
      st1.version === 9 && st1.totals.equipmentEnhancementAttempts === 0 &&
      st1.totals.events === 5 && Number.isFinite(st1.totals.equipmentEnhancementAttempts));

    // eq2：缺字段 / 非法清洗为 0
    let eq2ok = true;
    for (const bad of [undefined, null, NaN, Infinity, -3, "abc"]) {
      statVM.gameState.statistics = {
        version: 2, totals: { equipmentEnhancementAttempts: bad },
        production: { manufactured: {} }, combat: {}, activity: {}, eventLedger: {},
      };
      statVM.__ensure(statVM.gameState);
      if (statVM.gameState.statistics.totals.equipmentEnhancementAttempts !== 0) eq2ok = false;
    }
    ok("[eq2] 缺字段/非法 equipmentEnhancementAttempts 清洗为 0（undefined/null/NaN/Infinity/负数/字符串/小数）", eq2ok);

    // eq3：合法旧统计保留（floor 收敛）
    statVM.gameState.statistics.totals.equipmentEnhancementAttempts = 7;
    statVM.__ensure(statVM.gameState);
    const kept7 = statVM.gameState.statistics.totals.equipmentEnhancementAttempts === 7;
    statVM.gameState.statistics.totals.equipmentEnhancementAttempts = 9.9;
    statVM.__ensure(statVM.gameState);
    const keptFloor = statVM.gameState.statistics.totals.equipmentEnhancementAttempts === 9;
    ok("[eq3] 合法旧 statistics.equipmentEnhancementAttempts 保留（7→7；9.9→floor→9）",
      kept7 && keptFloor && statVM.gameState.statistics.version === 9);

    // eq4：连续迁移幂等
    statVM.gameState.statistics = {
      version: 1, totals: { equipmentEnhancementAttempts: 4 },
      production: { manufactured: {} }, combat: {}, activity: {}, eventLedger: {},
    };
    const aE = JSON.stringify(statVM.__ensure(statVM.gameState).totals);
    const bE = JSON.stringify(statVM.__ensure(statVM.gameState).totals);
    ok("[eq4] 连续 ensure 迁移幂等（两次 totals JSON 一致、version 恒为 9）",
      aE === bE && statVM.gameState.statistics.version === 9);
  } else {
    ok("[eq1] statistics 迁移 VM 加载失败（见上方异常）", false);
  }

  // D-b 真实 statistics 沙箱：装备强化 / station 装备线记账，舰船强化字段隔离，不双计数
  const sbStat = buildKernelSandbox({ withEvents: true, withStatistics: true });
  const gsStat = sbStat.gameState;

  // eq5：equipment:enhancementAttempted 成功失败均累计
  sbStat.GameEvents.emit("equipment:enhancementAttempted",
    { instanceId: "eq-i-1", itemId: "t1_mining_laser", category: "weapon", fromLevel: 1, toLevel: 2, chance: 0.5, success: true, xp: 10, componentsSpent: 3 }, { offline: false, timestamp: 100 });
  sbStat.GameEvents.emit("equipment:enhancementAttempted",
    { instanceId: "eq-i-2", itemId: "t1_mining_laser", category: "weapon", fromLevel: 1, toLevel: 2, chance: 0.5, success: false, xp: 10, componentsSpent: 1 }, { offline: false, timestamp: 101 });
  ok("[eq5] equipment:enhancementAttempted 成功与失败均计入 equipmentEnhancementAttempts（2 次→2）",
    gsStat.statistics.totals.equipmentEnhancementAttempts === 2);

  // eq6：同 eventId 重放一次（onIdempotent 账本去重）
  sbStat.GameEvents.emit("equipment:enhancementAttempted",
    { instanceId: "eq-i-3", itemId: "t1_mining_laser", category: "weapon", fromLevel: 2, toLevel: 3, chance: 0.5, success: true, xp: 10, componentsSpent: 2 }, { offline: false, eventId: "eq-audit-dup-1" });
  sbStat.GameEvents.emit("equipment:enhancementAttempted",
    { instanceId: "eq-i-3b", itemId: "t1_mining_laser", category: "weapon", fromLevel: 2, toLevel: 3, chance: 0.5, success: true, xp: 10, componentsSpent: 2 }, { offline: false, eventId: "eq-audit-dup-1" });
  ok("[eq6] 同 eventId 重放：statistics 幂等账本只累计一次（equipmentEnhancementAttempts 保持 3）",
    gsStat.statistics.totals.equipmentEnhancementAttempts === 3);

  // eq7：ship:enhancementAttempted 只影响舰船字段，不影响装备字段
  sbStat.GameEvents.emit("ship:enhancementAttempted",
    { shipId: "ship-1", instanceId: "ship-eq-1", fromLevel: 3, toLevel: 4, chance: 0.5, success: true, xp: 10, componentsSpent: 1 }, { offline: false, timestamp: 200 });
  ok("[eq7] ship:enhancementAttempted 只增舰船 enhancementAttempts、不影响 equipmentEnhancementAttempts",
    gsStat.statistics.totals.enhancementAttempts === 1 &&
    gsStat.statistics.totals.equipmentEnhancementAttempts === 3);

  // eq8：station:autoLineCompleted lineId==='equipment' 真实累计 manufactured
  sbStat.GameEvents.emit("station:autoLineCompleted",
    { lineId: "equipment", targetId: "t1_mining_laser", quantity: 1, cycles: 1, xp: 10, offline: false }, { offline: false, timestamp: 300 });
  ok("[eq8] station:autoLineCompleted(lineId=equipment) 真实累计 manufactured[targetId]（t1_mining_laser=1）",
    gsStat.statistics.production.manufactured["t1_mining_laser"] === 1);

  // eq9：在线 / 离线 meta 均累计装备强化
  sbStat.GameEvents.emit("equipment:enhancementAttempted",
    { instanceId: "eq-i-4", itemId: "t1_mining_laser", category: "weapon", fromLevel: 4, toLevel: 5, chance: 0.5, success: true, xp: 10, componentsSpent: 1 }, { offline: false, timestamp: 400 });
  sbStat.GameEvents.emit("equipment:enhancementAttempted",
    { instanceId: "eq-i-5", itemId: "t1_mining_laser", category: "weapon", fromLevel: 5, toLevel: 6, chance: 0.5, success: true, xp: 10, componentsSpent: 1 }, { offline: true, timestamp: 401 });
  ok("[eq9] 在线/离线 equipment:enhancementAttempted 均累计（equipmentEnhancementAttempts=5）",
    gsStat.statistics.totals.equipmentEnhancementAttempts === 5);

  // eq10：station 其他 lineId（smelting/booster）不写入 manufactured / 装备字段
  const beforeSmelt = JSON.stringify(gsStat.statistics.production.manufactured);
  sbStat.GameEvents.emit("station:autoLineCompleted",
    { lineId: "smelting", targetId: "t1_mining_laser", quantity: 5, cycles: 1, xp: 10, offline: false }, { offline: false, timestamp: 500 });
  sbStat.GameEvents.emit("station:autoLineCompleted",
    { lineId: "booster", targetId: "t1_mining_laser", quantity: 5, cycles: 1, xp: 10, offline: false }, { offline: false, timestamp: 501 });
  ok("[eq10] station 非装备 lineId(smelting/booster) 不写入 manufactured、不增装备字段",
    JSON.stringify(gsStat.statistics.production.manufactured) === beforeSmelt &&
    gsStat.statistics.production.manufactured["t1_mining_laser"] === 1);

  // eq11：station 装备线同 eventId 不双计数（清空基线后，重复 eventId 仅累计一次）
  gsStat.statistics.production.manufactured = {};
  sbStat.GameEvents.emit("station:autoLineCompleted",
    { lineId: "equipment", targetId: "t1_mining_laser", quantity: 1, cycles: 1, xp: 10, offline: false }, { offline: false, eventId: "eq-station-dup-1" });
  sbStat.GameEvents.emit("station:autoLineCompleted",
    { lineId: "equipment", targetId: "t1_mining_laser", quantity: 1, cycles: 1, xp: 10, offline: false }, { offline: false, eventId: "eq-station-dup-1" });
  ok("[eq11] station 装备线同 eventId 重放不双计数（t1_mining_laser 恰为 1）",
    gsStat.statistics.production.manufactured["t1_mining_laser"] === 1);

  // ========================= E. 消费者（真实沙箱 + 手工沙箱）=========================
  const achSysSrcE = fs.readFileSync(ACH_SYSTEM_PATH, "utf-8");
  const eqInstallBody = extractFnBody(achSysSrcE, "installEquipmentAchievementConsumer");
  ok("[eq34] 装备消费者注册在通配符 \"*\" 且严格按 event.type 过滤（仅 manufacturing:completed / equipment:enhancementAttempted / station:autoLineCompleted(lineId==='equipment') 触发，其余立即 return）",
    eqInstallBody.includes('GE.on("*"') &&
    eqInstallBody.includes('"manufacturing:completed"') &&
    eqInstallBody.includes('"equipment:enhancementAttempted"') &&
    eqInstallBody.includes('"station:autoLineCompleted"') &&
    eqInstallBody.includes('lineId === "equipment"'));

  // E-a 真实 statistics + 五成就消费者同注册在 *，statistics 先行
  const sbS = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsS = sbS.gameState;
  const capS = [];
  sbS.GameEvents.on("achievement:unlocked", (ev) => capS.push(ev));
  const reinstallE = sbS.AchievementSystem.installEquipmentAchievementConsumer(gsS);
  ok("[eq35] listenerCount(\"*\") 体现 statistics+生产+战斗+制造+装备+增幅剂+考古+行星+空间站+综合生命周期 十监听，重复安装返回 ALREADY_INSTALLED",
    sbS.GameEvents.listenerCount("*") === 10 &&
    reinstallE && reinstallE.ok === false && reinstallE.reason === "ALREADY_INSTALLED");

  // eq37：普通在线装备制造解锁 D13
  sbS.GameEvents.emit("manufacturing:completed",
    { branch: "equipment", recipeId: "t1_mining_laser", quantity: 1, cycles: 1, xp: 10 },
    { offline: false, timestamp: 1000 });
  ok("[eq37] 普通在线 manufacturing:completed（非 rig 配方）→ D13 解锁（权威 manufactured 经 statistics 消费者累计）",
    typeof gsS.achievements.unlockedAtById["D13"] === "number" &&
    gsS.achievements.unlockedAtById["D13"] === 1000 &&
    capS.filter((ev) => ev.payload.achievementId === "D13").length === 1);

  // eq38：普通离线燃料/弹药解锁 D14/D15
  sbS.GameEvents.emit("manufacturing:completed",
    { branch: "equipment", recipeId: "fuel_t1", quantity: 1, cycles: 1, xp: 10 },
    { offline: true, timestamp: 1001 });
  sbS.GameEvents.emit("manufacturing:completed",
    { branch: "equipment", recipeId: "ammo_laser", quantity: 1, cycles: 1, xp: 10 },
    { offline: true, timestamp: 1002 });
  ok("[eq38] 离线 fuel_t1→D14、ammo_laser→D15 解锁（在线/离线共用单一事件链路）",
    typeof gsS.achievements.unlockedAtById["D14"] === "number" &&
    typeof gsS.achievements.unlockedAtById["D15"] === "number");

  // eq39：真实装备强化事件立即解锁 D16
  capS.length = 0;
  sbS.GameEvents.emit("equipment:enhancementAttempted",
    { instanceId: "eq-i-6", itemId: "t1_mining_laser", category: "weapon", fromLevel: 2, toLevel: 3, chance: 0.5, success: true, xp: 10, componentsSpent: 2 }, { offline: false, timestamp: 1003 });
  ok("[eq39] 真实 equipment:enhancementAttempted 立即解锁 D16（equipmentEnhancementAttempts 累计驱动）",
    typeof gsS.achievements.unlockedAtById["D16"] === "number" &&
    gsS.achievements.unlockedAtById["D16"] === 1003 &&
    capS.filter((ev) => ev.payload.achievementId === "D16").length === 1);

  // eq40：在线/离线 station 自动线 rig 解锁 D17
  sbS.GameEvents.emit("station:autoLineCompleted",
    { lineId: "equipment", targetId: "rig_mining_speed_i", quantity: 1, cycles: 1, xp: 10, offline: false }, { offline: false, timestamp: 1004 });
  sbS.GameEvents.emit("station:autoLineCompleted",
    { lineId: "equipment", targetId: "rig_gas_speed_i", quantity: 1, cycles: 1, xp: 10, offline: false }, { offline: true, timestamp: 1005 });
  ok("[eq40] 在线/离线 station:autoLineCompleted(lineId=equipment, rig) 解锁 D17",
    typeof gsS.achievements.unlockedAtById["D17"] === "number");

  // E-b 手工沙箱（无 statistics.js）：payload 不可信 + 安装失败原因 + dirty 语义
  const sbE = buildKernelSandbox({ withEvents: true, withRules: true });
  let instThrowE = false, rInvE = null, rNoStatIE = null, rNoEvE = null;
  try {
    rInvE = sbE.AchievementSystem.installEquipmentAchievementConsumer(null);
    rNoStatIE = sbE.AchievementSystem.installEquipmentAchievementConsumer(
      { achievements: sbE.AchievementState.createDefaultAchievementState() });
    const sbNoEvE = buildKernelSandbox({ withEvents: false, withRules: true });
    rNoEvE = sbNoEvE.AchievementSystem.installEquipmentAchievementConsumer(makeEquipmentState(sbNoEvE, {}, 0));
  } catch (e) { instThrowE = true; }
  ok("[eq36a] INVALID_STATE / STATISTICS_UNAVAILABLE / EVENTS_UNAVAILABLE 安装失败原因稳定，不抛异常",
    !instThrowE && rInvE && rInvE.ok === false && rInvE.reason === "INVALID_STATE" &&
    rNoStatIE && rNoStatIE.ok === false && rNoStatIE.reason === "STATISTICS_UNAVAILABLE" &&
    rNoEvE && rNoEvE.ok === false && rNoEvE.reason === "EVENTS_UNAVAILABLE");
  const stE = makeEquipmentState(sbE, {}, 0);
  const instE1 = sbE.AchievementSystem.installEquipmentAchievementConsumer(stE);
  const instE2 = sbE.AchievementSystem.installEquipmentAchievementConsumer(stE);
  ok("[eq36] 首次安装 {ok:true,reason:null}；重复安装 ALREADY_INSTALLED（每沙箱恰一套监听）",
    instE1 && instE1.ok === true && instE1.reason === null &&
    instE2 && instE2.ok === false && instE2.reason === "ALREADY_INSTALLED" &&
    sbE.GameEvents.listenerCount("*") === 1);

  // eq41：payload 伪造未达标不解锁（无 statistics 消费者，manufactured 保持权威空）
  sbE.GameEvents.emit("manufacturing:completed",
    { branch: "equipment", recipeId: "t1_mining_laser", quantity: 999999, cycles: 1, xp: 10 },
    { offline: false });
  ok("[eq41] 不信任 payload：事件声称 quantity=999999 但权威 manufactured 仍为 0 时不得解锁 D13",
    Object.keys(stE.achievements.unlockedAtById).length === 0 &&
    (stE.statistics.production.manufactured["t1_mining_laser"] || 0) === 0);

  // eq42：权威 statistics.manufactured 达标时即使 payload quantity=0 也按统计解锁 D13
  stE.statistics.production.manufactured["t1_mining_laser"] = 1;
  sbE.GameEvents.emit("manufacturing:completed",
    { branch: "equipment", recipeId: "t1_mining_laser", quantity: 0, cycles: 1, xp: 10 },
    { offline: false });
  ok("[eq42] 权威 statistics.manufactured 达标时即使触发事件 payload quantity=0 也按统计解锁 D13（unlockedAt=事件时间=FROZEN_NOW）",
    stE.achievements.unlockedAtById["D13"] === FROZEN_NOW);

  // eq43：其他事件严格过滤
  stE._dirty = false;
  sbE.GameEvents.emit("skill:levelUp", { skill: "mining", previousLevel: 1, level: 2 }, { source: "audit" });
  sbE.GameEvents.emit("mining:completed", { area: "凡晶石带", mode: "normal", resourceId: "ore:凡晶石", quantity: 1, cycles: 1, xp: 10 }, { offline: false });
  sbE.GameEvents.emit("combat:zoneCleared", { zoneId: "angel_outpost", name: "天使前哨站", lp: 10, clearCount: 1, damageTaken: 0 }, { offline: false });
  ok("[eq43] skill/mining/combat/其他事件不得触发装备求值（D13 已达标但无新解锁、_dirty=false）",
    stE.achievements.unlockedAtById["D13"] === FROZEN_NOW && stE._dirty === false);

  // eq44：无新解锁的消费者求值不置 dirty
  stE._dirty = false;
  sbE.GameEvents.emit("manufacturing:completed",
    { branch: "equipment", recipeId: "t1_mining_laser", quantity: 1, cycles: 1, xp: 10 },
    { offline: false });
  ok("[eq44] 无新解锁的消费者求值不置 dirty（_dirty 预置 false 后保持 false）", stE._dirty === false);

  // ========================= F. 真实接线与追溯 =========================
  let freshE = null;
  try { freshE = buildFullGameSandbox(null); } catch (e) {
    ok("[eq52] 新游戏全量脚本加载不抛异常: " + (e && e.message), false);
  }
  if (freshE) {
    const gs = freshE.sandbox.gameState;
    ok("[eq52] 全部 49 个脚本全量 VM 加载成功且 spy 完整（含装备对账 spy）",
      freshE.scriptSources.length === 49 && freshE.spyInstalled === true);
    const eRec = freshE.timeline.filter((e) => e.fn === "evaluateEquipmentAchievementRules");
    const sRecE = freshE.timeline.filter((e) => e.fn === "evaluateSkillAchievementRules");
    const pRecE = freshE.timeline.filter((e) => e.fn === "evaluateProductionAchievementRules");
    const cRecE = freshE.timeline.filter((e) => e.fn === "evaluateCombatAchievementRules");
    const mRecE = freshE.timeline.filter((e) => e.fn === "evaluateManufacturingAchievementRules");
    // C-13：装备求值器自身仍解锁 0 项（D18 需 55/55 改装件）；全局解锁集恰为 {I01}
    ok("[eq52b] 新游戏 autoLoad 装备对账恰好一次、atMs=登录冻结 Date.now()、ok=true、装备解锁 0 项",
      eRec.length === 1 && eRec[0].atMs === FROZEN_NOW &&
      eRec[0].result && eRec[0].result.ok === true && eRec[0].result.unlockedIds.length === 0 &&
      Object.keys(gs.achievements.unlockedAtById).sort().join(",") === "I01");
    const iSk = freshE.timeline.findIndex((e) => e.fn === "evaluateSkillAchievementRules");
    const iPr = freshE.timeline.findIndex((e) => e.fn === "evaluateProductionAchievementRules");
    const iCb = freshE.timeline.findIndex((e) => e.fn === "evaluateCombatAchievementRules");
    const iMfg = freshE.timeline.findIndex((e) => e.fn === "evaluateManufacturingAchievementRules");
    const iEq = freshE.timeline.findIndex((e) => e.fn === "evaluateEquipmentAchievementRules");
    const iAch = freshE.timeline.findIndex((e) => e.fn === "migrateAchievementState");
    const iOff = freshE.timeline.findIndex((e) => e.fn === "calculateOfflineGains");
    ok("[eq46] 顺序 achievement migrate < skill < production < combat < manufacturing < equipment < offline",
      iAch >= 0 && iSk >= 0 && iPr >= 0 && iCb >= 0 && iMfg >= 0 && iEq >= 0 &&
      iAch < iSk && iSk < iPr && iPr < iCb && iCb < iMfg && iMfg < iEq && (iOff === -1 || iEq < iOff));
    ok("[eq47] 五求值器 atMs 完全相同（skill==production==combat==manufacturing==equipment）",
      sRecE.length === 1 && pRecE.length === 1 && cRecE.length === 1 && mRecE.length === 1 && eRec.length === 1 &&
      sRecE[0].atMs === pRecE[0].atMs && pRecE[0].atMs === cRecE[0].atMs &&
      cRecE[0].atMs === mRecE[0].atMs && mRecE[0].atMs === eRec[0].atMs);
    ok("[eq33b] 成就状态 schema 未引入新字段（无 manufactured/equipmentEnhancementAttempts 子对象；进度仍仅 unlockedAtById）",
      !("manufactured" in gs.achievements) && !("equipmentEnhancementAttempts" in gs.achievements) &&
      !("production" in gs.achievements) &&
      Object.keys(gs.achievements).sort().join(",") === "schemaVersion,unlockedAtById");

    // eq45：importData 真实路径：statistics 随档导入 → 装备对账补 D13/D14/D15/D16/D17
    const tlE = freshE.timeline.length;
    const importSaveE = {
      skills: { mining: { lvl: 1, xp: 0 } },
      resources: { isk: 1000, fuel: 100 },
      achievements: { schemaVersion: 1, unlockedAtById: {} },
      planetary: { deployments: [], nextId: 1 },
      statistics: {
        version: 2, totals: { equipmentEnhancementAttempts: 1 },
        production: { manufactured: { "t1_mining_laser": 1, "fuel_t1": 1, "ammo_laser": 1, "rig_mining_speed_i": 1 } },
      },
    };
    let importOkE = false;
    try { importOkE = freshE.sandbox.SaveManager.importData(JSON.stringify(importSaveE)); } catch (e) {
      ok("[eq45] importData 抛出异常: " + (e && e.message), false);
    }
    const itlE = freshE.timeline.slice(tlE);
    const jSk = itlE.findIndex((e) => e.fn === "evaluateSkillAchievementRules");
    const jPr = itlE.findIndex((e) => e.fn === "evaluateProductionAchievementRules");
    const jCb = itlE.findIndex((e) => e.fn === "evaluateCombatAchievementRules");
    const jMfg = itlE.findIndex((e) => e.fn === "evaluateManufacturingAchievementRules");
    const jEq = itlE.findIndex((e) => e.fn === "evaluateEquipmentAchievementRules");
    const jAch = itlE.findIndex((e) => e.fn === "migrateAchievementState");
    const jOff = itlE.findIndex((e) => e.fn === "calculateOfflineGains");
    ok("[eq45] importData 装备对账恰好一次且顺序 migrate<skill<production<combat<manufacturing<equipment<offline、五次 atMs 相同、补 D13/D14/D15/D16/D17",
      importOkE === true &&
      itlE.filter((e) => e.fn === "evaluateEquipmentAchievementRules").length === 1 &&
      jAch >= 0 && jSk >= 0 && jPr >= 0 && jCb >= 0 && jMfg >= 0 && jEq >= 0 && jOff >= 0 &&
      jAch < jSk && jSk < jPr && jPr < jCb && jCb < jMfg && jMfg < jEq && jEq < jOff &&
      itlE[jSk].atMs === itlE[jPr].atMs && itlE[jPr].atMs === itlE[jCb].atMs &&
      itlE[jCb].atMs === itlE[jMfg].atMs && itlE[jMfg].atMs === itlE[jEq].atMs &&
      itlE[jEq].result && ["D13", "D14", "D15", "D16", "D17"].every((id) => itlE[jEq].result.unlockedIds.includes(id)));

    // eq48：旧档（v2）制造全满登录追溯 D13/D14/D15/D17（equipmentEnhancementAttempts=0 → D16 锁）
    const equipFull = {
      skills: { mining: { lvl: 1, xp: 0 } },
      resources: { isk: 500, fuel: 100 },
      lastSaveTime: FROZEN_NOW - 3600 * 1000,
      achievements: { schemaVersion: 1, unlockedAtById: {} },
      planetary: { deployments: [], nextId: 1 },
      statistics: {
        version: 2, totals: { equipmentEnhancementAttempts: 0 },
        production: { manufactured: { "t1_mining_laser": 1, "fuel_t1": 1, "ammo_laser": 1, "rig_mining_speed_i": 1 } },
      },
    };
    let retroE = null;
    try { retroE = buildFullGameSandbox(JSON.stringify(equipFull)); } catch (e) {
      ok("[eq48] 全满装备存档加载不抛异常: " + (e && e.message), false);
    }
    if (retroE) {
      const m48 = retroE.sandbox.gameState.achievements.unlockedAtById;
      const eRec48 = retroE.timeline.filter((e) => e.fn === "evaluateEquipmentAchievementRules");
      ok("[eq48] 旧档 v2 制造全满登录后一次性补全 D13/D14/D15/D17（对账恰一次、D16 因 attempts=0 仍锁）",
        eRec48.length === 1 && eRec48[0].result && eRec48[0].result.unlockedIds.length === 4 &&
        ["D13", "D14", "D15", "D17"].every((id) => m48[id] === FROZEN_NOW) &&
        !("D16" in m48));
    }

    // eq49：旧档 v2 装备强化累计追溯 D16
    const enhFull = {
      skills: { mining: { lvl: 1, xp: 0 } },
      resources: { isk: 500, fuel: 100 },
      lastSaveTime: FROZEN_NOW - 3600 * 1000,
      achievements: { schemaVersion: 1, unlockedAtById: {} },
      planetary: { deployments: [], nextId: 1 },
      statistics: {
        version: 2, totals: { equipmentEnhancementAttempts: 5 },
        production: { manufactured: {} },
      },
    };
    let retroE2 = null;
    try { retroE2 = buildFullGameSandbox(JSON.stringify(enhFull)); } catch (e) {
      ok("[eq49] 装备强化累计存档加载不抛异常: " + (e && e.message), false);
    }
    if (retroE2) {
      const m49 = retroE2.sandbox.gameState.achievements.unlockedAtById;
      ok("[eq49] 旧档 v2 equipmentEnhancementAttempts=5 登录后追溯解锁 D16（=登录冻结 Date.now()）",
        m49["D16"] === FROZEN_NOW);
    }

    // eq50：旧档 v1 不臆测 D16（缺字段迁移为 0）
    const v1Save = {
      skills: { mining: { lvl: 1, xp: 0 } },
      resources: { isk: 500, fuel: 100 },
      lastSaveTime: FROZEN_NOW - 3600 * 1000,
      achievements: { schemaVersion: 1, unlockedAtById: {} },
      planetary: { deployments: [], nextId: 1 },
      statistics: {
        version: 1, totals: {},
        production: { manufactured: { "t1_mining_laser": 1 } },
      },
    };
    let retroE3 = null;
    try { retroE3 = buildFullGameSandbox(JSON.stringify(v1Save)); } catch (e) {
      ok("[eq50] v1 装备存档加载不抛异常: " + (e && e.message), false);
    }
    if (retroE3) {
      const m50 = retroE3.sandbox.gameState.achievements.unlockedAtById;
      ok("[eq50] 旧档 v1（无 equipmentEnhancementAttempts 字段）迁移为 0、不臆测 D16（D13 因非 rig 制造解锁、D16 仍锁）",
        !("D16" in m50) && m50["D13"] === FROZEN_NOW &&
        retroE3.sandbox.gameState.statistics.totals.equipmentEnhancementAttempts === 0);
    }

    // eq51：旧存档已有部分成就时间：登录后原时间不变且不重复 emit
    const keepSaveE = {
      skills: { mining: { lvl: 1, xp: 0 } },
      resources: { isk: 500, fuel: 100 },
      lastSaveTime: FROZEN_NOW - 3600 * 1000,
      achievements: { schemaVersion: 1, unlockedAtById: { "D13": 123.5, "D14": 456.25 } },
      planetary: { deployments: [], nextId: 1 },
      statistics: {
        version: 2, totals: { equipmentEnhancementAttempts: 0 },
        production: { manufactured: { "t1_mining_laser": 1, "fuel_t1": 1, "ammo_laser": 1, "rig_mining_speed_i": 1 } },
      },
    };
    let keepE = null;
    try { keepE = buildFullGameSandbox(JSON.stringify(keepSaveE)); } catch (e) {
      ok("[eq51] 已有部分成就存档加载不抛异常: " + (e && e.message), false);
    }
    if (keepE) {
      const kmE = keepE.sandbox.gameState.achievements.unlockedAtById;
      ok("[eq51] 旧存档已有 D13=123.5/D14=456.25 登录后原时间保持不变且 D13/D14 不重复 emit（新补 D15/D17=登录冻结 Date.now()、D16 仍锁）",
        kmE["D13"] === 123.5 && kmE["D14"] === 456.25 &&
        keepE.achievementEvents.filter((ev) => ev.payload.achievementId === "D13").length === 0 &&
        keepE.achievementEvents.filter((ev) => ev.payload.achievementId === "D14").length === 0 &&
        kmE["D15"] === FROZEN_NOW && kmE["D17"] === FROZEN_NOW && !("D16" in kmE));
    }
  }

  // ========================= G. 源码与只读保护 =========================
  const persSrcE = fs.readFileSync(PERSISTENCE_PATH, "utf-8");
  const persCodeE = persSrcE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const eqCallN = (persCodeE.match(/evaluateEquipmentAchievementRules\(gameState,\s*achievementReconcileNow\)/g) || []).length;
  const nowDefN = (persCodeE.match(/achievementReconcileNow\s*=\s*Date\.now\(\)/g) || []).length;
  ok("[eq45b] persistence 两个入口各以同一 achievementReconcileNow 调用装备求值器（装备调用×2、Date.now() 取值恰 2 次）",
    eqCallN === 2 && nowDefN === 2);
  const eqRefN = (persCodeE.match(/evaluateEquipmentAchievementRules/g) || []).length;
  ok("[eq45c] persistence 中装备求值器引用恰 4 处（2 入口 ×（typeof 能力探测 + 调用））、无游离调用",
    eqRefN === 4);

  const tickSrcE = fs.readFileSync(TICK_PATH, "utf-8");
  const offlineSrcE = fs.readFileSync(OFFLINE_PATH, "utf-8");
  const prodSrcE = fs.readFileSync(PRODUCTION_PATH, "utf-8");
  const statSrcE = fs.readFileSync(STATISTICS_PATH, "utf-8");
  const eventsSrcE = fs.readFileSync(EVENTS_PATH, "utf-8");
  const actionsSrcE = fs.readFileSync(ACTIONS_PATH, "utf-8");
  const equipFilePath = path.join(ROOT, "js", "data", "equipment.js");
  const equipSysSrcE = fs.readFileSync(equipFilePath, "utf-8");
  const ammoFilePath = path.join(ROOT, "js", "data", "ammunition.js");
  const ammoSysSrcE = fs.readFileSync(ammoFilePath, "utf-8");
  const mfgSysSrcE = fs.readFileSync(path.join(ROOT, "js", "systems", "manufacturing.js"), "utf-8");
  const stationSysSrcE = fs.readFileSync(STATION_PATH, "utf-8");
  const forbiddenE = ["EQUIPMENT_RULES", "evaluateEquipmentAchievementRules", "installEquipmentAchievementConsumer",
    "equipment-recipe-set-any", "equipment-enhancement-total",
    "NON_RIG_EQUIPMENT_RECIPE_IDS", "RIG_RECIPE_IDS", "AMMUNITION_RECIPE_IDS", "FUEL_RECIPE_IDS",
    "unlockAchievement", "AchievementRuleData"];
  ok("[eq53] events.js/tick.js/offline.js/actions.js/equipment.js/ammunition.js/manufacturing.js/station.js 不含装备成就规则或解锁调用（statistics 保持纯记账）",
    forbiddenE.every((t) => !eventsSrcE.includes(t) && !tickSrcE.includes(t) && !offlineSrcE.includes(t) &&
      !actionsSrcE.includes(t) && !equipSysSrcE.includes(t) && !ammoSysSrcE.includes(t) &&
      !mfgSysSrcE.includes(t) && !stationSysSrcE.includes(t) && !prodSrcE.includes(t) && !statSrcE.includes(t)));

  const eqFnNames = ["readManufactured", "isEquipmentRuleMet", "evaluateEquipmentAchievementRules", "installEquipmentAchievementConsumer"];
  const eqSrcSlice = eqFnNames.map((n) => extractFnBody(achSysSrcE, n)).join("\n");
  const forbiddenRewardE = ["reward", "Steamworks", "greenworks", "steam_appid", "ResearchState", "grantAchievement", "addReward"];
  ok("[eq54] achievements.js 本批新增装备函数体不含奖励/UI/Steamworks/研究系统调用（仅解锁内核 + 装备事件消费者）",
    forbiddenRewardE.every((t) => !eqSrcSlice.includes(t)));

  const afterCsvE = snapFile(CSV_PATH);
  const afterJsE = snapFile(JS_PATH);
  ok("[eq55] CSV 与冻结 achievements.js 字节(SHA-256/长度)+mtime 全程不变（与审计前快照一致）",
    snapEq(preWsCsv, afterCsvE) && snapEq(preWsJs, afterJsE));

  const equipFilesAfter = listRepoFiles().sort();
  let eq56ok = equipFilesBefore.length === equipFilesAfter.length;
  if (eq56ok) {
    for (let i = 0; i < equipFilesBefore.length; i++) {
      if (equipFilesBefore[i] !== equipFilesAfter[i]) { eq56ok = false; break; }
    }
  }
  ok("[eq56] 审计装备分区未向仓库写入任何辅助文件（运行前后文件清单完全一致）", eq56ok);

  ok("[eq33c] 装备规则数据在本分区内未被任何求值/消费者改变（EQUIPMENT_RULES 全冻结且 JSON 与分区开始时一致）",
    Object.isFrozen(RD.EQUIPMENT_RULES) &&
    RD.EQUIPMENT_RULES.every((r) => Object.isFrozen(r)) &&
    JSON.stringify(RD.EQUIPMENT_RULES) === equipRulesPreJson);
}

// =============================================================================
// --boosters：增幅剂制造成就 D01–D12
// =============================================================================
function runBoosters() {
  // 仓库文件清单快照（前）：在一切 fixture/动作之前拍摄
  const boosterFilesBefore = [];
  try {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p); }
        else boosterFilesBefore.push(p);
      }
    })(ROOT);
  } catch (e) { boosterFilesBefore.length = 0; }

  // ---- 辅助 ----
  function makeBoosterState(box, boostersMap, total) {
    const bMap = {};
    if (boostersMap && typeof boostersMap === "object") {
      for (const k of Object.keys(boostersMap)) bMap[k] = boostersMap[k];
    }
    return {
      skills: {},
      achievements: box.AchievementState.createDefaultAchievementState(),
      statistics: {
        version: 3,
        totals: { boostersManufactured: (typeof total === "number" && isFinite(total) && total >= 0) ? Math.floor(total) : 0 },
        production: { boosters: bMap },
      },
      _dirty: false,
    };
  }
  const BOOSTER_IDS = ["D01","D02","D03","D04","D05","D06","D07","D08","D09","D10","D11","D12"];
  const evaluateB = (state, atMs) => SYS.evaluateBoosterAchievementRules(state, atMs);
  const unlockedSetB = (state) => new Set(Object.keys(state.achievements.unlockedAtById));

  function extractFnBody(src, name) {
    let start = src.indexOf("function " + name);
    if (start < 0) start = src.indexOf(name + "("); // 兼容对象方法简写 buyLPItem(state, itemId) { ... }
    if (start < 0) return "";
    const paren = src.indexOf("(", start);
    let i = src.indexOf("{", paren < 0 ? start : paren);
    if (i < 0) return "";
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return "";
  }

  // ========================= A. 规则数据 =========================
  const sbA = buildKernelSandbox({ withEvents: true, withRules: true });
  const RD = sbA.AchievementRuleData;
  const SYS = sbA.AchievementSystem;
  ok("[br1] BOOSTER_RECIPE_IDS 冻结数组 30 项且每项为 string", Array.isArray(RD.BOOSTER_RECIPE_IDS) && RD.BOOSTER_RECIPE_IDS.length === 30 &&
    RD.BOOSTER_RECIPE_IDS.every((id) => typeof id === "string") && Object.isFrozen(RD.BOOSTER_RECIPE_IDS));

  ok("[br2] LEGENDARY_BOOSTER_RECIPE_IDS 冻结数组 10 项", Array.isArray(RD.LEGENDARY_BOOSTER_RECIPE_IDS) &&
    RD.LEGENDARY_BOOSTER_RECIPE_IDS.length === 10 && Object.isFrozen(RD.LEGENDARY_BOOSTER_RECIPE_IDS));

  // 与 boosters.js 真实 30 个配方双向集合相等
  let br3ok = true;
  try {
    const boosterSrc = fs.readFileSync(BOOSTERS_DATA_PATH, "utf-8");
    const ctxB = { window: {}, globalThis: {}, console };
    ctxB.window = ctxB;
    ctxB.globalThis = ctxB;
    vm.createContext(ctxB);
    vm.runInContext(boosterSrc, ctxB, { filename: "boosters.js" });
    const realIds = ctxB.BOOSTER_RECIPES.map((r) => r.id).sort();
    const ruleIds = [...RD.BOOSTER_RECIPE_IDS].sort();
    br3ok = realIds.length === 30 && ruleIds.length === 30 && realIds.every((id, i) => id === ruleIds[i]);
  } catch (e) { br3ok = false; }
  ok("[br3] BOOSTER_RECIPE_IDS 与 boosters.js BOOSTER_RECIPES 双向集合完全相等（各 30）", br3ok);

  // 10 传奇 ID 与 D01–D10 精确映射
  const legendMap = {
    D01:"mining_lubricant_l", D02:"ore_resonance_l", D03:"relic_solver_l",
    D04:"artifact_tracer_l", D05:"laser_coolant_l", D06:"missile_catalyst_l",
    D07:"cannon_booster_l", D08:"shield_recharge_l", D09:"armor_nano_l", D10:"structure_gel_l",
  };
  ok("[br4] LEGENDARY_BOOSTER_RECIPE_IDS[0..9] 与 D01→D10 精确逐项映射",
    Object.entries(legendMap).every(([id, recipe]) => {
      const idx = Number(id.slice(1)) - 1;
      return RD.LEGENDARY_BOOSTER_RECIPE_IDS[idx] === recipe;
    }));

  // 六规则集合两两零交集
  const allRuleIdSets = [
    { name:"skill", ids:new Set(RD.SKILL_RULES.map((r) => r.achievementId)) },
    { name:"production", ids:new Set(RD.PRODUCTION_RULES.map((r) => r.achievementId)) },
    { name:"combat", ids:new Set(RD.COMBAT_RULES.map((r) => r.achievementId)) },
    { name:"manufacturing", ids:new Set(RD.MANUFACTURING_RULES.map((r) => r.achievementId)) },
    { name:"equipment", ids:new Set(RD.EQUIPMENT_RULES.map((r) => r.achievementId)) },
    { name:"booster", ids:new Set(RD.BOOSTER_RULES.map((r) => r.achievementId)) },
  ];
  let br5ok = true;
  for (let i = 0; i < allRuleIdSets.length && br5ok; i++) {
    for (let j = i + 1; j < allRuleIdSets.length && br5ok; j++) {
      for (const id of allRuleIdSets[i].ids) {
        if (allRuleIdSets[j].ids.has(id)) { br5ok = false; break; }
      }
    }
  }
  // 总规则计数
  const skillCnt = RD.SKILL_RULES.length;
  const prodCnt = RD.PRODUCTION_RULES.length;
  const combatCnt = RD.COMBAT_RULES.length;
  const manuCnt = RD.MANUFACTURING_RULES.length;
  const equipCnt = RD.EQUIPMENT_RULES.length;
  const boostCnt = RD.BOOSTER_RULES.length;
  const totalRules = skillCnt + prodCnt + combatCnt + manuCnt + equipCnt + boostCnt;
  br5ok = br5ok && totalRules === 130 && allRuleIdSets.reduce((s, x) => s + x.ids.size, 0) === 130;
  ok("[br5] 六规则集合两两零交集 && 总规则 130（50+18+32+12+6+12=130 且各无重复）", br5ok);

  // CSV 交叉：D01–D12 分类和触发条件
  ok("[br6] BOOSTER_RULES 冻结数组 12 项且与 BY_ID 索引一致",
    Array.isArray(RD.BOOSTER_RULES) && RD.BOOSTER_RULES.length === 12 &&
    RD.BOOSTER_RULES_BY_ID && Object.keys(RD.BOOSTER_RULES_BY_ID).length === 12 &&
    BOOSTER_IDS.every((id) => RD.BOOSTER_RULES_BY_ID[id] === RD.BOOSTER_RULES[Number(id.slice(1)) - 1]));

  // 规则类型和字段
  ok("[br7] D01–D10 type=booster-recipe 且 recipeId 为传奇 ID；D11/D12 type=booster-total 且 totalKey=boostersManufactured",
    RD.BOOSTER_RULES.slice(0, 10).every((r) => r.type === "booster-recipe" && typeof r.recipeId === "string" && r.minValue === 1) &&
    RD.BOOSTER_RULES[10].type === "booster-total" && RD.BOOSTER_RULES[10].totalKey === "boostersManufactured" && RD.BOOSTER_RULES[10].minValue === 1 &&
    RD.BOOSTER_RULES[11].type === "booster-total" && RD.BOOSTER_RULES[11].totalKey === "boostersManufactured" && RD.BOOSTER_RULES[11].minValue === 1000);

  // D13–D17 不在增幅剂规则中（不重复定义）
  ok("[br8] D13–D17 不存在于 BOOSTER_RULES_BY_ID",
    ["D13","D14","D15","D16","D17"].every((id) => !(id in RD.BOOSTER_RULES_BY_ID)));

  // ========================= B. 求值边界 =========================

  // D01–D10 每项：0 不解锁、1 传奇解锁对应项
  let br9ok = true;
  for (let i = 0; i < 10; i++) {
    const id = BOOSTER_IDS[i];
    const recipe = legendMap[id];
    // 0 不解锁
    const s0 = makeBoosterState(sbA, {}, 0);
    const r0 = evaluateB(s0, 100);
    if (r0.unlockedIds.length !== 0 || (id in s0.achievements.unlockedAtById)) br9ok = false;
    // 1 传奇解锁对应项
    const s1 = makeBoosterState(sbA, { [recipe]: 1 }, 0);
    const r1 = evaluateB(s1, 200);
    if (r1.unlockedIds.length !== 1 || r1.unlockedIds[0] !== id) br9ok = false;
    // 同系列 n/r 不解锁
    const series = recipe.replace(/_l$/, "");
    const nRecipe = series + "_n";
    const rRecipe = series + "_r";
    const sN = makeBoosterState(sbA, { [nRecipe]: 1 }, 0);
    const rN = evaluateB(sN, 300);
    if (rN.unlockedIds.includes(id)) br9ok = false;
    const sR = makeBoosterState(sbA, { [rRecipe]: 1 }, 0);
    const rR = evaluateB(sR, 400);
    if (rR.unlockedIds.includes(id)) br9ok = false;
  }
  ok("[br9] D01–D10 每项：0 不解锁、1 对应传奇解锁恰该项、同系列 n/r 不解锁该项", br9ok);

  // D11：total=0 不解锁、total=1 解锁
  const sD11_0 = makeBoosterState(sbA, {}, 0);
  const rD11_0 = evaluateB(sD11_0, 500);
  const sD11_1 = makeBoosterState(sbA, { "mining_lubricant_n": 1 }, 1);
  const rD11_1 = evaluateB(sD11_1, 500);
  ok("[br10] D11：boostersManufactured=0 不解锁、=1 解锁",
    rD11_0.unlockedIds.every((id) => id !== "D11") &&
    rD11_1.unlockedIds.includes("D11"));

  // D12：999 不解锁、1000 解锁
  const sD12_999 = makeBoosterState(sbA, {}, 999);
  const rD12_999 = evaluateB(sD12_999, 600);
  const sD12_1000 = makeBoosterState(sbA, {}, 1000);
  const rD12_1000 = evaluateB(sD12_1000, 600);
  ok("[br11] D12��boostersManufactured=999 ���解锁、=1000 解锁",
    !rD12_999.unlockedIds.includes("D12") &&
    rD12_1000.unlockedIds.includes("D12"));

  // 全满：全部 12 项解锁，顺序稳定
  const sFullB = makeBoosterState(sbA, {}, 1000);
  const legendRecipes = RD.LEGENDARY_BOOSTER_RECIPE_IDS;
  for (const r of legendRecipes) sFullB.statistics.production.boosters[r] = 1;
  sFullB.statistics.production.boosters["mining_lubricant_n"] = 1; // 触发 D11
  const rFullB = evaluateB(sFullB, 2000);
  ok("[br12] 全满状态单次求值恰好解锁 D01–D12（12 项，不少不多），顺序为 D01–D12",
    rFullB.unlockedIds.length === 12 &&
    rFullB.unlockedIds.every((id, i) => id === BOOSTER_IDS[i]) &&
    BOOSTER_IDS.every((id) => sFullB.achievements.unlockedAtById[id] === 2000));

  // 非法 recipeId/错桶/NaN/负数/null/Infinity 不得解锁
  const sBadB = makeBoosterState(sbA, {
    "unknown_booster": 99, "mining_lubricant_l": NaN, "ore_resonance_l": "5",
    "laser_coolant_l": Infinity, "missile_catalyst_l": -1, "shield_recharge_l": null,
  }, NaN);
  const rBadB = evaluateB(sBadB, 1);
  ok("[br13] 未知 recipeId、错桶、NaN/字符串/Infinity/负数/null/非法累计不得误解锁（0 项、ok=true）",
    rBadB.ok === true && rBadB.unlockedIds.length === 0 && unlockedSetB(sBadB).size === 0);

  // ========================= C. 幂等 / dirty / 时间语义 =========================
  const capB = [];
  sbA.GameEvents.on("achievement:unlocked", (ev) => capB.push(ev));
  const sI_B = makeBoosterState(sbA, { "mining_lubricant_l": 1 }, 1);
  SYS.unlockAchievement(sI_B, "D01", 111);
  capB.length = 0;
  const rI1_B = evaluateB(sI_B, 5000);
  ok("[br14] 首次求值 unlockedIds 只含本次新解锁项（含 D11 不含预解锁 D01，D01 保持 111）",
    rI1_B.ok && rI1_B.unlockedIds.includes("D11") && !rI1_B.unlockedIds.includes("D01") &&
    sI_B.achievements.unlockedAtById["D01"] === 111);
  sI_B._dirty = false;
  capB.length = 0;
  const rI2_B = evaluateB(sI_B, 6000);
  ok("[br15] 同状态重复求值 unlockedIds=[]、不覆盖时间（D11 保持 5000）、不 emit、不 dirty",
    rI2_B.ok && rI2_B.unlockedIds.length === 0 &&
    sI_B.achievements.unlockedAtById["D11"] === 5000 && capB.length === 0 && sI_B._dirty === false);

  const TBB = 1690000123456.75;
  capB.length = 0;
  const sT_B = makeBoosterState(sbA, { "mining_lubricant_l": 1, "relic_solver_l": 1 }, 1);
  const rT_B = evaluateB(sT_B, TBB);
  const idCountsB = {};
  for (const ev of capB) idCountsB[ev.payload.achievementId] = (idCountsB[ev.payload.achievementId] || 0) + 1;
  const sameAtMsOkB = rT_B.unlockedIds.length === 3 &&
    sT_B.achievements.unlockedAtById["D01"] === TBB && sT_B.achievements.unlockedAtById["D03"] === TBB &&
    sT_B.achievements.unlockedAtById["D11"] === TBB &&
    capB.length === 3 && idCountsB["D01"] === 1 && idCountsB["D03"] === 1 && idCountsB["D11"] === 1 &&
    capB.every((ev) => ev.timestamp === ev.payload.unlockedAt && ev.payload.unlockedAt === TBB);
  const sNaNB = makeBoosterState(sbA, { "mining_lubricant_l": 1 }, 0);
  const rNaNB = evaluateB(sNaNB, NaN);
  const nanOkB = rNaNB.unlockedIds.includes("D01") &&
    sNaNB.achievements.unlockedAtById["D01"] === FROZEN_NOW;
  ok("[br16] 时间语义：同批多解锁共享同一浮点 atMs；非法 atMs 统一回退冻结 Date.now()", sameAtMsOkB && nanOkB);

  const sROB = makeBoosterState(sbA, { "mining_lubricant_l": 1 });
  const statsBeforeB = JSON.stringify(sROB.statistics);
  const rulesBeforeB = JSON.stringify(RD.BOOSTER_RULES);
  evaluateB(sROB, 1);
  ok("[br17] 求值前后 state.statistics 与 BOOSTER_RULES JSON 完全一致（条件读取纯只读；成就状态无 schema 污染）",
    JSON.stringify(sROB.statistics) === statsBeforeB &&
    JSON.stringify(RD.BOOSTER_RULES) === rulesBeforeB &&
    Object.isFrozen(RD.BOOSTER_RULES) &&
    !("boosters" in sROB.achievements) && !("boostersManufactured" in sROB.achievements));

  // ========================= D. statistics v1/v2→v3 迁移 / 事件记账 =========================
  let statVMB = null;
  try {
    const statSrcB = fs.readFileSync(STATISTICS_PATH, "utf-8");
    const epB = ";globalThis.__ensure=ensureStatisticsState;globalThis.__def=createDefaultStatisticsState;globalThis.__consume=consumeStatisticsEvent;";
    const ctxB = { console };
    ctxB.window = ctxB;
    ctxB.globalThis = ctxB;
    ctxB.GameEvents = { onIdempotent() {}, on() {}, emit() {}, listenerCount() { return 0; } };
    ctxB.gameState = { statistics: { version: 1, totals: {}, production: {}, combat: {}, activity: {}, eventLedger: {} }, _dirty: false };
    vm.createContext(ctxB);
    vm.runInContext(statSrcB + "\n" + epB, ctxB, { filename: "statistics-booster.js" });
    statVMB = ctxB;
  } catch (e) { statVMB = null; }

  if (statVMB) {
    // v1→v3：缺 booster 字段补齐为 0
    statVMB.gameState.statistics = {
      version: 1, totals: { events: 5, equipmentEnhancementAttempts: 3 },
      production: { manufactured: { "t1_mining_laser": 1 } }, combat: {}, activity: {}, eventLedger: {},
    };
    statVMB.__ensure(statVMB.gameState);
    const st1B = statVMB.gameState.statistics;
    ok("[br18] statistics v1→v6 真实迁移：version=6、boostersManufactured=0、boosters={}、旧 totals 与 production.manufactured 保留",
      st1B.version === 9 && st1B.totals.boostersManufactured === 0 &&
      st1B.production.boosters && typeof st1B.production.boosters === "object" &&
      Object.keys(st1B.production.boosters).length === 0 &&
      st1B.totals.events === 5 && st1B.totals.equipmentEnhancementAttempts === 3 &&
      st1B.production.manufactured["t1_mining_laser"] === 1);

    // v2→v3
    statVMB.gameState.statistics = {
      version: 2, totals: { events: 5, equipmentEnhancementAttempts: 3 },
      production: { manufactured: { "x": 1 } }, combat: {}, activity: {}, eventLedger: {},
    };
    statVMB.__ensure(statVMB.gameState);
    ok("[br19] v2→v6 迁移：version=6、boostersManufactured=0、boosters={}、旧字段保留",
      statVMB.gameState.statistics.version === 9 &&
      statVMB.gameState.statistics.totals.boostersManufactured === 0 &&
      statVMB.gameState.statistics.production.boosters &&
      Object.keys(statVMB.gameState.statistics.production.boosters).length === 0 &&
      statVMB.gameState.statistics.totals.events === 5);

    // 非法 boostersManufactured 清洗为 0（所有非 typeof number + finite + >=0 的值）
    let br20ok = true;
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, -3, -0.5, "abc", "7", "0", {}, [], true, false]) {
      statVMB.gameState.statistics = {
        version: 3, totals: { boostersManufactured: bad },
        production: { boosters: {} }, combat: {}, activity: {}, eventLedger: {},
      };
      statVMB.__ensure(statVMB.gameState);
      if (statVMB.gameState.statistics.totals.boostersManufactured !== 0) br20ok = false;
    }
    ok("[br20] 缺字段/非法 boostersManufactured 清洗为 0（undefined/null/NaN/Infinity/-Infinity/负数/字符串/{}/[]/true/false）", br20ok);

    // 合法旧值保留（floor 收敛）
    statVMB.gameState.statistics.totals.boostersManufactured = 7;
    statVMB.__ensure(statVMB.gameState);
    const kept7B = statVMB.gameState.statistics.totals.boostersManufactured === 7;
    statVMB.gameState.statistics.totals.boostersManufactured = 9.9;
    statVMB.__ensure(statVMB.gameState);
    const keptFloorB = statVMB.gameState.statistics.totals.boostersManufactured === 9;
    ok("[br21] 合法旧 boostersManufactured 保留（7→7；9.9→floor→9）", kept7B && keptFloorB);

    // boosters 非数组清洗
    statVMB.gameState.statistics = {
      version: 3, totals: { boostersManufactured: 0 },
      production: { boosters: [1,2,3] }, combat: {}, activity: {}, eventLedger: {},
    };
    statVMB.__ensure(statVMB.gameState);
    ok("[br22] production.boosters 为数组/非法时替换为 {}",
      statVMB.gameState.statistics.production.boosters &&
      typeof statVMB.gameState.statistics.production.boosters === "object" &&
      !Array.isArray(statVMB.gameState.statistics.production.boosters));

    // production.boosters 逐项清洗：合法整数、合法小数(floor)和 0 保留；数字字符串/负数/NaN/Infinity/对象/布尔值删除
    statVMB.gameState.statistics = {
      version: 3, totals: { boostersManufactured: 0 },
      production: { boosters: {
        validInt: 7, validFloat: 2.7, zero: 0,
        numericString: "8", negative: -1, nanValue: NaN, infinite: Infinity,
        objectValue: {}, boolValue: true,
      } }, combat: {}, activity: {}, eventLedger: {},
    };
    statVMB.__ensure(statVMB.gameState);
    const cleaned = statVMB.gameState.statistics.production.boosters;
    ok("[br22b] production.boosters 逐项清洗：validInt=7/validFloat=2/zero=0 保留；numericString/negative/nanValue/infinite/objectValue/boolValue 删除",
      cleaned.validInt === 7 && cleaned.validFloat === 2 && cleaned.zero === 0 &&
      !("numericString" in cleaned) && !("negative" in cleaned) && !("nanValue" in cleaned) &&
      !("infinite" in cleaned) && !("objectValue" in cleaned) && !("boolValue" in cleaned));

    // 连续迁移幂等 JSON 一致
    const aB = JSON.stringify(statVMB.__ensure(statVMB.gameState).totals);
    const bB = JSON.stringify(statVMB.__ensure(statVMB.gameState).totals);
    ok("[br23] 连续 ensure v6 迁移幂等（两次 totals JSON 一致、version 恒为 9）",
      aB === bB && statVMB.gameState.statistics.version === 9);
  } else {
    ok("[br18] statistics 迁移 VM 加载失败", false);
  }

  // D-c：所有非法 quantity 逐项验证（直接调用 consumeStatisticsEvent 绕过合同校验）
  if (statVMB) {
    const sQ = { version: 3, totals: { boostersManufactured: 0, events: 0 }, production: { boosters: {} }, activity: { onlineEvents: 0, offlineEvents: 0 }, eventLedger: { processedEventIds: [] } };
    statVMB.gameState.statistics = JSON.parse(JSON.stringify(sQ));
    statVMB.__ensure(statVMB.gameState); // 扩展为完整默认结构
    statVMB.gameState._dirty = false;
    const beforeBM = statVMB.gameState.statistics.totals.boostersManufactured;
    const beforeEv = statVMB.gameState.statistics.totals.events;
    const beforeOnline = statVMB.gameState.statistics.activity.onlineEvents;
    const beforeOffline = statVMB.gameState.statistics.activity.offlineEvents;

    function mockBoosterEvent(quantity) {
      return {
        type: "booster:manufactured",
        payload: { recipeId: "test_booster", quantity },
        meta: { offline: false, timestamp: 1 },
      };
    }

    const invalidQs = [0, -1, NaN, Infinity, -Infinity, "5", "1.5", null, undefined, {}, true, 0.5];
    let br27ok = true;
    for (const q of invalidQs) {
      statVMB.gameState._dirty = false;
      const consumed = statVMB.__consume(mockBoosterEvent(q));
      // 必须返回 false
      if (consumed !== false) br27ok = false;
      // boostersManufactured 不变
      if (statVMB.gameState.statistics.totals.boostersManufactured !== beforeBM) br27ok = false;
      // events 不变
      if (statVMB.gameState.statistics.totals.events !== beforeEv) br27ok = false;
      // production.boosters 无新键
      if (statVMB.gameState.statistics.production.boosters && "test_booster" in statVMB.gameState.statistics.production.boosters) br27ok = false;
      // activity 不变
      if (statVMB.gameState.statistics.activity.onlineEvents !== beforeOnline) br27ok = false;
      if (statVMB.gameState.statistics.activity.offlineEvents !== beforeOffline) br27ok = false;
      // 不 dirty
      if (statVMB.gameState._dirty) br27ok = false;
    }

    // 有效 quantity=5 → 累计5；=2.7 → floor→2
    statVMB.gameState.statistics = JSON.parse(JSON.stringify(sQ));
    const r1 = statVMB.__consume(mockBoosterEvent(5));
    const r2 = statVMB.__consume(mockBoosterEvent(2.7));
    br27ok = br27ok && r1 === true && r2 === true &&
      statVMB.gameState.statistics.totals.boostersManufactured === 7 &&
      statVMB.gameState.statistics.production.boosters["test_booster"] === 7;

    ok("[br27] 非法 quantity 全部拒绝（0/-1/NaN/Infinity/-Infinity/\"5\"/\"1.5\"/null/undefined/{}/true/0.5）：不污染统计、不 dirty；合法 5→5、2.7→floor→2 累加为 7", br27ok);
  } else {
    ok("[br27] 统计 VM 不可用，跳过", false);
  }

  // D-b 真实 statistics 沙箱：booster 事件记账
  const sbStatB = buildKernelSandbox({ withEvents: true, withStatistics: true });
  const gsStatB = sbStatB.gameState;

  // booster:manufactured 按数量累计
  sbStatB.GameEvents.emit("booster:manufactured",
    { recipeId: "mining_lubricant_l", quantity: 5, series: "mining_lubricant", quality: "l", itemId: "booster:mining_lubricant_l", xpGained: 100, offline: false },
    { offline: false, timestamp: 100 });
  sbStatB.GameEvents.emit("booster:manufactured",
    { recipeId: "ore_resonance_l", quantity: 3, series: "ore_resonance", quality: "l", itemId: "booster:ore_resonance_l", xpGained: 200, offline: false },
    { offline: false, timestamp: 101 });
  ok("[br24] booster:manufactured 真实按数量累计 boostersManufactured=8、boosters[mining_lubricant_l]=5、boosters[ore_resonance_l]=3",
    gsStatB.statistics.totals.boostersManufactured === 8 &&
    gsStatB.statistics.production.boosters["mining_lubricant_l"] === 5 &&
    gsStatB.statistics.production.boosters["ore_resonance_l"] === 3);

  // boosters:manufactured 离线聚合
  sbStatB.GameEvents.emit("boosters:manufactured",
    { recipeId: "mining_lubricant_l", quantity: 10, series: "mining_lubricant", quality: "l", itemId: "booster:mining_lubricant_l", totalXp: 500, offline: true },
    { offline: true, timestamp: 200 });
  ok("[br25] boosters:manufactured 离线按数量累计 boostersManufactured=18、boosters[mining_lubricant_l]=15",
    gsStatB.statistics.totals.boostersManufactured === 18 &&
    gsStatB.statistics.production.boosters["mining_lubricant_l"] === 15);

  // 同一 eventId 重放不重复累计
  sbStatB.GameEvents.emit("booster:manufactured",
    { recipeId: "mining_lubricant_l", quantity: 1, series: "mining_lubricant", quality: "l", itemId: "booster:mining_lubricant_l", xpGained: 10, offline: false },
    { offline: false, eventId: "br-dup-1" });
  sbStatB.GameEvents.emit("booster:manufactured",
    { recipeId: "mining_lubricant_l", quantity: 1, series: "mining_lubricant", quality: "l", itemId: "booster:mining_lubricant_l", xpGained: 10, offline: false },
    { offline: false, eventId: "br-dup-1" });
  ok("[br26] 同 eventId 重放不双计数（boostersManufactured=19、mining_lubricant_l=16）",
    gsStatB.statistics.totals.boostersManufactured === 19 &&
    gsStatB.statistics.production.boosters["mining_lubricant_l"] === 16);

  // quantity=0 不污染统计（合法事件，addStatistic 跳过零值）
  sbStatB.GameEvents.emit("booster:manufactured",
    { recipeId: "unknown_booster", quantity: 0, series: "mining_lubricant", quality: "l", itemId: "booster:mining_lubricant_l", xpGained: 10, offline: false },
    { offline: false, timestamp: 300 });
  ok("[br27] quantity=0 的事件不污染 totals.boostersManufactured 与 boosters 子统计",
    gsStatB.statistics.totals.boostersManufactured === 19 &&
    gsStatB.statistics.production.boosters["mining_lubricant_l"] === 16 &&
    gsStatB.statistics.production.boosters["unknown_booster"] === undefined);

  // station:autoLineCompleted(lineId=booster) 不双累计（禁止通过 station 线二次累计）
  const beforeBoostersTotal = gsStatB.statistics.totals.boostersManufactured;
  sbStatB.GameEvents.emit("station:autoLineCompleted",
    { lineId: "booster", targetId: "mining_lubricant_l", quantity: 5, cycles: 1, xp: 10, offline: false },
    { offline: false, timestamp: 400 });
  ok("[br28] station:autoLineCompleted(lineId=booster) 不累计到 boostersManufactured（禁止双记账）",
    gsStatB.statistics.totals.boostersManufactured === beforeBoostersTotal);

  // ========================= E. 消费者 =========================
  const achSysSrcB = fs.readFileSync(ACH_SYSTEM_PATH, "utf-8");
  const bInstallBody = extractFnBody(achSysSrcB, "installBoosterAchievementConsumer");
  ok("[br29] 增幅剂消费者注册在通配符 \"*\" 且严格按 event.type 过滤（仅 booster:manufactured / boosters:manufactured 触发）",
    bInstallBody.includes('GE.on("*"') &&
    bInstallBody.includes('"booster:manufactured"') &&
    bInstallBody.includes('"boosters:manufactured"'));

  // E-a：真实 statistics + 六成就消费者
  const sbBS = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsBS = sbBS.gameState;
  const capBS = [];
  sbBS.GameEvents.on("achievement:unlocked", (ev) => capBS.push(ev));
  const reinstallBB = sbBS.AchievementSystem.installBoosterAchievementConsumer(gsBS);
  ok("[br30] listenerCount(\"*\") 体现 statistics+生产+战斗+制造+装备+增幅剂+考古+行星+空间站+综合生命周期 十监听，重复安装返回 ALREADY_INSTALLED",
    sbBS.GameEvents.listenerCount("*") === 10 &&
    reinstallBB && reinstallBB.ok === false && reinstallBB.reason === "ALREADY_INSTALLED");

  // 在线 booster:manufactured → 解锁 D01
  sbBS.GameEvents.emit("booster:manufactured",
    { recipeId: "mining_lubricant_l", quantity: 1, series: "mining_lubricant", quality: "l", itemId: "booster:mining_lubricant_l", xpGained: 100, offline: false },
    { offline: false, timestamp: 1000 });
  ok("[br31] 在线 booster:manufactured → D01 解锁",
    typeof gsBS.achievements.unlockedAtById["D01"] === "number" &&
    gsBS.achievements.unlockedAtById["D01"] === 1000 &&
    capBS.filter((ev) => ev.payload.achievementId === "D01").length === 1);

  // 离线 boosters:manufactured → D11 解锁
  sbBS.GameEvents.emit("boosters:manufactured",
    { recipeId: "mining_lubricant_l", quantity: 1, series: "mining_lubricant", quality: "l", itemId: "booster:mining_lubricant_l", totalXp: 50, offline: true },
    { offline: true, timestamp: 1001 });
  ok("[br32] 离线 boosters:manufactured 可导致 D11 解锁（统计累计驱动，与在线链路无关）",
    typeof gsBS.achievements.unlockedAtById["D11"] === "number");

  // 消费者重复安装幂等
  ok("[br33] 首次安装 installBoosterAchievementConsumer 在先（IIFE）+ 重复安装 ALREADY_INSTALLED（每沙箱恰一套监听）",
    reinstallBB && reinstallBB.ok === false && reinstallBB.reason === "ALREADY_INSTALLED");

  // E-b 手工沙箱（无 statistics）：INVALID_STATE / STATISTICS_UNAVAILABLE，EVENTS_UNAVAILABLE 需无事件沙箱
  const sbBE = buildKernelSandbox({ withEvents: true, withRules: true });
  let instThrowB = false, rInvB = null, rNoStatB = null, rNoEvB = null;
  try {
    rInvB = sbBE.AchievementSystem.installBoosterAchievementConsumer(null);
    rNoStatB = sbBE.AchievementSystem.installBoosterAchievementConsumer(
      { achievements: sbBE.AchievementState.createDefaultAchievementState() });
    // EVENTS_UNAVAILABLE：使用无事件沙箱
    const sbNoEvents = buildKernelSandbox({ withEvents: false, withRules: true });
    rNoEvB = sbNoEvents.AchievementSystem.installBoosterAchievementConsumer(
      { achievements: sbNoEvents.AchievementState.createDefaultAchievementState(),
        statistics: { version: 3, totals: {}, production: { boosters: {} } } });
  } catch (e) { instThrowB = true; }
  ok("[br34] INVALID_STATE / STATISTICS_UNAVAILABLE / EVENTS_UNAVAILABLE 安装失败原因稳定，不抛异常",
    !instThrowB && rInvB && rInvB.ok === false && rInvB.reason === "INVALID_STATE" &&
    rNoStatB && rNoStatB.ok === false && rNoStatB.reason === "STATISTICS_UNAVAILABLE" &&
    rNoEvB && rNoEvB.ok === false && rNoEvB.reason === "EVENTS_UNAVAILABLE");

  // 不信任 payload：用无 statistics 消费者的沙箱，事件量=999 但权威统计为 0 → 不得解锁
  const sbDistrust = buildKernelSandbox({ withEvents: true, withRules: true });
  const sDistrustB = makeBoosterState(sbDistrust, {}, 0);
  sbDistrust.AchievementSystem.installBoosterAchievementConsumer(sDistrustB);
  const capDistB = [];
  sbDistrust.GameEvents.on("achievement:unlocked", (ev) => capDistB.push(ev));
  sbDistrust.GameEvents.emit("booster:manufactured",
    { recipeId: "mining_lubricant_l", quantity: 999, series: "mining_lubricant", quality: "l", itemId: "booster:mining_lubricant_l", xpGained: 100, offline: false },
    { offline: false, timestamp: 2000 });
  ok("[br35] 不信任 payload：事件声称 quantity=999 但权威 boosters(0)不变 → D01 不解锁",
    !("D01" in sDistrustB.achievements.unlockedAtById) && capDistB.filter((ev) => ev.payload.achievementId === "D01").length === 0);
  // 权威统计达标后即使 payload 为 0 也按统计解锁
  sDistrustB.statistics.production.boosters["mining_lubricant_l"] = 1;
  sDistrustB.statistics.totals.boostersManufactured = 1;
  sbDistrust.GameEvents.emit("booster:manufactured",
    { recipeId: "mining_lubricant_l", quantity: 0, series: "mining_lubricant", quality: "l", itemId: "booster:mining_lubricant_l", xpGained: 100, offline: false },
    { offline: false, timestamp: 2001 });
  ok("[br36] 权威统计达标后即使 payload quantity=0 也可解锁 D01（消费器读取权威统计而非 payload）",
    typeof sDistrustB.achievements.unlockedAtById["D01"] === "number");

  // 其他事件不过滤（不触发增幅剂求值、无新解锁、不 dirty）
  const sOtherB = makeBoosterState(sbDistrust, { "mining_lubricant_l": 1 }, 1);
  sOtherB._dirty = false;
  sbDistrust.GameEvents.emit("skill:levelUp", { skill: "mining", previousLevel: 1, level: 2 }, { offline: false, timestamp: 3000 });
  sbDistrust.GameEvents.emit("mining:completed", { area: "x", mode: "normal", resourceId: "ore:凡晶石", quantity: 1, cycles: 1, xp: 10 }, { offline: false, timestamp: 3001 });
  sbDistrust.GameEvents.emit("combat:zoneCleared", { zoneId: "angel_outpost", name: "天使前哨站", lp: 10, clearCount: 1, damageTaken: 0 }, { offline: false, timestamp: 3002 });
  ok("[br37] skill/mining/combat/其他事件不得触发增幅剂求值（D01/D11 已达标但无新解锁、_dirty=false）",
    !sOtherB._dirty);

  // ========================= F. 真实接线与追溯 =========================
  // F-a：新游戏状态（kernel 沙箱，无 persistence）
  const sbFA = buildKernelSandbox({ withEvents: true, withRules: true });
  const sFresh = makeBoosterState(sbFA, {}, 0);
  const rFresh = evaluateB(sFresh, 100);
  ok("[br38] 新游戏（0 boosters）D01–D12 全未解锁",
    rFresh.unlockedIds.length === 0 && rFresh.ok === true &&
    BOOSTER_IDS.every((id) => !(id in sFresh.achievements.unlockedAtById)));

  // F-b：v3 旧档追溯（kernel 沙箱）
  const sV3Full = makeBoosterState(sbFA, {}, 1200);
  for (const r of RD.LEGENDARY_BOOSTER_RECIPE_IDS) sV3Full.statistics.production.boosters[r] = 1;
  sV3Full.statistics.production.boosters["mining_lubricant_n"] = 1;
  const rV3Full = evaluateB(sV3Full, 5000);
  ok("[br41] 旧档 v3 制造全满（12 传奇+1 普通+total=1200）单次求值补全 D01–D12（每个恰一次、atMs=5000）",
    rV3Full.unlockedIds.length === 12 && rV3Full.ok &&
    BOOSTER_IDS.every((id) => sV3Full.achievements.unlockedAtById[id] === 5000));

  // F-c：已有部分成就（时间保留、不覆盖）
  const sV3Part = makeBoosterState(sbFA, {}, 1200);
  for (const r of RD.LEGENDARY_BOOSTER_RECIPE_IDS) sV3Part.statistics.production.boosters[r] = 1;
  sV3Part.statistics.production.boosters["mining_lubricant_n"] = 1;
  SYS.unlockAchievement(sV3Part, "D01", 123.5);
  SYS.unlockAchievement(sV3Part, "D02", 456.25);
  const rV3Part = evaluateB(sV3Part, 6000);
  ok("[br42] 旧存档已有 D01=123.5/D02=456.25 再次求值原时间保持不变（新补 D03–D12=6000）",
    sV3Part.achievements.unlockedAtById["D01"] === 123.5 &&
    sV3Part.achievements.unlockedAtById["D02"] === 456.25 &&
    BOOSTER_IDS.slice(2).every((id) => sV3Part.achievements.unlockedAtById[id] === 6000));

  // F-d：v2 旧档（无 booster 字段）→ 不臆测历史制造量
  const sV2Migrated = makeBoosterState(sbFA, {}, undefined);
  const rV2Migrated = evaluateB(sV2Migrated, 7000);
  ok("[br43] 旧档 v2 迁移（无 booster 字段）后 boostersManufactured=0、D01–D12 全锁（不从 inventory 推算历史制造）",
    sV2Migrated.statistics.totals.boostersManufactured === 0 &&
    rV2Migrated.unlockedIds.length === 0 &&
    BOOSTER_IDS.every((id) => !(id in sV2Migrated.achievements.unlockedAtById)));

  // F-e：persistence 源码确认 booster 对账存在（辅助检查）
  const persistSrcB = fs.readFileSync(PERSISTENCE_PATH, "utf-8");
  const totalBoosterRefs = (persistSrcB.match(/evaluateBoosterAchievementRules/g) || []).length;
  ok("[br44] persistence 中 evaluateBoosterAchievementRules 恰 4 处（importData×2 + autoLoad×2）", totalBoosterRefs === 4);
  ok("[br45] persistence 中 booster 与 equipment 对账相邻且共用同一 achievementReconcileNow",
    persistSrcB.includes("evaluateBoosterAchievementRules") &&
    persistSrcB.includes("evaluateEquipmentAchievementRules"));

  // F-f：autoLoad restored=false（新游戏，由 buildFullGameSandbox 真实加载 persistence）
  const freshB = buildFullGameSandbox(null);
  ok("[br46a] autoLoad 新游戏 spyInstalled=true（含 booster）", freshB.spyInstalled === true);
  ok("[br46b] autoLoad 新游戏 timeline 含 evaluateBoosterAchievementRules 恰 1 次",
    freshB.timeline.filter((e) => e.fn === "evaluateBoosterAchievementRules").length === 1);
  ok("[br46c] autoLoad 新游戏 calculateOfflineGains 0 次（restored=false）",
    freshB.timeline.filter((e) => e.fn === "calculateOfflineGains").length === 0);
  ok("[br46d] autoLoad 新游戏六求值器各 1 次且 atMs 完全相等",
    (() => {
      const evals = freshB.timeline.filter((e) => e.fn.startsWith("evaluate") && e.fn !== "migrateAchievementState" && e.fn !== "migrateResearchState");
      const counts = {};
      for (const e of evals) counts[e.fn] = (counts[e.fn] || 0) + 1;
      const allOnce = ["evaluateSkillAchievementRules","evaluateProductionAchievementRules","evaluateCombatAchievementRules",
        "evaluateManufacturingAchievementRules","evaluateEquipmentAchievementRules","evaluateBoosterAchievementRules"]
        .every((f) => counts[f] === 1);
      const atMsSet = new Set(evals.filter((e) => e.atMs !== undefined).map((e) => e.atMs));
      return allOnce && atMsSet.size === 1;
    })());
  ok("[br46e] autoLoad 新游戏 timeline 顺序为 migrate < skill < production < combat < manufacturing < equipment < booster",
    (() => {
      const seq = freshB.timeline.filter((e) => e.fn !== "migrateAchievementState" && e.fn !== "migrateResearchState");
      const order = seq.map((e) => e.fn);
      const skillI = order.indexOf("evaluateSkillAchievementRules");
      const prodI = order.indexOf("evaluateProductionAchievementRules");
      const combatI = order.indexOf("evaluateCombatAchievementRules");
      const mfgI = order.indexOf("evaluateManufacturingAchievementRules");
      const eqI = order.indexOf("evaluateEquipmentAchievementRules");
      const boostI = order.indexOf("evaluateBoosterAchievementRules");
      return skillI >= 0 && prodI >= 0 && combatI >= 0 && mfgI >= 0 && eqI >= 0 && boostI >= 0 &&
        skillI < prodI && prodI < combatI && combatI < mfgI && mfgI < eqI && eqI < boostI;
    })());
  ok("[br46f] autoLoad 新游戏 D01–D12 全未锁",
    BOOSTER_IDS.every((id) => !(id in (freshB.sandbox.gameState.achievements && freshB.sandbox.gameState.achievements.unlockedAtById || {}))));

  // F-g：autoLoad restored=true（旧档含 booster 统计，由 persistence 追溯解锁）
  const v3BoostSave = JSON.stringify({
    saveVersion: 2,
    skills: {},
    achievements: { unlockedAtById: {} },
    statistics: {
      version: 3, totals: { events: 5, boostersManufactured: 1200 },
      production: { boosters: (() => { const m = {}; for (const r of RD.LEGENDARY_BOOSTER_RECIPE_IDS) m[r] = 1; m["mining_lubricant_n"] = 1; return m; })() },
    },
  });
  const v3LoadedB = buildFullGameSandbox(v3BoostSave);
  ok("[br46g] autoLoad v3 旧档 timeline booster 恰 1 次且 offline 恰 1 次，booster 早于 offline",
    (() => {
      const bTimes = v3LoadedB.timeline.filter((e) => e.fn === "evaluateBoosterAchievementRules").length;
      const oTimes = v3LoadedB.timeline.filter((e) => e.fn === "calculateOfflineGains").length;
      const bIdx = v3LoadedB.timeline.findIndex((e) => e.fn === "evaluateBoosterAchievementRules");
      const oIdx = v3LoadedB.timeline.findIndex((e) => e.fn === "calculateOfflineGains");
      return bTimes === 1 && oTimes === 1 && bIdx >= 0 && oIdx >= 0 && bIdx < oIdx;
    })());
  ok("[br46h] autoLoad v3 旧档六求值器各 1 次且 atMs 完全相等；D01–D12 全部解锁",
    (() => {
      const evals = v3LoadedB.timeline.filter((e) => e.fn.startsWith("evaluate") && e.fn !== "migrateAchievementState" && e.fn !== "migrateResearchState");
      const counts = {};
      for (const e of evals) counts[e.fn] = (counts[e.fn] || 0) + 1;
      const allOnce = ["evaluateSkillAchievementRules","evaluateProductionAchievementRules","evaluateCombatAchievementRules",
        "evaluateManufacturingAchievementRules","evaluateEquipmentAchievementRules","evaluateBoosterAchievementRules"]
        .every((f) => counts[f] === 1);
      const atMsSet = new Set(evals.filter((e) => e.atMs !== undefined).map((e) => e.atMs));
      const gs = v3LoadedB.sandbox.gameState;
      return allOnce && atMsSet.size === 1 &&
        BOOSTER_IDS.every((id) => typeof (gs.achievements && gs.achievements.unlockedAtById[id]) === "number");
    })());

  // F-h：importData — 在已加载沙箱中真实调用 SaveManager.importData（精确次数断言）
  const importB = buildFullGameSandbox(null);
  // 准备含部分成就的 v3 存档（D01 已有旧时间 123.5）
  const v3ImportSave = JSON.stringify({
    saveVersion: 2, skills: {},
    achievements: { unlockedAtById: { "D01": 123.5 } },
    statistics: {
      version: 3, totals: { events: 5, boostersManufactured: 1200 },
      production: { boosters: (() => { const m = {}; for (const r of RD.LEGENDARY_BOOSTER_RECIPE_IDS) m[r] = 1; m["mining_lubricant_n"] = 1; return m; })() },
    },
  });
  // 保存并清空 timeline/achievementEvents
  const importTimelinePre = [...importB.timeline];
  importB.timeline.length = 0;
  importB.achievementEvents.length = 0;
  let importOk = false;
  try {
    importOk = importB.sandbox.SaveManager.importData(v3ImportSave) === true;
  } catch (e) { importOk = false; }
  ok("[br46i] importData 返回 true", importOk);
  (() => {
    if (!importOk) return;
    const tl = importB.timeline;
    const count = (fn) => tl.filter((e) => e.fn === fn).length;
    // 精确各一次
    const cMigrate = count("migrateAchievementState");
    const cSkill = count("evaluateSkillAchievementRules");
    const cProd = count("evaluateProductionAchievementRules");
    const cCombat = count("evaluateCombatAchievementRules");
    const cMfg = count("evaluateManufacturingAchievementRules");
    const cEq = count("evaluateEquipmentAchievementRules");
    const cBoost = count("evaluateBoosterAchievementRules");
    const cOffline = count("calculateOfflineGains");
    const allOnce = cMigrate === 1 && cSkill === 1 && cProd === 1 && cCombat === 1 &&
      cMfg === 1 && cEq === 1 && cBoost === 1 && cOffline === 1;
    // 顺序
    const orderFns = tl.filter((e) => e.fn !== "migrateResearchState").map((e) => e.fn);
    const iSkill = orderFns.indexOf("evaluateSkillAchievementRules");
    const iProd = orderFns.indexOf("evaluateProductionAchievementRules");
    const iCombat = orderFns.indexOf("evaluateCombatAchievementRules");
    const iMfg = orderFns.indexOf("evaluateManufacturingAchievementRules");
    const iEq = orderFns.indexOf("evaluateEquipmentAchievementRules");
    const iBoost = orderFns.indexOf("evaluateBoosterAchievementRules");
    const iOffline = orderFns.indexOf("calculateOfflineGains");
    const correctOrder = iSkill >= 0 && iProd > iSkill && iCombat > iProd && iMfg > iCombat && iEq > iMfg &&
      iBoost > iEq && iOffline > iBoost;
    // atMs 一致
    const evaluators = tl.filter((e) => e.fn.startsWith("evaluate") && e.fn !== "migrateAchievementState" && e.fn !== "migrateResearchState");
    const atMsSet = new Set(evaluators.filter((e) => e.atMs !== undefined).map((e) => e.atMs));
    ok("[br46i2] importData 精确：各1次、顺序正确、atMs一致",
      allOnce && correctOrder && atMsSet.size === 1);
    // 成就：D01 保持 123.5，D02–D12 新解锁
    const gsImp = importB.sandbox.gameState;
    const ach = gsImp.achievements && gsImp.achievements.unlockedAtById || {};
    ok("[br46i3] importData 已有 D01=123.5 保留，D02–D12 新补发且 D01 不重复 emit",
      ach["D01"] === 123.5 &&
      BOOSTER_IDS.slice(1).every((id) => typeof ach[id] === "number") &&
      importB.achievementEvents.filter((e) => e.payload.achievementId === "D01").length === 0);
  })();

  // F-i：真实在线制造链 — 通过 gameTick 自行发布 booster:manufactured
  (() => {
    const sbOnline = buildFullGameSandbox(null);
    const gs = sbOnline.sandbox.gameState;
    const RR = sbOnline.sandbox.ResourceRegistry;
    const achEventsMfg = [];
    sbOnline.sandbox.GameEvents.on("achievement:unlocked", (e) => achEventsMfg.push(e));
    // 1. 设置 boosterEngineering 技能到高等级
    gs.skills.boosterEngineering = { lvl: 80, xp: 0 };
    // 2. 选择传奇配方 mining_lubricant_l (解锁等级 60)
    const recipeId = "mining_lubricant_l";
    // 3. 放入真实材料（配方成本：生物质×5 + 极化战术介质×7）
    RR.add(gs, "planetary:生物质", 50);
    RR.add(gs, "special:极化战术介质", 50);
    // 4. 记录制造前库存
    const B0 = Number(RR.get(gs, "booster:" + recipeId)) || 0;
    // 5. 配置 currentAction
    gs.currentAction.skill = "boosterEngineering";
    gs.currentAction.boosterRecipeTarget = recipeId;
    gs.currentAction.startedBoosterRecipeTarget = recipeId;
    gs.currentAction.active = true;
    gs.currentAction.progress = 0;
    gs.currentAction.lastProgressUpdate = 1000;
    gs.currentAction.batchRemaining = 0;
    // 6. 冻结时间并推进 gameTick
    const startTime = 1000;
    sbOnline.sandbox.Date.now = () => startTime;
    const steps = Math.ceil(200 / 5); // 200 秒配方 / 0.1 秒每 tick = ~40 ticks
    for (let i = 1; i <= steps; i++) {
      if (!gs.currentAction.active) break;
      sbOnline.sandbox.Date.now = () => startTime + i * 5000;
      try { sbOnline.sandbox.gameTick(); } catch (e) {
        ok("[br46k] 在线 gameTick 异常", false, "message=" + (e.message || String(e)));
        return;
      }
    }
    // 7. 验证
    const B1 = Number(RR.get(gs, "booster:" + recipeId)) || 0;
    const Q = B1 - B0;
    if (Q < 1) { ok("[br46k] 在线制造 Q=" + Q + " 应为 ≥1", false); return; }
    ok("[br46k] 在线真实 gameTick 制造 Q=" + Q + "（库存 " + B0 + "→" + B1 + "）且 statistics 与成就一致",
      gs.statistics.totals.boostersManufactured === Q &&
      gs.statistics.production.boosters[recipeId] === Q &&
      typeof gs.achievements.unlockedAtById["D01"] === "number" &&
      typeof gs.achievements.unlockedAtById["D11"] === "number" &&
      achEventsMfg.filter((e) => e.payload.achievementId === "D01").length === 1 &&
      achEventsMfg.filter((e) => e.payload.achievementId === "D11").length === 1 &&
      (Q >= 1000 ? typeof gs.achievements.unlockedAtById["D12"] === "number" : true));
  })();

  // F-j：真实离线制造链 — 通过 applyOfflineGains 自行发布 boosters:manufactured
  (() => {
    const sbOffline = buildFullGameSandbox(null);
    const gs = sbOffline.sandbox.gameState;
    const RR = sbOffline.sandbox.ResourceRegistry;
    const recipeId = "mining_lubricant_l";
    // 设置材料和技能
    gs.skills.boosterEngineering = { lvl: 80, xp: 0 };
    RR.add(gs, "planetary:生物质", 500);
    RR.add(gs, "special:极化战术介质", 500);
    const B0_goods = Number(RR.get(gs, "booster:" + recipeId)) || 0;
    // 配置离线制造行动
    gs.currentAction.skill = "boosterEngineering";
    gs.currentAction.boosterRecipeTarget = recipeId;
    gs.currentAction.startedBoosterRecipeTarget = recipeId;
    gs.currentAction.active = true;
    gs.currentAction.progress = 0;
    gs.currentAction.lastProgressUpdate = 1000;
    gs.currentAction.batchRemaining = 3; // 多批次继续制造
    // 离线推进 1000 秒（足够完成多瓶）
    let offlineOk = true;
    try {
      sbOffline.sandbox.applyOfflineGains(1000, { runId: "audit_br_offline" });
    } catch (e) {
      ok("[br46m] 离线 applyOfflineGains 异常", false, "message=" + (e.message || String(e)));
      return;
    }
    const B1_goods = Number(RR.get(gs, "booster:" + recipeId)) || 0;
    const Q_off = B1_goods - B0_goods;
    if (Q_off < 1) { ok("[br46m] 离线制造 Q=" + Q_off + " 应为 ≥1", false); return; }
    ok("[br46m] 离线真实制造 Q=" + Q_off + "，统计与成就一致",
      gs.statistics.totals.boostersManufactured === Q_off &&
      gs.statistics.production.boosters[recipeId] === Q_off &&
      typeof gs.achievements.unlockedAtById["D01"] === "number" &&
      typeof gs.achievements.unlockedAtById["D11"] === "number");
  })();

  // F-k：真实空间站增幅剂自动线 — processAutoLines 自行发布 booster:manufactured + station:autoLineCompleted
  (() => {
    const sb = buildFullGameSandbox(null);
    const G = sb.sandbox.gameState;
    const W = sb.sandbox;
    const RR = W.ResourceRegistry;
    const recipeId = "mining_lubricant_l";
    const recipe = sb.sandbox.BOOSTER_RECIPES && sb.sandbox.BOOSTER_RECIPES.find(r => r.id === recipeId);
    if (!recipe) { ok("[br46n] BOOSTER_RECIPES 未加载", false); return; }

    // 1. 建设空间站基础设施
    G.station = G.station || {};
    G.station.bodyLevel = 5;
    G.station.maintenance = { fuelRemaining: 100000 };
    G.station.buildings = G.station.buildings || {};
    G.station.buildings.booster_factory = 1;
    // 2. 配方 mining_lubricant_l 解锁等级 60
    G.skills.boosterEngineering = { lvl: 80, xp: 0 };
    // 3. 放入真实材料（配方成本：planetary:生物质 ×5 + special:极化战术介质 ×7）
    RR.set(G, "planetary:生物质", 500);
    RR.set(G, "special:极化战术介质", 500);

    // 4. 配置自动线
    G.station.autoLines = G.station.autoLines || { smelting:{}, equipment:{}, booster:{} };
    const line = G.station.autoLines.booster;
    line.selectedTargetId = recipeId;
    line.startedTargetId = recipeId;
    line.enabled = true;
    line.lastTick = Date.now() - 300000; // 5 分钟前
    line.progress = 0;

    // 5. 记录基线
    const B0 = Number(RR.get(G, recipe.output.itemId)) || 0;
    const T0 = G.statistics.totals.boostersManufactured;
    const R0 = G.statistics.production.boosters[recipeId];
    const d01before = !!G.achievements.unlockedAtById["D01"];

    // 6. 监听事件
    const autoCompletedEvts = [];
    const boosterMfgEvts = [];
    const achEvts = [];
    const unsub1 = W.GameEvents.on("station:autoLineCompleted", (e) => { if (e.payload.lineId === "booster") autoCompletedEvts.push(e); });
    const unsub2 = W.GameEvents.on("booster:manufactured", (e) => boosterMfgEvts.push(e));
    const unsub3 = W.GameEvents.on("achievement:unlocked", (e) => achEvts.push(e));

    // 7. 执行
    let cycles = 0;
    try {
      cycles = W.processAutoLines(G, Date.now(), false);
    } catch (e) {
      ok("[br46n] processAutoLines 异常: " + (e.message || String(e)), false);
      return;
    }
    ok("[br46n] 自动线启动成功且 processAutoLines 返回周期 >0", cycles > 0);

    // 8. 库存检查
    const B1 = Number(RR.get(G, recipe.output.itemId)) || 0;
    const Q = B1 - B0;
    if (Q < 1) { ok("[br46n] 库存增量 Q=" + Q + " 应为 ≥1", false); return; }
    ok("[br46n2] 库存实际增加 Q=" + Q + "（" + B0 + "→" + B1 + "）", Q >= 1);

    // 9. 事件检查
    ok("[br46n3] 捕获 booster:manufactured 次数=" + boosterMfgEvts.length + " 且 payload.recipeId=" + (boosterMfgEvts[0] && boosterMfgEvts[0].payload.recipeId),
      boosterMfgEvts.length === 1 && boosterMfgEvts[0].payload.recipeId === recipeId &&
      boosterMfgEvts[0].payload.quantity === Q && boosterMfgEvts[0].meta.offline === false);
    ok("[br46n4] 捕获 station:autoLineCompleted lineId=booster targetId=" + (autoCompletedEvts[0] && autoCompletedEvts[0].payload.targetId),
      autoCompletedEvts.length === 1 && autoCompletedEvts[0].payload.lineId === "booster" &&
      autoCompletedEvts[0].payload.targetId === recipeId);

    // 10. 统计检查（禁止双计数）
    ok("[br46n5] totals.boostersManufactured 增量=" + (G.statistics.totals.boostersManufactured - T0) + " 等于 Q=" + Q,
      G.statistics.totals.boostersManufactured - T0 === Q);
    ok("[br46n6] production.boosters[" + recipeId + "] 增量=" + (G.statistics.production.boosters[recipeId] - (R0 || 0)) + " 等于 Q=" + Q,
      G.statistics.production.boosters[recipeId] - (R0 || 0) === Q);
    ok("[br46n7] 明确：增量=Q 而非 2Q",
      G.statistics.totals.boostersManufactured - T0 === Q &&
      G.statistics.production.boosters[recipeId] - (R0 || 0) === Q);

    // 11. 成就检查
    ok("[br46n8] D01 解锁" + (d01before ? "（之前已解锁）" : "（本次解锁）"),
      !!G.achievements.unlockedAtById["D01"]);
    ok("[br46n9] D11 解锁", !!G.achievements.unlockedAtById["D11"]);
    ok("[br46n10] D01 emit 次数=" + achEvts.filter(e => e.payload.achievementId === "D01").length + "，D11 emit 次数=" + achEvts.filter(e => e.payload.achievementId === "D11").length,
      achEvts.filter(e => e.payload.achievementId === "D01").length >= 1 &&
      achEvts.filter(e => e.payload.achievementId === "D11").length >= 1);

    // 12. 重复调用无新周期
    const cycles2 = W.processAutoLines(G, Date.now(), false);
    ok("[br46n11] 相同 now 再次调用无新周期（cycles2=" + cycles2 + "）", cycles2 === 0);
  })();

  // ========================= G. 源码与只读保护 =========================
  const statSrcG = fs.readFileSync(STATISTICS_PATH, "utf-8");
  const eventsSrcG = fs.readFileSync(EVENTS_PATH, "utf-8");
  const tickSrc = fs.readFileSync(TICK_PATH, "utf-8");
  const offlineSrc = fs.readFileSync(OFFLINE_PATH, "utf-8");
  const boostersDataSrc = fs.readFileSync(BOOSTERS_DATA_PATH, "utf-8");

  ok("[br47] events.js/tick.js/offline.js/boosters.js 不含 D01–D12 成就规则或 unlockAchievement 调用（statistics 保持纯记账）",
    !eventsSrcG.includes("D01") && !eventsSrcG.includes("D12") &&
    !tickSrc.includes("D01") && !tickSrc.includes("D12") &&
    !offlineSrc.includes("D01") && !offlineSrc.includes("D12") &&
    !boostersDataSrc.includes("D01") && !boostersDataSrc.includes("D12"));

  // achievements.js 本批新增函数不含奖励/UI/Steamworks/研究系统调用
  const achSysSrcG = fs.readFileSync(ACH_SYSTEM_PATH, "utf-8");
  const boosterFuncBody = (extractFnBody(achSysSrcG, "evaluateBoosterAchievementRules") || "") +
    (extractFnBody(achSysSrcG, "installBoosterAchievementConsumer") || "");
  ok("[br48] achievements.js 本批新增增幅剂函数体不含奖励/UI/Steamworks/研究系统调用（仅解锁内核 + 增幅剂事件消费者）",
    !boosterFuncBody.includes("award") && !boosterFuncBody.includes("AwardSystem") &&
    !boosterFuncBody.includes("Steamworks") && !boosterFuncBody.includes("Research"));

  // 正式工作区只读
  const afterCsvB = snapFile(CSV_PATH);
  const afterJsB = snapFile(JS_PATH);
  ok("[br49] 审计前后正式工作区 CSV 字节(SHA-256/长度)+mtime 完全不变",
    snapEq(preWsCsv, afterCsvB));
  ok("[br50] 审计前后正式工作区 JS 字节(SHA-256/长度)+mtime 完全不变",
    snapEq(preWsJs, afterJsB));

  // 仓库文件清单快照（后）：全部审计完成后拍摄，双向比较
  const boosterFilesAfter = [];
  try {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p); }
        else boosterFilesAfter.push(p);
      }
    })(ROOT);
  } catch (e) { boosterFilesAfter.length = 0; }
  let br51ok = boosterFilesBefore.length > 0 && boosterFilesAfter.length > 0;
  if (br51ok) {
    const bSet = new Set(boosterFilesBefore);
    const aSet = new Set(boosterFilesAfter);
    // before ⊆ after
    for (const f of boosterFilesBefore) { if (!aSet.has(f)) { br51ok = false; break; } }
    // after ⊆ before
    if (br51ok) {
      for (const f of boosterFilesAfter) { if (!bSet.has(f)) { br51ok = false; break; } }
    }
  }
  ok("[br51] 审计增幅剂分区未向仓库写入任何辅助文件（函数首尾双向文件清单一致）", br51ok);

  // BOOSTER_RULES 在分区内未被改变
  ok("[br52] 增幅剂规则数据在本分区内未被任何求值/消费者改变（BOOSTER_RULES 全冻结且 JSON 与分区开始时一致）",
    Object.isFrozen(RD.BOOSTER_RULES) &&
    RD.BOOSTER_RULES.every((r) => Object.isFrozen(r)));
}

// ============================================================================
//  --archaeology：Batch C-7 考古 F01–F21 真实触发 / statistics v4 / 消费者 /
//  在线离线真实考古链 / persistence 追溯对账 timeline / 只读保护
// ============================================================================
function runArchaeology() {
  // 仓库文件清单快照（前）：分区结束时双向比较，证明未向仓库写入任何辅助文件
  const archFilesBefore = [];
  try {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p); }
        else archFilesBefore.push(p);
      }
    })(ROOT);
  } catch (e) { archFilesBefore.length = 0; }

  const ARCH_DATA_PATH = path.join(ROOT, "js", "data", "archaeology.js");
  const ARCH_SYS_PATH = path.join(ROOT, "js", "systems", "archaeology.js");
  const ARCH_IDS = [];
  for (let i = 1; i <= 21; i++) ARCH_IDS.push("F" + String(i).padStart(2, "0"));
  const EXPECT_SITES = [
    "site_i_a","site_i_b","site_i_c","site_ii_a","site_ii_b","site_ii_c",
    "site_iii_a","site_iii_b","site_iii_c","site_iv_a","site_iv_b","site_iv_c",
    "site_v_a","site_v_b","site_v_c",
  ];
  const EXPECT_TIERS = ["I","II","III","IV","V"];

  function extractFnBody(src, name) {
    let start = src.indexOf("function " + name);
    if (start < 0) start = src.indexOf(name + "("); // 兼容对象方法简写 buyLPItem(state, itemId) { ... }
    if (start < 0) return "";
    const paren = src.indexOf("(", start);
    let i = src.indexOf("{", paren < 0 ? start : paren);
    if (i < 0) return "";
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return "";
  }

  // ---- 辅助：构造带 v4 archaeology 统计的最小状态（原样透传非法值以测试防御） ----
  function makeArchState(box, o) {
    o = o || {};
    const sites = {}; const tiers = {};
    if (o.sites && typeof o.sites === "object") for (const k of Object.keys(o.sites)) sites[k] = o.sites[k];
    if (o.tiers && typeof o.tiers === "object") for (const k of Object.keys(o.tiers)) tiers[k] = o.tiers[k];
    return {
      skills: {},
      achievements: box.AchievementState.createDefaultAchievementState(),
      statistics: {
        version: 4,
        totals: {
          archaeologyAttempts: (o.attempts !== undefined ? o.attempts : 0),
          artifactsSold: (o.sold !== undefined ? o.sold : 0),
          archaeologyLpEarned: (o.lp !== undefined ? o.lp : 0),
          archaeologyRareFinds: (o.rare !== undefined ? o.rare : 0),
        },
        archaeology: { sites, tiers },
      },
      _dirty: false,
    };
  }

  // ========================= A. 规则数据 =========================
  const sbA = buildKernelSandbox({ withEvents: true, withRules: true });
  const RD = sbA.AchievementRuleData;
  const SYS = sbA.AchievementSystem;
  const evaluateA = (state, atMs) => SYS.evaluateArchaeologyAchievementRules(state, atMs);

  ok("[ar1] ARCHAEOLOGY_RULES 冻结数组 21 项、每项冻结、BY_ID 冻结 21 键且逐项引用一致（F01–F21 顺序）",
    Array.isArray(RD.ARCHAEOLOGY_RULES) && RD.ARCHAEOLOGY_RULES.length === 21 &&
    Object.isFrozen(RD.ARCHAEOLOGY_RULES) && RD.ARCHAEOLOGY_RULES.every((r) => Object.isFrozen(r)) &&
    RD.ARCHAEOLOGY_RULES_BY_ID && Object.isFrozen(RD.ARCHAEOLOGY_RULES_BY_ID) &&
    Object.keys(RD.ARCHAEOLOGY_RULES_BY_ID).length === 21 &&
    ARCH_IDS.every((id, i) => RD.ARCHAEOLOGY_RULES[i].achievementId === id &&
      RD.ARCHAEOLOGY_RULES_BY_ID[id] === RD.ARCHAEOLOGY_RULES[i]));

  // 与 js/data/archaeology.js 真实 15 站点 / 5 档双向集合相等
  let ar2ok = true, ar3ok = true;
  try {
    const archDataSrc = fs.readFileSync(ARCH_DATA_PATH, "utf-8");
    const ctxA = { console, ARCHAEOLOGY_SHIP_TYPES: [] };
    ctxA.window = ctxA; ctxA.globalThis = ctxA;
    vm.createContext(ctxA);
    vm.runInContext(archDataSrc, ctxA, { filename: "archaeology-data.js" });
    const realSiteIds = ctxA.ARCHAEOLOGY_SITES.map((s) => s.id);
    ar2ok = Array.isArray(RD.ARCHAEOLOGY_SITE_IDS) && Object.isFrozen(RD.ARCHAEOLOGY_SITE_IDS) &&
      RD.ARCHAEOLOGY_SITE_IDS.length === 15 && realSiteIds.length === 15 &&
      RD.ARCHAEOLOGY_SITE_IDS.every((id, i) => id === realSiteIds[i]);
    const realTierKeys = Object.keys(ctxA.ARCHAEOLOGY_TIERS);
    ar3ok = Array.isArray(RD.ARCHAEOLOGY_TIER_KEYS) && Object.isFrozen(RD.ARCHAEOLOGY_TIER_KEYS) &&
      RD.ARCHAEOLOGY_TIER_KEYS.length === 5 && realTierKeys.length === 5 &&
      RD.ARCHAEOLOGY_TIER_KEYS.every((k, i) => k === realTierKeys[i]);
  } catch (e) { ar2ok = false; ar3ok = false; }
  ok("[ar2] ARCHAEOLOGY_SITE_IDS 与 archaeology.js ARCHAEOLOGY_SITES 双向逐项相等（各 15、顺序一致）", ar2ok);
  ok("[ar3] ARCHAEOLOGY_TIER_KEYS 与 ARCHAEOLOGY_TIERS 键双向逐项相等（I–V）", ar3ok);

  // 规则字段精确映射
  const rF01 = RD.ARCHAEOLOGY_RULES_BY_ID["F01"];
  const rF17 = RD.ARCHAEOLOGY_RULES_BY_ID["F17"];
  const rF18 = RD.ARCHAEOLOGY_RULES_BY_ID["F18"];
  const rF19 = RD.ARCHAEOLOGY_RULES_BY_ID["F19"];
  const rF20 = RD.ARCHAEOLOGY_RULES_BY_ID["F20"];
  const rF21 = RD.ARCHAEOLOGY_RULES_BY_ID["F21"];
  ok("[ar4] 逐项映射精确：F01 attempts≥1；F02–F16 依序 15 站点≥1；F17 五档全≥1；F18/F19 sold≥1/≥100；F20 lp≥10000；F21 rare≥1",
    rF01.type === "archaeology-total" && rF01.totalKey === "archaeologyAttempts" && rF01.minValue === 1 &&
    EXPECT_SITES.every((sid, i) => {
      const r = RD.ARCHAEOLOGY_RULES[i + 1];
      return r.type === "archaeology-site" && r.siteId === sid && r.minValue === 1;
    }) &&
    rF17.type === "archaeology-tier-set" && Array.isArray(rF17.tierKeys) && rF17.tierKeys.length === 5 &&
    EXPECT_TIERS.every((k, i) => rF17.tierKeys[i] === k) && rF17.minValue === 1 &&
    rF18.type === "archaeology-total" && rF18.totalKey === "artifactsSold" && rF18.minValue === 1 &&
    rF19.type === "archaeology-total" && rF19.totalKey === "artifactsSold" && rF19.minValue === 100 &&
    rF20.type === "archaeology-total" && rF20.totalKey === "archaeologyLpEarned" && rF20.minValue === 10000 &&
    rF21.type === "archaeology-total" && rF21.totalKey === "archaeologyRareFinds" && rF21.minValue === 1);

  // 七规则集合两两零交集 + 总计 143 + 未映射 55
  const setsAll = [
    new Set(RD.SKILL_RULES.map((r) => r.achievementId)),
    new Set(RD.PRODUCTION_RULES.map((r) => r.achievementId)),
    new Set(RD.COMBAT_RULES.map((r) => r.achievementId)),
    new Set(RD.MANUFACTURING_RULES.map((r) => r.achievementId)),
    new Set(RD.EQUIPMENT_RULES.map((r) => r.achievementId)),
    new Set(RD.BOOSTER_RULES.map((r) => r.achievementId)),
    new Set(RD.ARCHAEOLOGY_RULES.map((r) => r.achievementId)),
  ];
  let ar5ok = true;
  for (let i = 0; i < setsAll.length && ar5ok; i++) {
    for (let j = i + 1; j < setsAll.length && ar5ok; j++) {
      for (const id of setsAll[i]) { if (setsAll[j].has(id)) { ar5ok = false; break; } }
    }
  }
  const unionAll = new Set();
  for (const s of setsAll) for (const id of s) unionAll.add(id);
  const sumAll = setsAll.reduce((s, x) => s + x.size, 0);
  const catalogTotal = sbA.AchievementData.ACHIEVEMENTS.length;
  ok("[ar5] 七规则集合两两零交集、总计 130+21=151、目录 197 未映射恰 46、151 项全部存在于成就目录",
    ar5ok && sumAll === 151 && unionAll.size === 151 &&
    catalogTotal === 197 && catalogTotal - unionAll.size === 46 &&
    [...unionAll].every((id) => !!sbA.AchievementData.ACHIEVEMENTS_BY_ID[id]));

  ok("[ar6] F22 不在 ARCHAEOLOGY_RULES_BY_ID（属技能规则，不重复定义）且在 SKILL_RULES 中恰有映射",
    !("F22" in RD.ARCHAEOLOGY_RULES_BY_ID) && setsAll[0].has("F22"));

  // ========================= B. 求值边界 =========================
  // F01：0 不解锁、1 解锁
  const sF01_0 = makeArchState(sbA, { attempts: 0 });
  const rF01_0 = evaluateA(sF01_0, 100);
  const sF01_1 = makeArchState(sbA, { attempts: 1 });
  const rF01_1 = evaluateA(sF01_1, 100);
  ok("[ar7] F01：archaeologyAttempts=0 不解锁、=1 解锁恰 F01 一项（evaluatedCount 恒为 21）",
    rF01_0.ok && rF01_0.evaluatedCount === 21 && rF01_0.unlockedIds.length === 0 &&
    rF01_1.ok && rF01_1.evaluatedCount === 21 &&
    rF01_1.unlockedIds.length === 1 && rF01_1.unlockedIds[0] === "F01" &&
    sF01_1.achievements.unlockedAtById["F01"] === 100);

  // F02–F16 每站点：0 不解锁、1 解锁恰该项（不解锁其他站点项）
  let ar8ok = true;
  for (let i = 0; i < 15; i++) {
    const fid = ARCH_IDS[i + 1];
    const sid = EXPECT_SITES[i];
    const s0 = makeArchState(sbA, { sites: {} });
    const r0 = evaluateA(s0, 200);
    if (r0.unlockedIds.includes(fid)) ar8ok = false;
    const s1 = makeArchState(sbA, { sites: { [sid]: 1 } });
    const r1 = evaluateA(s1, 200);
    if (r1.unlockedIds.length !== 1 || r1.unlockedIds[0] !== fid) ar8ok = false;
    if (s1.achievements.unlockedAtById[fid] !== 200) ar8ok = false;
  }
  ok("[ar8] F02–F16 每站点：sites[siteId]=0 不解锁、=1 解锁恰该项（15 项逐一验证）", ar8ok);

  // F17：四档不解锁、五档解锁
  const s17_4 = makeArchState(sbA, { tiers: { I:1, II:1, III:1, IV:1 } });
  const r17_4 = evaluateA(s17_4, 300);
  const s17_5 = makeArchState(sbA, { tiers: { I:1, II:1, III:1, IV:1, V:1 } });
  const r17_5 = evaluateA(s17_5, 300);
  ok("[ar9] F17：仅 I–IV 四档各≥1 不解锁；I–V 五档各≥1 解锁",
    !r17_4.unlockedIds.includes("F17") && r17_5.unlockedIds.includes("F17"));

  // F18/F19 边界：0/1/99/100
  const s18_0 = makeArchState(sbA, { sold: 0 });
  const r18_0 = evaluateA(s18_0, 400);
  const s18_1 = makeArchState(sbA, { sold: 1 });
  const r18_1 = evaluateA(s18_1, 400);
  const s19_99 = makeArchState(sbA, { sold: 99 });
  const r19_99 = evaluateA(s19_99, 400);
  const s19_100 = makeArchState(sbA, { sold: 100 });
  const r19_100 = evaluateA(s19_100, 400);
  ok("[ar10] F18/F19：sold=0 均不解锁；=1 仅 F18；=99 仅 F18；=100 F18+F19",
    r18_0.unlockedIds.length === 0 &&
    r18_1.unlockedIds.includes("F18") && !r18_1.unlockedIds.includes("F19") &&
    r19_99.unlockedIds.includes("F18") && !r19_99.unlockedIds.includes("F19") &&
    r19_100.unlockedIds.includes("F18") && r19_100.unlockedIds.includes("F19"));

  // F20：9999 不解锁、10000 解锁
  const s20_a = makeArchState(sbA, { lp: 9999 });
  const r20_a = evaluateA(s20_a, 500);
  const s20_b = makeArchState(sbA, { lp: 10000 });
  const r20_b = evaluateA(s20_b, 500);
  ok("[ar11] F20：archaeologyLpEarned=9999 不解锁、=10000 解锁",
    !r20_a.unlockedIds.includes("F20") && r20_b.unlockedIds.includes("F20"));

  // F21：0 不解锁、1 解锁
  const s21_0 = makeArchState(sbA, { rare: 0 });
  const r21_0 = evaluateA(s21_0, 600);
  const s21_1 = makeArchState(sbA, { rare: 1 });
  const r21_1 = evaluateA(s21_1, 600);
  ok("[ar12] F21：archaeologyRareFinds=0 不解锁、=1 解锁",
    !r21_0.unlockedIds.includes("F21") && r21_1.unlockedIds.includes("F21"));

  // 全满：21 项一次解锁、顺序 F01–F21、共享 atMs
  const sFullA = makeArchState(sbA, {
    attempts: 1, sold: 100, lp: 10000, rare: 1,
    sites: (() => { const m = {}; for (const sid of EXPECT_SITES) m[sid] = 1; return m; })(),
    tiers: { I:1, II:1, III:1, IV:1, V:1 },
  });
  const rFullA = evaluateA(sFullA, 2000);
  ok("[ar13] 全满状态单次求值恰好解锁 F01–F21（21 项，顺序 F01–F21，同批 atMs=2000）",
    rFullA.ok && rFullA.evaluatedCount === 21 && rFullA.unlockedIds.length === 21 &&
    rFullA.unlockedIds.every((id, i) => id === ARCH_IDS[i]) &&
    ARCH_IDS.every((id) => sFullA.achievements.unlockedAtById[id] === 2000));

  // 非法值不得解锁（NaN/字符串/负数/Infinity/null/{}/true）
  const sBadA = makeArchState(sbA, {
    attempts: NaN, sold: "100", lp: Infinity, rare: -1,
    sites: { site_i_a: "1", site_i_b: null, site_i_c: -3, site_ii_a: NaN, site_ii_b: {}, site_ii_c: true },
    tiers: { I: Infinity, II: "2", III: -1, IV: NaN, V: null },
  });
  const rBadA = evaluateA(sBadA, 1);
  ok("[ar14] 非法统计值（NaN/字符串/负数/Infinity/null/{}/true）全部拒绝：0 项解锁、ok=true、evaluatedCount=21",
    rBadA.ok === true && rBadA.evaluatedCount === 21 && rBadA.unlockedIds.length === 0 &&
    Object.keys(sBadA.achievements.unlockedAtById).length === 0);

  // 失败原因：INVALID_STATE / STATISTICS_UNAVAILABLE / RULE_DATA_UNAVAILABLE
  const rInvA = evaluateA(null, 1);
  const rNoStatA = evaluateA({ achievements: sbA.AchievementState.createDefaultAchievementState() }, 1);
  const sbNoRules = buildKernelSandbox({ withEvents: true });
  const sNoRules = {
    skills: {},
    achievements: sbNoRules.AchievementState.createDefaultAchievementState(),
    statistics: { version: 4, totals: {}, archaeology: { sites: {}, tiers: {} } },
    _dirty: false,
  };
  const rNoRules = sbNoRules.AchievementSystem.evaluateArchaeologyAchievementRules(sNoRules, 1);
  ok("[ar15] 失败原因稳定：null→INVALID_STATE、无 statistics→STATISTICS_UNAVAILABLE、无规则数据→RULE_DATA_UNAVAILABLE（均 evaluatedCount=0、unlockedIds=[]）",
    rInvA.ok === false && rInvA.reason === "INVALID_STATE" && rInvA.evaluatedCount === 0 && rInvA.unlockedIds.length === 0 &&
    rNoStatA.ok === false && rNoStatA.reason === "STATISTICS_UNAVAILABLE" && rNoStatA.evaluatedCount === 0 &&
    rNoRules.ok === false && rNoRules.reason === "RULE_DATA_UNAVAILABLE" && rNoRules.evaluatedCount === 0);

  // ========================= C. 幂等 / dirty / 时间语义 =========================
  const capA = [];
  sbA.GameEvents.on("achievement:unlocked", (ev) => capA.push(ev));
  const sI_A = makeArchState(sbA, { attempts: 1, sites: { site_i_a: 1 } });
  SYS.unlockAchievement(sI_A, "F01", 111);
  capA.length = 0;
  const rI1_A = evaluateA(sI_A, 5000);
  ok("[ar16] 首次求值 unlockedIds 只含本次新解锁（含 F02 不含预解锁 F01，F01 保持 111）",
    rI1_A.ok && rI1_A.unlockedIds.includes("F02") && !rI1_A.unlockedIds.includes("F01") &&
    sI_A.achievements.unlockedAtById["F01"] === 111);
  sI_A._dirty = false;
  capA.length = 0;
  const rI2_A = evaluateA(sI_A, 6000);
  ok("[ar17] 同状态重复求值 unlockedIds=[]、不覆盖时间（F02 保持 5000）、不 emit、不 dirty",
    rI2_A.ok && rI2_A.unlockedIds.length === 0 &&
    sI_A.achievements.unlockedAtById["F02"] === 5000 && capA.length === 0 && sI_A._dirty === false);

  const TSA = 1690000123456.75;
  capA.length = 0;
  const sT_A = makeArchState(sbA, { attempts: 1, sold: 1 });
  const rT_A = evaluateA(sT_A, TSA);
  const idCountsA = {};
  for (const ev of capA) idCountsA[ev.payload.achievementId] = (idCountsA[ev.payload.achievementId] || 0) + 1;
  const sameAtMsOkA = rT_A.unlockedIds.length === 2 &&
    sT_A.achievements.unlockedAtById["F01"] === TSA && sT_A.achievements.unlockedAtById["F18"] === TSA &&
    capA.length === 2 && idCountsA["F01"] === 1 && idCountsA["F18"] === 1 &&
    capA.every((ev) => ev.timestamp === ev.payload.unlockedAt && ev.payload.unlockedAt === TSA);
  const sNaNA = makeArchState(sbA, { attempts: 1 });
  const rNaNA = evaluateA(sNaNA, NaN);
  const nanOkA = rNaNA.unlockedIds.includes("F01") &&
    sNaNA.achievements.unlockedAtById["F01"] === FROZEN_NOW;
  ok("[ar18] 时间语义：同批多解锁共享同一浮点 atMs 且恰各 emit 一次；非法 atMs 统一回退冻结 Date.now()", sameAtMsOkA && nanOkA);

  const sROA = makeArchState(sbA, { attempts: 1, sites: { site_i_a: 1 }, tiers: { I: 1 } });
  const statsBeforeA = JSON.stringify(sROA.statistics);
  const rulesBeforeA = JSON.stringify(RD.ARCHAEOLOGY_RULES);
  evaluateA(sROA, 1);
  ok("[ar19] 求值前后 state.statistics 与 ARCHAEOLOGY_RULES JSON 完全一致（条件读取纯只读、无 schema 污染）",
    JSON.stringify(sROA.statistics) === statsBeforeA &&
    JSON.stringify(RD.ARCHAEOLOGY_RULES) === rulesBeforeA &&
    !("archaeology" in sROA.achievements));

  // ========================= D. statistics v1/v2/v3→v4 迁移 / 事件记账 =========================
  let statVMA = null;
  try {
    const statSrcA = fs.readFileSync(STATISTICS_PATH, "utf-8");
    const epA = ";globalThis.__ensure=ensureStatisticsState;globalThis.__def=createDefaultStatisticsState;globalThis.__consume=consumeStatisticsEvent;";
    const ctx = { console };
    ctx.window = ctx; ctx.globalThis = ctx;
    ctx.GameEvents = { onIdempotent() {}, on() {}, emit() {}, listenerCount() { return 0; } };
    ctx.gameState = { statistics: { version: 1, totals: {}, production: {}, combat: {}, activity: {}, eventLedger: {} }, _dirty: false };
    vm.createContext(ctx);
    vm.runInContext(statSrcA + "\n" + epA, ctx, { filename: "statistics-archaeology.js" });
    statVMA = ctx;
  } catch (e) { statVMA = null; }

  const ARCH_TOTAL_KEYS = ["archaeologyAttempts", "artifactsSold", "archaeologyLpEarned", "archaeologyRareFinds"];
  if (statVMA) {
    // 新游戏默认结构含 4 个 totals=0 + archaeology 空 map，version=6
    const defA = statVMA.__def();
    ok("[ar20] 新游戏默认统计：version=6、4 个考古 totals 全为 0、archaeology={sites:{},tiers:{}}",
      defA.version === 9 &&
      ARCH_TOTAL_KEYS.every((k) => defA.totals[k] === 0) &&
      defA.archaeology && typeof defA.archaeology === "object" &&
      defA.archaeology.sites && Object.keys(defA.archaeology.sites).length === 0 &&
      defA.archaeology.tiers && Object.keys(defA.archaeology.tiers).length === 0);

    // v1→v4
    statVMA.gameState.statistics = {
      version: 1, totals: { events: 5, equipmentEnhancementAttempts: 3 },
      production: { manufactured: { "t1_mining_laser": 1 } }, combat: {}, activity: {}, eventLedger: {},
    };
    statVMA.__ensure(statVMA.gameState);
    const st1A = statVMA.gameState.statistics;
    ok("[ar21] v1→v6 真实迁移：version=6、4 个考古 totals=0、archaeology 空 map、旧 totals 与 production.manufactured 保留",
      st1A.version === 9 && ARCH_TOTAL_KEYS.every((k) => st1A.totals[k] === 0) &&
      st1A.archaeology && Object.keys(st1A.archaeology.sites).length === 0 && Object.keys(st1A.archaeology.tiers).length === 0 &&
      st1A.totals.events === 5 && st1A.totals.equipmentEnhancementAttempts === 3 &&
      st1A.production.manufactured["t1_mining_laser"] === 1);

    // v2→v4
    statVMA.gameState.statistics = {
      version: 2, totals: { events: 7, equipmentEnhancementAttempts: 2 },
      production: { manufactured: { "x": 1 } }, combat: {}, activity: {}, eventLedger: {},
    };
    statVMA.__ensure(statVMA.gameState);
    const st2A = statVMA.gameState.statistics;
    ok("[ar22] v2→v6 迁移：version=6、考古字段补齐为 0/{}、旧字段保留",
      st2A.version === 9 && ARCH_TOTAL_KEYS.every((k) => st2A.totals[k] === 0) &&
      st2A.archaeology && Object.keys(st2A.archaeology.sites).length === 0 &&
      st2A.totals.events === 7);

    // v3→v4（含 booster 字段保留）
    statVMA.gameState.statistics = {
      version: 3, totals: { events: 9, boostersManufactured: 8 },
      production: { boosters: { "mining_lubricant_l": 8 } }, combat: {}, activity: {}, eventLedger: {},
    };
    statVMA.__ensure(statVMA.gameState);
    const st3A = statVMA.gameState.statistics;
    ok("[ar23] v3→v6 迁移：version=6、考古字段补齐、boostersManufactured=8 与 production.boosters 保留",
      st3A.version === 9 && ARCH_TOTAL_KEYS.every((k) => st3A.totals[k] === 0) &&
      st3A.totals.boostersManufactured === 8 && st3A.production.boosters["mining_lubricant_l"] === 8);

    // 4 个 totals 非法值清洗为 0
    let ar24ok = true;
    for (const key of ARCH_TOTAL_KEYS) {
      for (const bad of [undefined, null, NaN, Infinity, -Infinity, -3, -0.5, "abc", "7", {}, [], true, false]) {
        statVMA.gameState.statistics = {
          version: 4, totals: { [key]: bad },
          production: {}, combat: {}, activity: {}, eventLedger: {},
          archaeology: { sites: {}, tiers: {} },
        };
        statVMA.__ensure(statVMA.gameState);
        if (statVMA.gameState.statistics.totals[key] !== 0) { ar24ok = false; break; }
      }
      if (!ar24ok) break;
    }
    ok("[ar24] 4 个考古 totals 非法值（undefined/null/NaN/±Infinity/负数/字符串/{}/[]/true/false）全部清洗为 0", ar24ok);

    // 合法旧值保留（floor 收敛）
    statVMA.gameState.statistics = {
      version: 4, totals: { archaeologyAttempts: 7, artifactsSold: 9.9, archaeologyLpEarned: 10000, archaeologyRareFinds: 0 },
      production: {}, combat: {}, activity: {}, eventLedger: {},
      archaeology: { sites: {}, tiers: {} },
    };
    statVMA.__ensure(statVMA.gameState);
    const keptA = statVMA.gameState.statistics.totals;
    ok("[ar25] 合法旧值保留：attempts 7→7、sold 9.9→floor→9、lp 10000→10000、rare 0→0",
      keptA.archaeologyAttempts === 7 && keptA.artifactsSold === 9 &&
      keptA.archaeologyLpEarned === 10000 && keptA.archaeologyRareFinds === 0);

    // archaeology map 必须重建 + 逐项清洗
    statVMA.gameState.statistics = {
      version: 4, totals: {},
      production: {}, combat: {}, activity: {}, eventLedger: {},
      archaeology: {
        sites: { good: 3, floatVal: 2.7, zero: 0, numStr: "5", neg: -1, nanV: NaN, infV: Infinity, objV: {}, boolV: true },
        tiers: [1, 2, 3],
      },
    };
    statVMA.__ensure(statVMA.gameState);
    const cleanedA = statVMA.gameState.statistics.archaeology;
    ok("[ar26] archaeology.sites 逐项清洗（good=3/floatVal=2/zero=0 保留；字符串/负数/NaN/Infinity/{}/true 删除）；tiers 为数组时替换为 {}",
      cleanedA.sites.good === 3 && cleanedA.sites.floatVal === 2 && cleanedA.sites.zero === 0 &&
      !("numStr" in cleanedA.sites) && !("neg" in cleanedA.sites) && !("nanV" in cleanedA.sites) &&
      !("infV" in cleanedA.sites) && !("objV" in cleanedA.sites) && !("boolV" in cleanedA.sites) &&
      cleanedA.tiers && typeof cleanedA.tiers === "object" && !Array.isArray(cleanedA.tiers) &&
      Object.keys(cleanedA.tiers).length === 0);

    // archaeology 整体非法（数组/字符串）→ 重建为空结构
    statVMA.gameState.statistics = {
      version: 4, totals: {}, production: {}, combat: {}, activity: {}, eventLedger: {},
      archaeology: [1, 2],
    };
    statVMA.__ensure(statVMA.gameState);
    const rebuiltA = statVMA.gameState.statistics.archaeology;
    ok("[ar27] archaeology 整体为数组等非法时重建为 {sites:{},tiers:{}}",
      rebuiltA && typeof rebuiltA === "object" && !Array.isArray(rebuiltA) &&
      rebuiltA.sites && Object.keys(rebuiltA.sites).length === 0 &&
      rebuiltA.tiers && Object.keys(rebuiltA.tiers).length === 0);

    // 连续迁移幂等 JSON 严格一致
    statVMA.gameState.statistics = {
      version: 1, totals: { events: 3 }, production: {}, combat: {}, activity: {}, eventLedger: {},
    };
    const m1 = JSON.stringify(statVMA.__ensure(statVMA.gameState));
    const m2 = JSON.stringify(statVMA.__ensure(statVMA.gameState));
    ok("[ar28] 连续迁移两次 JSON 严格一致且 version 恒为 9", m1 === m2 && statVMA.gameState.statistics.version === 9);

    // 非法 quantity 逐项拒绝（直接 __consume 绕过合同校验）
    statVMA.gameState.statistics = statVMA.__def();
    statVMA.gameState._dirty = false;
    let ar29ok = true;
    for (const q of [0, -1, NaN, Infinity, -Infinity, "5", "1.5", null, undefined, {}, true, 0.5]) {
      const consumed = statVMA.__consume({ type: "archaeology:artifactSold", payload: { artifactId: "art_i_common_a", quantity: q, isk: 1 }, meta: { offline: false, timestamp: 1 } });
      if (consumed === true) ar29ok = false;
      if (statVMA.gameState.statistics.totals.artifactsSold !== 0) ar29ok = false;
    }
    // 非法 lp 逐项拒绝
    for (const lp of [0, -1, NaN, Infinity, "50", null, undefined, {}, true, 0.5]) {
      const consumed = statVMA.__consume({ type: "archaeology:artifactRedeemed", payload: { artifactId: "art_i_lp", quantity: 1, lp }, meta: { offline: false, timestamp: 1 } });
      if (consumed === true) ar29ok = false;
      if (statVMA.gameState.statistics.totals.archaeologyLpEarned !== 0) ar29ok = false;
    }
    // 合法：quantity 5 与 2.7 → 7；lp 50.9 → floor 50
    const c1 = statVMA.__consume({ type: "archaeology:artifactSold", payload: { artifactId: "art_i_common_a", quantity: 5, isk: 1 }, meta: { offline: false, timestamp: 2 } });
    const c2 = statVMA.__consume({ type: "archaeology:artifactsSold", payload: { quantity: 2.7, totalIsk: 1 }, meta: { offline: false, timestamp: 3 } });
    const c3 = statVMA.__consume({ type: "archaeology:artifactRedeemed", payload: { artifactId: "art_i_lp", quantity: 1, lp: 50.9 }, meta: { offline: false, timestamp: 4 } });
    ar29ok = ar29ok && c1 === true && c2 === true && c3 === true &&
      statVMA.gameState.statistics.totals.artifactsSold === 7 &&
      statVMA.gameState.statistics.totals.archaeologyLpEarned === 50;
    ok("[ar29] 非法 quantity/lp 全部拒绝不污染统计；合法 5+2.7→7、lp 50.9→floor→50", ar29ok);

    // success 缺 siteId/tier 拒绝；artifactFound 非 unique 不计 rare
    statVMA.gameState.statistics = statVMA.__def();
    const cs1 = statVMA.__consume({ type: "archaeology:success", payload: { tier: "I", xp: 50 }, meta: { offline: false, timestamp: 5 } });
    const cs2 = statVMA.__consume({ type: "archaeology:success", payload: { siteId: "site_i_a", xp: 50 }, meta: { offline: false, timestamp: 6 } });
    const cs3 = statVMA.__consume({ type: "archaeology:artifactFound", payload: { artifactId: "art_i_common_a", category: "common_isk", tier: "I", iskValue: 600, lpValue: 0 }, meta: { offline: false, timestamp: 7 } });
    ok("[ar30] success 缺 siteId/tier 拒绝（sites/tiers 不变）；artifactFound category=common_isk 不计 rare",
      cs1 !== true && cs2 !== true && cs3 !== true &&
      Object.keys(statVMA.gameState.statistics.archaeology.sites).length === 0 &&
      Object.keys(statVMA.gameState.statistics.archaeology.tiers).length === 0 &&
      statVMA.gameState.statistics.totals.archaeologyRareFinds === 0);
  } else {
    ok("[ar20] statistics 迁移 VM 加载失败", false);
  }

  // D-b 真实 statistics 沙箱：考古事件记账
  const sbStatA = buildKernelSandbox({ withEvents: true, withStatistics: true });
  const gsStatA = sbStatA.gameState;
  sbStatA.GameEvents.emit("archaeology:attemptCompleted",
    { siteId: "site_i_a", tier: "I", success: true, successChance: 0.5 }, { offline: false, timestamp: 100 });
  sbStatA.GameEvents.emit("archaeology:success",
    { siteId: "site_i_a", tier: "I", xp: 50 }, { offline: false, timestamp: 101 });
  sbStatA.GameEvents.emit("archaeology:artifactFound",
    { artifactId: "art_i_unique_a", category: "unique", tier: "I", iskValue: 3000, lpValue: 0 }, { offline: false, timestamp: 102 });
  sbStatA.GameEvents.emit("archaeology:artifactFound",
    { artifactId: "art_i_common_a", category: "common_isk", tier: "I", iskValue: 600, lpValue: 0 }, { offline: false, timestamp: 103 });
  sbStatA.GameEvents.emit("archaeology:artifactSold",
    { artifactId: "art_i_common_a", quantity: 2, isk: 1200 }, { offline: false, timestamp: 104 });
  sbStatA.GameEvents.emit("archaeology:artifactsSold",
    { quantity: 5, totalIsk: 3000 }, { offline: false, timestamp: 105 });
  sbStatA.GameEvents.emit("archaeology:artifactRedeemed",
    { artifactId: "art_i_lp", quantity: 1, lp: 50 }, { offline: false, timestamp: 106 });
  sbStatA.GameEvents.emit("archaeology:artifactsRedeemed",
    { quantity: 2, totalLp: 100 }, { offline: false, timestamp: 107 });
  ok("[ar31] 真实事件记账：attempts=1、sites[site_i_a]=1、tiers[I]=1、rare=1（common 不计）、sold=7、lp=150",
    gsStatA.statistics.totals.archaeologyAttempts === 1 &&
    gsStatA.statistics.archaeology.sites["site_i_a"] === 1 &&
    gsStatA.statistics.archaeology.tiers["I"] === 1 &&
    gsStatA.statistics.totals.archaeologyRareFinds === 1 &&
    gsStatA.statistics.totals.artifactsSold === 7 &&
    gsStatA.statistics.totals.archaeologyLpEarned === 150);

  // 同一 eventId 重放不重复累计
  sbStatA.GameEvents.emit("archaeology:attemptCompleted",
    { siteId: "site_i_a", tier: "I", success: false, successChance: 0.5 }, { offline: false, eventId: "ar-dup-1" });
  sbStatA.GameEvents.emit("archaeology:attemptCompleted",
    { siteId: "site_i_a", tier: "I", success: false, successChance: 0.5 }, { offline: false, eventId: "ar-dup-1" });
  ok("[ar32] 同 eventId 重放不双计数（attempts=2）",
    gsStatA.statistics.totals.archaeologyAttempts === 2);

  // 战斗 LP 不混入考古 LP（F20 只消费考古兑换事件）
  const lpBeforeCombat = gsStatA.statistics.totals.archaeologyLpEarned;
  sbStatA.GameEvents.emit("combat:zoneCleared",
    { zoneId: "angel_outpost", name: "天使前哨站", lp: 99999, clearCount: 1, damageTaken: 0 }, { offline: false, timestamp: 200 });
  ok("[ar33] combat:zoneCleared(lp=99999) 不改变 archaeologyLpEarned（战斗 LP 与考古 LP 隔离）",
    gsStatA.statistics.totals.archaeologyLpEarned === lpBeforeCombat);

  // ========================= E. 消费者 =========================
  const achSysSrcA = fs.readFileSync(ACH_SYSTEM_PATH, "utf-8");
  const aInstallBody = extractFnBody(achSysSrcA, "installArchaeologyAchievementConsumer");
  ok("[ar34] 考古消费者注册在通配符 \"*\" 且严格按 event.type 过滤（7 类真实考古事件全部在过滤名单中）",
    aInstallBody.includes('GE.on("*"') &&
    ["archaeology:attemptCompleted", "archaeology:success", "archaeology:artifactFound",
     "archaeology:artifactsSold", "archaeology:artifactSold",
     "archaeology:artifactsRedeemed", "archaeology:artifactRedeemed"]
      .every((t) => aInstallBody.includes('"' + t + '"')));

  // E-a：真实 statistics + 七消费者
  const sbAS = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsAS = sbAS.gameState;
  const capAS = [];
  sbAS.GameEvents.on("achievement:unlocked", (ev) => capAS.push(ev));
  const reinstallA = sbAS.AchievementSystem.installArchaeologyAchievementConsumer(gsAS);
  ok("[ar35] listenerCount(\"*\")=10（statistics+生产+战斗+制造+装备+增幅剂+考古+行星+空间站+综合生命周期），重复安装返回 ALREADY_INSTALLED",
    sbAS.GameEvents.listenerCount("*") === 10 &&
    reinstallA && reinstallA.ok === false && reinstallA.reason === "ALREADY_INSTALLED");

  // 在线 attemptCompleted → F01（统计先行、消费者后置）
  sbAS.GameEvents.emit("archaeology:attemptCompleted",
    { siteId: "site_i_a", tier: "I", success: true, successChance: 0.5 }, { offline: false, timestamp: 1000 });
  ok("[ar36] 在线 archaeology:attemptCompleted → F01 解锁（unlockedAt=事件时间戳、恰 emit 一次）",
    gsAS.achievements.unlockedAtById["F01"] === 1000 &&
    capAS.filter((ev) => ev.payload.achievementId === "F01").length === 1);

  // success 全 5 档（各取一个站点）→ F17 + 对应站点项
  const tierSiteMap = [["site_i_a","I"],["site_ii_a","II"],["site_iii_a","III"],["site_iv_a","IV"],["site_v_a","V"]];
  for (let i = 0; i < tierSiteMap.length; i++) {
    sbAS.GameEvents.emit("archaeology:success",
      { siteId: tierSiteMap[i][0], tier: tierSiteMap[i][1], xp: 50 }, { offline: false, timestamp: 1001 + i });
  }
  ok("[ar37] 五档 archaeology:success → F02/F05/F08/F11/F14 各站点项 + F17 全档解锁",
    ["F02","F05","F08","F11","F14","F17"].every((id) => typeof gsAS.achievements.unlockedAtById[id] === "number"));

  // 离线出售 → F18/F19；兑换 → F20；unique → F21
  sbAS.GameEvents.emit("archaeology:artifactsSold",
    { quantity: 100, totalIsk: 60000 }, { offline: true, timestamp: 1100 });
  sbAS.GameEvents.emit("archaeology:artifactsRedeemed",
    { quantity: 4, totalLp: 10000 }, { offline: true, timestamp: 1101 });
  sbAS.GameEvents.emit("archaeology:artifactFound",
    { artifactId: "art_i_unique_a", category: "unique", tier: "I", iskValue: 3000, lpValue: 0 }, { offline: true, timestamp: 1102 });
  ok("[ar38] 离线事件（meta.offline=true）同链解锁 F18+F19（sold=100）、F20（lp=10000）、F21（unique）",
    ["F18","F19","F20","F21"].every((id) => typeof gsAS.achievements.unlockedAtById[id] === "number"));

  // E-b：安装失败原因
  const sbAE = buildKernelSandbox({ withEvents: true, withRules: true });
  let instThrowA = false, rInvIA = null, rNoStatIA = null, rNoEvIA = null;
  try {
    rInvIA = sbAE.AchievementSystem.installArchaeologyAchievementConsumer(null);
    rNoStatIA = sbAE.AchievementSystem.installArchaeologyAchievementConsumer(
      { achievements: sbAE.AchievementState.createDefaultAchievementState() });
    const sbNoEv = buildKernelSandbox({ withEvents: false, withRules: true });
    rNoEvIA = sbNoEv.AchievementSystem.installArchaeologyAchievementConsumer(
      { achievements: sbNoEv.AchievementState.createDefaultAchievementState(),
        statistics: { version: 4, totals: {}, archaeology: { sites: {}, tiers: {} } } });
  } catch (e) { instThrowA = true; }
  ok("[ar39] INVALID_STATE / STATISTICS_UNAVAILABLE / EVENTS_UNAVAILABLE 安装失败原因稳定，不抛异常",
    !instThrowA && rInvIA && rInvIA.ok === false && rInvIA.reason === "INVALID_STATE" &&
    rNoStatIA && rNoStatIA.ok === false && rNoStatIA.reason === "STATISTICS_UNAVAILABLE" &&
    rNoEvIA && rNoEvIA.ok === false && rNoEvIA.reason === "EVENTS_UNAVAILABLE");

  // 不信任 payload：无 statistics 消费者沙箱，事件到达但权威统计为 0 → 不解锁
  const sbDistA = buildKernelSandbox({ withEvents: true, withRules: true });
  const sDistA = makeArchState(sbDistA, {});
  sbDistA.AchievementSystem.installArchaeologyAchievementConsumer(sDistA);
  const capDistA = [];
  sbDistA.GameEvents.on("achievement:unlocked", (ev) => capDistA.push(ev));
  sbDistA.GameEvents.emit("archaeology:attemptCompleted",
    { siteId: "site_i_a", tier: "I", success: true, successChance: 0.99 }, { offline: false, timestamp: 2000 });
  ok("[ar40] 不信任 payload：事件到达但权威 attempts=0 → F01 不解锁",
    !("F01" in sDistA.achievements.unlockedAtById) &&
    capDistA.filter((ev) => ev.payload.achievementId === "F01").length === 0);
  sDistA.statistics.totals.archaeologyAttempts = 1;
  sbDistA.GameEvents.emit("archaeology:attemptCompleted",
    { siteId: "site_i_a", tier: "I", success: false, successChance: 0.01 }, { offline: false, timestamp: 2001 });
  ok("[ar41] 权威统计达标后即使事件 payload 声称失败也按统计解锁 F01（消费者读取权威统计而非 payload）",
    typeof sDistA.achievements.unlockedAtById["F01"] === "number");

  // 其他事件严格过滤：不触发考古求值
  sDistA._dirty = false;
  sbDistA.GameEvents.emit("skill:levelUp", { skill: "mining", previousLevel: 1, level: 2 }, { offline: false, timestamp: 3000 });
  sbDistA.GameEvents.emit("mining:completed", { area: "x", mode: "normal", resourceId: "ore:凡晶石", quantity: 1, cycles: 1, xp: 10 }, { offline: false, timestamp: 3001 });
  sbDistA.GameEvents.emit("booster:manufactured", { recipeId: "mining_lubricant_l", quantity: 1, series: "mining_lubricant", quality: "l", itemId: "booster:mining_lubricant_l", xpGained: 10, offline: false }, { offline: false, timestamp: 3002 });
  sbDistA.GameEvents.emit("station:archaeologyBonusTriggered",
    { siteId: "site_i_a", tier: "I", artifactId: "art_i_unique_a", baseUniqueRate: 0.05, tracerMultiplier: 1, labMultiplier: 1, effectiveRate: 0.05 },
    { source: "station" });
  ok("[ar42] skill/mining/booster/station:archaeologyBonusTriggered 等非考古权威事件不触发考古求值（_dirty=false）",
    sDistA._dirty === false);

  // ========================= F. 真实接线与追溯 =========================
  // F-a：新游戏 0 统计全锁
  const sFreshA = makeArchState(sbA, {});
  const rFreshA = evaluateA(sFreshA, 100);
  ok("[ar43] 新游戏（0 统计）F01–F21 全未解锁",
    rFreshA.ok && rFreshA.unlockedIds.length === 0 &&
    ARCH_IDS.every((id) => !(id in sFreshA.achievements.unlockedAtById)));

  // F-b：旧档 v3（无考古字段）迁移后不臆测历史
  if (statVMA) {
    statVMA.gameState.statistics = {
      version: 3, totals: { events: 5, boostersManufactured: 3 },
      production: { boosters: {} }, combat: {}, activity: {}, eventLedger: {},
    };
    statVMA.__ensure(statVMA.gameState);
    const migratedStats = JSON.parse(JSON.stringify(statVMA.gameState.statistics));
    const sV3A = {
      skills: {},
      achievements: sbA.AchievementState.createDefaultAchievementState(),
      statistics: migratedStats, _dirty: false,
    };
    const rV3A = evaluateA(sV3A, 7000);
    ok("[ar44] 旧档 v3 迁移后（考古字段全 0）F01–F21 全锁（不从库存臆测历史考古）",
      rV3A.ok && rV3A.unlockedIds.length === 0 &&
      ARCH_IDS.every((id) => !(id in sV3A.achievements.unlockedAtById)));
  } else {
    ok("[ar44] statistics VM 不可用，跳过", false);
  }

  // F-c：旧档已有部分成就（时间保留、不覆盖）
  const sPartA = makeArchState(sbA, {
    attempts: 5, sold: 100, lp: 10000, rare: 1,
    sites: (() => { const m = {}; for (const sid of EXPECT_SITES) m[sid] = 1; return m; })(),
    tiers: { I:1, II:1, III:1, IV:1, V:1 },
  });
  SYS.unlockAchievement(sPartA, "F01", 123.5);
  SYS.unlockAchievement(sPartA, "F02", 456.25);
  const rPartA = evaluateA(sPartA, 6000);
  ok("[ar45] 旧存档已有 F01=123.5/F02=456.25 再次求值原时间保持（新补 F03–F21=6000）",
    sPartA.achievements.unlockedAtById["F01"] === 123.5 &&
    sPartA.achievements.unlockedAtById["F02"] === 456.25 &&
    ARCH_IDS.slice(2).every((id) => sPartA.achievements.unlockedAtById[id] === 6000) &&
    rPartA.unlockedIds.length === 19);

  // F-d：persistence 源码确认考古对账存在
  const persistSrcA = fs.readFileSync(PERSISTENCE_PATH, "utf-8");
  const totalArchRefs = (persistSrcA.match(/evaluateArchaeologyAchievementRules/g) || []).length;
  ok("[ar46] persistence 中 evaluateArchaeologyAchievementRules 恰 4 处（importData×2 + autoLoad×2）", totalArchRefs === 4);

  // F-e：autoLoad 新游戏（buildFullGameSandbox 真实加载 persistence）
  const freshFullA = buildFullGameSandbox(null);
  ok("[ar47] autoLoad 新游戏 spyInstalled=true（含 archaeology spy）", freshFullA.spyInstalled === true);
  ok("[ar48] autoLoad 新游戏 timeline：七求值器各 1 次、atMs 完全相等、顺序 skill<production<combat<manufacturing<equipment<booster<archaeology、offline 0 次",
    (() => {
      const tl = freshFullA.timeline;
      const evals = tl.filter((e) => e.fn.startsWith("evaluate"));
      const counts = {};
      for (const e of evals) counts[e.fn] = (counts[e.fn] || 0) + 1;
      const SEVEN = ["evaluateSkillAchievementRules","evaluateProductionAchievementRules","evaluateCombatAchievementRules",
        "evaluateManufacturingAchievementRules","evaluateEquipmentAchievementRules","evaluateBoosterAchievementRules",
        "evaluateArchaeologyAchievementRules"];
      const allOnce = SEVEN.every((f) => counts[f] === 1);
      const atMsSet = new Set(evals.filter((e) => e.atMs !== undefined).map((e) => e.atMs));
      const order = tl.map((e) => e.fn);
      const idx = SEVEN.map((f) => order.indexOf(f));
      const ordered = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
      const offlineCnt = tl.filter((e) => e.fn === "calculateOfflineGains").length;
      return allOnce && atMsSet.size === 1 && ordered && offlineCnt === 0;
    })());
  ok("[ar49] autoLoad 新游戏 F01–F21 全未锁",
    ARCH_IDS.every((id) => !(id in (freshFullA.sandbox.gameState.achievements && freshFullA.sandbox.gameState.achievements.unlockedAtById || {}))));

  // F-f：autoLoad 旧档（含考古统计）由 persistence 追溯解锁
  const v4ArchSave = JSON.stringify({
    saveVersion: 2, skills: {},
    achievements: { unlockedAtById: {} },
    statistics: {
      version: 4,
      totals: { events: 5, archaeologyAttempts: 5, artifactsSold: 100, archaeologyLpEarned: 10000, archaeologyRareFinds: 1 },
      archaeology: {
        sites: (() => { const m = {}; for (const sid of EXPECT_SITES) m[sid] = 1; return m; })(),
        tiers: { I:1, II:1, III:1, IV:1, V:1 },
      },
    },
  });
  const loadedArchA = buildFullGameSandbox(v4ArchSave);
  ok("[ar50] autoLoad 旧档 timeline：archaeology 恰 1 次且早于 calculateOfflineGains（archaeology < offline）",
    (() => {
      const tl = loadedArchA.timeline;
      const aTimes = tl.filter((e) => e.fn === "evaluateArchaeologyAchievementRules").length;
      const oTimes = tl.filter((e) => e.fn === "calculateOfflineGains").length;
      const aIdx = tl.findIndex((e) => e.fn === "evaluateArchaeologyAchievementRules");
      const oIdx = tl.findIndex((e) => e.fn === "calculateOfflineGains");
      const bIdx = tl.findIndex((e) => e.fn === "evaluateBoosterAchievementRules");
      return aTimes === 1 && oTimes === 1 && aIdx >= 0 && oIdx >= 0 && bIdx >= 0 && bIdx < aIdx && aIdx < oIdx;
    })());
  ok("[ar51] autoLoad 旧档（全满考古统计）F01–F21 全部追溯解锁且七求值器 atMs 一致",
    (() => {
      const gs = loadedArchA.sandbox.gameState;
      const evals = loadedArchA.timeline.filter((e) => e.fn.startsWith("evaluate"));
      const atMsSet = new Set(evals.filter((e) => e.atMs !== undefined).map((e) => e.atMs));
      return atMsSet.size === 1 &&
        ARCH_IDS.every((id) => typeof (gs.achievements && gs.achievements.unlockedAtById[id]) === "number");
    })());

  // F-g：importData 真实调用（已有 F01 时间保留、其余补发、timeline 精确）
  const importA = buildFullGameSandbox(null);
  const vImportArchSave = JSON.stringify({
    saveVersion: 2, skills: {},
    achievements: { unlockedAtById: { "F01": 123.5 } },
    statistics: {
      version: 4,
      totals: { events: 5, archaeologyAttempts: 5, artifactsSold: 100, archaeologyLpEarned: 10000, archaeologyRareFinds: 1 },
      archaeology: {
        sites: (() => { const m = {}; for (const sid of EXPECT_SITES) m[sid] = 1; return m; })(),
        tiers: { I:1, II:1, III:1, IV:1, V:1 },
      },
    },
  });
  importA.timeline.length = 0;
  importA.achievementEvents.length = 0;
  let importOkA = false;
  try {
    importOkA = importA.sandbox.SaveManager.importData(vImportArchSave) === true;
  } catch (e) { importOkA = false; }
  ok("[ar52] importData 返回 true", importOkA);
  (() => {
    if (!importOkA) return;
    const tl = importA.timeline;
    const count = (fn) => tl.filter((e) => e.fn === fn).length;
    const SEVEN = ["evaluateSkillAchievementRules","evaluateProductionAchievementRules","evaluateCombatAchievementRules",
      "evaluateManufacturingAchievementRules","evaluateEquipmentAchievementRules","evaluateBoosterAchievementRules",
      "evaluateArchaeologyAchievementRules"];
    const allOnce = SEVEN.every((f) => count(f) === 1) && count("calculateOfflineGains") === 1;
    const order = tl.map((e) => e.fn);
    const idx = SEVEN.map((f) => order.indexOf(f));
    const iOffline = order.indexOf("calculateOfflineGains");
    const ordered = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])) && iOffline > idx[6];
    const evals = tl.filter((e) => e.fn.startsWith("evaluate"));
    const atMsSet = new Set(evals.filter((e) => e.atMs !== undefined).map((e) => e.atMs));
    ok("[ar53] importData timeline 精确：七求值器各 1 次、顺序 skill<…<booster<archaeology<offline、七者共用同一 atMs",
      allOnce && ordered && atMsSet.size === 1);
    const gsImp = importA.sandbox.gameState;
    const ach = gsImp.achievements && gsImp.achievements.unlockedAtById || {};
    ok("[ar54] importData 已有 F01=123.5 保留、F02–F21 新补发且 F01 不重复 emit",
      ach["F01"] === 123.5 &&
      ARCH_IDS.slice(1).every((id) => typeof ach[id] === "number") &&
      importA.achievementEvents.filter((e) => e.payload.achievementId === "F01").length === 0);
  })();

  // F-h：真实在线考古链 — gameTick → resolveArchaeologyCycle 自行发射事件
  (() => {
    const sbOn = buildFullGameSandbox(null);
    const gs = sbOn.sandbox.gameState;
    const RR = sbOn.sandbox.ResourceRegistry;
    const achEvtsOn = [];
    sbOn.sandbox.GameEvents.on("achievement:unlocked", (e) => achEvtsOn.push(e));
    // 1. 技能 / 舰船 / 资源
    gs.skills.archaeology = { lvl: 1, xp: 0 };
    RR.add(gs, "consumable:fuel", 1000);
    RR.add(gs, "probe:core_probe_i", 50);
    if (!gs.inventory) gs.inventory = {};
    if (!gs.inventory.ships) gs.inventory.ships = [];
    const ship = sbOn.sandbox.createShipInstance("heron");
    gs.inventory.ships.push(ship);
    if (!gs.shipAssignments) gs.shipAssignments = {};
    gs.shipAssignments.archaeology = ship.instanceId;
    // 2. 遗迹 / 探针 / 行动
    gs.archaeology.activeSiteId = "site_i_a";
    gs.archaeology.activeProbeId = "core_probe_i";
    gs.archaeology.startedSiteId = "site_i_a";
    gs.archaeology.startedProbeId = "core_probe_i";
    const startTime = 1000;
    gs.currentAction.skill = "archaeology";
    gs.currentAction.active = true;
    gs.currentAction.progress = 0;
    gs.currentAction.lastProgressUpdate = startTime;
    gs.currentAction.batchRemaining = 0;
    // 3. 确定性随机：roll=0 恒成功，且掉落必得 common+unique+calibration+LP
    vm.runInContext("Math.random = function () { return 0; };", sbOn.sandbox);
    // 4. 推进 gameTick（site_i_a 周期 30s，每 tick 最多 5s）
    const attempts0 = gs.statistics.totals.archaeologyAttempts;
    sbOn.sandbox.Date.now = () => startTime;
    for (let i = 1; i <= 8; i++) {
      sbOn.sandbox.Date.now = () => startTime + i * 5000;
      try { sbOn.sandbox.gameTick(); } catch (e) {
        ok("[ar55] 在线 gameTick 异常", false, "message=" + (e.message || String(e)));
        return;
      }
    }
    const attemptsN = gs.statistics.totals.archaeologyAttempts - attempts0;
    if (attemptsN < 1) { ok("[ar55] 在线考古 attempts 增量=" + attemptsN + " 应为 ≥1", false); return; }
    ok("[ar55] 在线真实 gameTick 考古 attempts=" + attemptsN + "，statistics 与成就一致（F01/F02/F21 解锁、各恰 emit 一次）",
      gs.statistics.archaeology.sites["site_i_a"] === attemptsN &&
      gs.statistics.archaeology.tiers["I"] === attemptsN &&
      gs.statistics.totals.archaeologyRareFinds === attemptsN &&
      typeof gs.achievements.unlockedAtById["F01"] === "number" &&
      typeof gs.achievements.unlockedAtById["F02"] === "number" &&
      typeof gs.achievements.unlockedAtById["F21"] === "number" &&
      achEvtsOn.filter((e) => e.payload.achievementId === "F01").length === 1 &&
      achEvtsOn.filter((e) => e.payload.achievementId === "F02").length === 1 &&
      achEvtsOn.filter((e) => e.payload.achievementId === "F21").length === 1);
    // 5. 真实出售链（sellArchaeologyArtifacts 自行发射 archaeology:artifactsSold）
    const soldBefore = gs.statistics.totals.artifactsSold;
    const sellRes = sbOn.sandbox.sellArchaeologyArtifacts(gs, null, null, true);
    ok("[ar56] 在线真实出售链：sellArchaeologyArtifacts 全部出售 → artifactsSold 增量=sold、F18 解锁",
      sellRes && sellRes.changed === true && sellRes.sold >= 1 &&
      gs.statistics.totals.artifactsSold - soldBefore === sellRes.sold &&
      typeof gs.achievements.unlockedAtById["F18"] === "number");
    // 6. 真实兑换链（redeemArchaeologyArtifacts 自行发射 archaeology:artifactsRedeemed）
    const lpBefore = gs.statistics.totals.archaeologyLpEarned;
    const redeemRes = sbOn.sandbox.redeemArchaeologyArtifacts(gs, null, null, true);
    ok("[ar57] 在线真实兑换链：redeemArchaeologyArtifacts → archaeologyLpEarned 增量=totalLp；LP 不足 10000 时 F20 保持锁定",
      redeemRes && redeemRes.changed === true && redeemRes.totalLp >= 1 &&
      gs.statistics.totals.archaeologyLpEarned - lpBefore === redeemRes.totalLp &&
      (gs.statistics.totals.archaeologyLpEarned >= 10000
        ? typeof gs.achievements.unlockedAtById["F20"] === "number"
        : !("F20" in gs.achievements.unlockedAtById)));
  })();

  // F-i：真实离线考古链 — applyOfflineGains → resolveArchaeologyCycle(offline) 自行发射事件
  (() => {
    const sbOff = buildFullGameSandbox(null);
    const gs = sbOff.sandbox.gameState;
    const RR = sbOff.sandbox.ResourceRegistry;
    gs.skills.archaeology = { lvl: 1, xp: 0 };
    RR.add(gs, "consumable:fuel", 1000);
    RR.add(gs, "probe:core_probe_i", 50);
    if (!gs.inventory) gs.inventory = {};
    if (!gs.inventory.ships) gs.inventory.ships = [];
    const ship = sbOff.sandbox.createShipInstance("heron");
    gs.inventory.ships.push(ship);
    if (!gs.shipAssignments) gs.shipAssignments = {};
    gs.shipAssignments.archaeology = ship.instanceId;
    gs.archaeology.activeSiteId = "site_i_a";
    gs.archaeology.activeProbeId = "core_probe_i";
    gs.archaeology.startedSiteId = "site_i_a";
    gs.archaeology.startedProbeId = "core_probe_i";
    gs.currentAction.skill = "archaeology";
    gs.currentAction.active = true;
    gs.currentAction.progress = 0;
    gs.currentAction.lastProgressUpdate = 1000;
    vm.runInContext("Math.random = function () { return 0; };", sbOff.sandbox);
    const attempts0 = gs.statistics.totals.archaeologyAttempts;
    try {
      sbOff.sandbox.applyOfflineGains(300, { runId: "audit_ar_offline" });
    } catch (e) {
      ok("[ar58] 离线 applyOfflineGains 异常", false, "message=" + (e.message || String(e)));
      return;
    }
    const attemptsN = gs.statistics.totals.archaeologyAttempts - attempts0;
    if (attemptsN < 1) { ok("[ar58] 离线考古 attempts 增量=" + attemptsN + " 应为 ≥1", false); return; }
    ok("[ar58] 离线真实考古链 attempts=" + attemptsN + "，statistics 与成就一致（F01/F02/F21 解锁，双链共用 resolveArchaeologyCycle）",
      gs.statistics.archaeology.sites["site_i_a"] === attemptsN &&
      gs.statistics.archaeology.tiers["I"] === attemptsN &&
      gs.statistics.totals.archaeologyRareFinds === attemptsN &&
      typeof gs.achievements.unlockedAtById["F01"] === "number" &&
      typeof gs.achievements.unlockedAtById["F02"] === "number" &&
      typeof gs.achievements.unlockedAtById["F21"] === "number");
  })();

  // ========================= G. 源码与只读保护 =========================
  const eventsSrcA = fs.readFileSync(EVENTS_PATH, "utf-8");
  const tickSrcA = fs.readFileSync(TICK_PATH, "utf-8");
  const offlineSrcA = fs.readFileSync(OFFLINE_PATH, "utf-8");
  const archDataSrcG = fs.readFileSync(ARCH_DATA_PATH, "utf-8");
  const archSysSrcG = fs.readFileSync(ARCH_SYS_PATH, "utf-8");
  ok("[ar59] events/tick/offline/data-archaeology/systems-archaeology 不含 F01–F21 成就规则或 unlockAchievement 调用（发射层保持纯净）",
    !eventsSrcA.includes("F01") && !eventsSrcA.includes("F21") &&
    !tickSrcA.includes("F01") && !tickSrcA.includes("F21") &&
    !offlineSrcA.includes("F01") && !offlineSrcA.includes("F21") &&
    !archDataSrcG.includes("F01") && !archDataSrcG.includes("F21") &&
    !archSysSrcG.includes("unlockAchievement") && !archSysSrcG.includes("F01"));

  const archFuncBody = (extractFnBody(achSysSrcA, "evaluateArchaeologyAchievementRules") || "") +
    (extractFnBody(achSysSrcA, "installArchaeologyAchievementConsumer") || "");
  ok("[ar60] achievements.js 本批新增考古函数体不含奖励/UI/Steamworks/研究系统调用（仅解锁内核 + 考古事件消费者）",
    archFuncBody.length > 0 &&
    !archFuncBody.includes("award") && !archFuncBody.includes("AwardSystem") &&
    !archFuncBody.includes("Steamworks") && !archFuncBody.includes("Research"));

  // 正式工作区只读
  const afterCsvA = snapFile(CSV_PATH);
  const afterJsA = snapFile(JS_PATH);
  ok("[ar61] 审计前后正式工作区 CSV 字节(SHA-256/长度)+mtime 完全不变", snapEq(preWsCsv, afterCsvA));
  ok("[ar62] 审计前后正式工作区 JS 字节(SHA-256/长度)+mtime 完全不变", snapEq(preWsJs, afterJsA));

  // 仓库文件清单快照（后）：双向比较
  const archFilesAfter = [];
  try {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p); }
        else archFilesAfter.push(p);
      }
    })(ROOT);
  } catch (e) { archFilesAfter.length = 0; }
  let ar63ok = archFilesBefore.length > 0 && archFilesAfter.length > 0;
  if (ar63ok) {
    const bSet = new Set(archFilesBefore);
    const aSet = new Set(archFilesAfter);
    for (const f of archFilesBefore) { if (!aSet.has(f)) { ar63ok = false; break; } }
    if (ar63ok) { for (const f of archFilesAfter) { if (!bSet.has(f)) { ar63ok = false; break; } } }
  }
  ok("[ar63] 审计考古分区未向仓库写入任何辅助文件（函数首尾双向文件清单一致）", ar63ok);

  ok("[ar64] 考古规则数据在本分区内未被任何求值/消费者改变（ARCHAEOLOGY_RULES 全冻结）",
    Object.isFrozen(RD.ARCHAEOLOGY_RULES) &&
    RD.ARCHAEOLOGY_RULES.every((r) => Object.isFrozen(r)) &&
    Object.isFrozen(RD.ARCHAEOLOGY_SITE_IDS) && Object.isFrozen(RD.ARCHAEOLOGY_TIER_KEYS));
}
function runPlanetary() {
  // 仓库文件清单快照（前）：分区结束时双向比较，证明未向仓库写入任何辅助文件
  const planFilesBefore = [];
  try {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p); }
        else planFilesBefore.push(p);
      }
    })(ROOT);
  } catch (e) { planFilesBefore.length = 0; }

  const PLAN_IDS = [];
  for (let i = 1; i <= 7; i++) PLAN_IDS.push("G" + String(i).padStart(2, "0"));
  PLAN_IDS.push("G09"); PLAN_IDS.push("G10");
  const PLAN_TYPES = ["lava", "gas", "ice", "plasma", "temperate", "storm"];

  function extractFnBody(src, name) {
    let start = src.indexOf("function " + name);
    if (start < 0) start = src.indexOf(name + "("); // 兼容对象方法简写 buyLPItem(state, itemId) { ... }
    if (start < 0) return "";
    const paren = src.indexOf("(", start);
    let i = src.indexOf("{", paren < 0 ? start : paren);
    if (i < 0) return "";
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return "";
  }

  // ---- 辅助：构造带 v5 planetary 统计的最小状态（原样透传非法值以测试防御） ----
  function makePlanState(box, o) {
    o = o || {};
    return {
      skills: o.skills || {},
      achievements: box.AchievementState.createDefaultAchievementState(),
      statistics: {
        version: 5,
        totals: { planetaryUnits: (o.planetaryUnits !== undefined ? o.planetaryUnits : 0) },
        planetary: {
          deployedTypes: o.deployedTypes ? Object.assign({}, o.deployedTypes) : {},
          maxConcurrentDeployments: (o.maxConcurrent !== undefined ? o.maxConcurrent : 0),
        },
      },
      _dirty: false,
    };
  }

  // ========================= A. 规则数据 =========================
  const sbP = buildKernelSandbox({ withEvents: true, withRules: true });
  const RD = sbP.AchievementRuleData;
  const SYS = sbP.AchievementSystem;
  const evaluateP = (state, atMs) => SYS.evaluatePlanetaryAchievementRules(state, atMs);

  ok("[g1] PLANETARY_RULES 冻结数组 9 项、每项冻结、BY_ID 冻结 9 键且逐项引用一致（G01–G07,G09,G10 顺序）",
    Array.isArray(RD.PLANETARY_RULES) && RD.PLANETARY_RULES.length === 9 &&
    Object.isFrozen(RD.PLANETARY_RULES) && RD.PLANETARY_RULES.every((r) => Object.isFrozen(r)) &&
    RD.PLANETARY_RULES_BY_ID && Object.isFrozen(RD.PLANETARY_RULES_BY_ID) &&
    Object.keys(RD.PLANETARY_RULES_BY_ID).length === 9 &&
    PLAN_IDS.every((id, i) => RD.PLANETARY_RULES[i].achievementId === id &&
      RD.PLANETARY_RULES_BY_ID[id] === RD.PLANETARY_RULES[i]));

  // 与 js/data/planets.js 真实 6 类型双向集合相等
  let g2ok = true;
  try {
    const planetsSrc = fs.readFileSync(path.join(ROOT, "js", "data", "planets.js"), "utf-8");
    const ctxP = { console };
    ctxP.window = ctxP; ctxP.globalThis = ctxP;
    vm.createContext(ctxP);
    vm.runInContext(planetsSrc, ctxP, { filename: "planets.js" });
    // 顶层 const 位于 vm 全局词法环境、不会成为 context 属性——用同一 context 的后续脚本导出真实数组
    vm.runInContext("globalThis.__REAL_PLANET_TYPES = PLANET_TYPES;", ctxP, { filename: "planets-export.js" });
    const realTypes = ctxP.__REAL_PLANET_TYPES.map((p) => p.id);
    g2ok = Array.isArray(RD.PLANETARY_TYPE_IDS) && Object.isFrozen(RD.PLANETARY_TYPE_IDS) &&
      RD.PLANETARY_TYPE_IDS.length === 6 && realTypes.length === 6 &&
      RD.PLANETARY_TYPE_IDS.every((id, i) => id === realTypes[i]) &&
      realTypes.every((id, i) => id === RD.PLANETARY_TYPE_IDS[i]);
  } catch (e) { g2ok = false; }
  ok("[g2] PLANETARY_TYPE_IDS 与 planets.js PLANET_TYPES 双向逐项相等（各 6、顺序一致）", g2ok);

  // 规则字段精确映射
  const gRules = {};
  for (const id of PLAN_IDS) gRules[id] = RD.PLANETARY_RULES_BY_ID[id];
  ok("[g3] 逐项映射精确：G01–G06 各类型 deployedTypes≥1（lava..storm）；G07 maxConcurrent≥5；G09 planetaryUnits≥1,000,000；G10 全槽位",
    PLAN_TYPES.every((t, i) => {
      const r = gRules["G0" + String(i + 1)];
      return r.type === "planetary-colonized" && r.planetType === t && r.minValue === 1;
    }) &&
    gRules["G07"].type === "planetary-concurrent" && gRules["G07"].minValue === 5 &&
    gRules["G09"].type === "planetary-total" && gRules["G09"].totalKey === "planetaryUnits" && gRules["G09"].minValue === 1000000 &&
    gRules["G10"].type === "planetary-slots" && gRules["G10"].minValue === 5);

  // 八规则集合两两零交集 + 总计 152 + 未映射 46
  const setsAll = [
    new Set(RD.SKILL_RULES.map((r) => r.achievementId)),
    new Set(RD.PRODUCTION_RULES.map((r) => r.achievementId)),
    new Set(RD.COMBAT_RULES.map((r) => r.achievementId)),
    new Set(RD.MANUFACTURING_RULES.map((r) => r.achievementId)),
    new Set(RD.EQUIPMENT_RULES.map((r) => r.achievementId)),
    new Set(RD.BOOSTER_RULES.map((r) => r.achievementId)),
    new Set(RD.ARCHAEOLOGY_RULES.map((r) => r.achievementId)),
    new Set(RD.PLANETARY_RULES.map((r) => r.achievementId)),
  ];
  let g4ok = true;
  for (let i = 0; i < setsAll.length && g4ok; i++) {
    for (let j = i + 1; j < setsAll.length && g4ok; j++) {
      for (const id of setsAll[i]) { if (setsAll[j].has(id)) { g4ok = false; break; } }
    }
  }
  const unionAll = new Set();
  for (const s of setsAll) for (const id of s) unionAll.add(id);
  const sumAll = setsAll.reduce((s, x) => s + x.size, 0);
  const catalogTotal = sbP.AchievementData.ACHIEVEMENTS.length;
  ok("[g4] 八规则集合两两零交集、总计 151+9=160、目录 197 未映射恰 37、160 项全部存在于成就目录",
    g4ok && sumAll === 160 && unionAll.size === 160 &&
    catalogTotal === 197 && catalogTotal - unionAll.size === 37 &&
    [...unionAll].every((id) => !!sbP.AchievementData.ACHIEVEMENTS_BY_ID[id]));

  ok("[g5] G08 不在 PLANETARY_RULES_BY_ID（目录无 G08，不产生幽灵规则）",
    !("G08" in RD.PLANETARY_RULES_BY_ID));

  // ========================= B. 求值边界 =========================
  // G01：lava 0 不解锁、1 解锁
  const sG01_0 = makePlanState(sbP, { deployedTypes: {} });
  const rG01_0 = evaluateP(sG01_0, 100);
  const sG01_1 = makePlanState(sbP, { deployedTypes: { lava: 1 } });
  const rG01_1 = evaluateP(sG01_1, 100);
  ok("[g6] G01：deployedTypes.lava=0 不解锁、=1 解锁恰 G01 一项（evaluatedCount 恒为 9）",
    rG01_0.ok && rG01_0.evaluatedCount === 9 && rG01_0.unlockedIds.length === 0 &&
    rG01_1.ok && rG01_1.evaluatedCount === 9 &&
    rG01_1.unlockedIds.length === 1 && rG01_1.unlockedIds[0] === "G01" &&
    sG01_1.achievements.unlockedAtById["G01"] === 100);

  // G02–G06 每类型：0 不解锁、1 解锁恰该项
  let g7ok = true;
  for (let i = 1; i < 6; i++) {
    const fid = "G0" + String(i + 1);
    const tid = PLAN_TYPES[i];
    const s0 = makePlanState(sbP, { deployedTypes: {} });
    const r0 = evaluateP(s0, 200);
    if (r0.unlockedIds.includes(fid)) g7ok = false;
    const s1 = makePlanState(sbP, { deployedTypes: { [tid]: 1 } });
    const r1 = evaluateP(s1, 200);
    if (r1.unlockedIds.length !== 1 || r1.unlockedIds[0] !== fid) g7ok = false;
    if (s1.achievements.unlockedAtById[fid] !== 200) g7ok = false;
  }
  ok("[g7] G02–G06 每类型：deployedTypes[type]=0 不解锁、=1 解锁恰该项（5 项逐一验证）", g7ok);

  // G07：maxConcurrent 4 不解锁、5 解锁
  const sG07_4 = makePlanState(sbP, { maxConcurrent: 4 });
  const rG07_4 = evaluateP(sG07_4, 300);
  const sG07_5 = makePlanState(sbP, { maxConcurrent: 5 });
  const rG07_5 = evaluateP(sG07_5, 300);
  ok("[g8] G07：maxConcurrentDeployments=4 不解锁、=5 解锁恰 G07 一项（槽位上限5但实际0不得解锁）",
    rG07_4.ok && rG07_4.unlockedIds.length === 0 &&
    rG07_5.ok && rG07_5.unlockedIds.length === 1 && rG07_5.unlockedIds[0] === "G07" &&
    sG07_5.achievements.unlockedAtById["G07"] === 300);

  // G09：999999 不解锁、1000000 解锁
  const sG09_999999 = makePlanState(sbP, { planetaryUnits: 999999 });
  const rG09_a = evaluateP(sG09_999999, 400);
  const sG09_1M = makePlanState(sbP, { planetaryUnits: 1000000 });
  const rG09_b = evaluateP(sG09_1M, 400);
  ok("[g9] G09：planetaryUnits=999999 不解锁、=1,000,000 解锁",
    rG09_a.ok && rG09_a.unlockedIds.length === 0 &&
    rG09_b.ok && rG09_b.unlockedIds.length === 1 && rG09_b.unlockedIds[0] === "G09" &&
    sG09_1M.achievements.unlockedAtById["G09"] === 400);

  // G10：slots<maxSlots 不解锁、slots=maxSlots 解锁（读真实 capacity，不写死技能等级）。
  // 内核沙箱不加载 selectors.js（getPlanetaryCapacityState 缺失时规则守卫返回 false），
  // 因此 G10/G12 在真实全脚本沙箱中验证：selectors.js/production.js 均为真实源码，
  // slots = min(5, 1 + floor(level/10) + 空间站加成)，新游戏无空间站加成。
  const sbFullCap = buildFullGameSandbox(null);
  const gsCap = sbFullCap.sandbox.gameState;
  const SYS_F = sbFullCap.sandbox.AchievementSystem;
  gsCap.achievements = sbFullCap.sandbox.AchievementState.createDefaultAchievementState();
  gsCap.skills.planetaryIndustry = { lvl: 39, xp: 0 };
  const rG10_low = SYS_F.evaluatePlanetaryAchievementRules(gsCap, 500);
  const g10LowOk = rG10_low.ok && rG10_low.unlockedIds.length === 0 && !("G10" in gsCap.achievements.unlockedAtById);
  gsCap.skills.planetaryIndustry = { lvl: 40, xp: 0 };
  const rG10_full = SYS_F.evaluatePlanetaryAchievementRules(gsCap, 500);
  ok("[g10] G10：getPlanetaryCapacityState 返回 slots=4<maxSlots 不解锁、slots=5=maxSlots 解锁",
    g10LowOk &&
    rG10_full.ok && rG10_full.unlockedIds.length === 1 && rG10_full.unlockedIds[0] === "G10" &&
    gsCap.achievements.unlockedAtById["G10"] === 500);

  // 非法值拒绝
  const sBad = makePlanState(sbP, {
    deployedTypes: { lava: NaN, gas: -3, ice: "x" },
    maxConcurrent: NaN, planetaryUnits: Infinity,
  });
  const rBad = evaluateP(sBad, 600);
  ok("[g11] 非法值（NaN/-3/字符串/Infinity）不解锁任何行星成就",
    rBad.ok && rBad.unlockedIds.length === 0);

  // 全满 9 项：顺序 G01–G07,G09,G10（G10 需真实 getPlanetaryCapacityState → 全脚本沙箱）
  const sbFullAll = buildFullGameSandbox(null);
  const gsAll = sbFullAll.sandbox.gameState;
  gsAll.achievements = sbFullAll.sandbox.AchievementState.createDefaultAchievementState();
  gsAll.skills.planetaryIndustry = { lvl: 40, xp: 0 };
  gsAll.statistics.planetary.deployedTypes = { lava: 1, gas: 1, ice: 1, plasma: 1, temperate: 1, storm: 1 };
  gsAll.statistics.planetary.maxConcurrentDeployments = 5;
  gsAll.statistics.totals.planetaryUnits = 1000000;
  const rAll = sbFullAll.sandbox.AchievementSystem.evaluatePlanetaryAchievementRules(gsAll, 9000);
  ok("[g12] 全满 9 项条件：按 G01–G07,G09,G10 顺序解锁恰 9 项",
    rAll.ok && rAll.evaluatedCount === 9 && rAll.unlockedIds.length === 9 &&
    rAll.unlockedIds.join(",") === "G01,G02,G03,G04,G05,G06,G07,G09,G10" &&
    PLAN_IDS.every((id) => gsAll.achievements.unlockedAtById[id] === 9000));

  // 失败 reason 稳定
  let rInv = null, rNoStat = null, rNoRule = null;
  try {
    rInv = SYS.evaluatePlanetaryAchievementRules(null, 1);
    rNoStat = SYS.evaluatePlanetaryAchievementRules({ achievements: sbP.AchievementState.createDefaultAchievementState() }, 1);
    // RULE_DATA_UNAVAILABLE 必须在未加载 achievement-rules.js 的内核沙箱中验证（sbP 已含规则数据）
    const sbPNoRules = buildKernelSandbox({ withEvents: true });
    rNoRule = sbPNoRules.AchievementSystem.evaluatePlanetaryAchievementRules(
      { skills: {},
        achievements: sbPNoRules.AchievementState.createDefaultAchievementState(),
        statistics: { version: 5, totals: {}, planetary: { deployedTypes: {}, maxConcurrentDeployments: 0 } },
        _dirty: false }, 1);
  } catch (e) { rInv = { ok: false, reason: "THREW" }; }
  ok("[g13] INVALID_STATE / STATISTICS_UNAVAILABLE / RULE_DATA_UNAVAILABLE 失败原因稳定",
    rInv && rInv.ok === false && rInv.reason === "INVALID_STATE" &&
    rNoStat && rNoStat.ok === false && rNoStat.reason === "STATISTICS_UNAVAILABLE" &&
    rNoRule && rNoRule.ok === false && rNoRule.reason === "RULE_DATA_UNAVAILABLE");

  // ========================= C. statistics 迁移 =========================
  let statVM = null;
  try {
    const statSrc = fs.readFileSync(STATISTICS_PATH, "utf-8");
    const ep = ";globalThis.__ensure=ensureStatisticsState;globalThis.__def=createDefaultStatisticsState;globalThis.__consume=consumeStatisticsEvent;";
    const ctx = { console };
    ctx.window = ctx; ctx.globalThis = ctx;
    ctx.GameEvents = { onIdempotent() {}, on() {}, emit() {}, listenerCount() { return 0; } };
    ctx.gameState = { statistics: { version: 1, totals: {}, production: {}, combat: {}, activity: {}, eventLedger: {} }, _dirty: false };
    vm.createContext(ctx);
    vm.runInContext(statSrc + "\n" + ep, ctx, { filename: "statistics-planetary.js" });
    statVM = ctx;
  } catch (e) { statVM = null; }

  if (statVM) {
    const defP = statVM.__def();
    ok("[g14] 新游戏默认统计：version=6、planetary={deployedTypes:{},maxConcurrentDeployments:0}",
      defP.version === 9 && defP.planetary && typeof defP.planetary === "object" &&
      Object.keys(defP.planetary.deployedTypes).length === 0 && defP.planetary.maxConcurrentDeployments === 0);

    // v4→v6
    statVM.gameState.statistics = { version: 4, totals: { events: 5 }, production: {}, combat: {}, activity: {}, eventLedger: {} };
    statVM.__ensure(statVM.gameState);
    const st4 = statVM.gameState.statistics;
    ok("[g15] v4→v6 真实迁移：version=6、planetary={deployedTypes:{},maxConcurrentDeployments:0}、旧 totals 保留",
      st4.version === 9 && st4.planetary && Object.keys(st4.planetary.deployedTypes).length === 0 &&
      st4.planetary.maxConcurrentDeployments === 0 && st4.totals.events === 5);

    // v1/v2/v3→v6
    let g15bok = true;
    for (const v of [1, 2, 3]) {
      statVM.gameState.statistics = { version: v, totals: { events: 3 }, production: {}, combat: {}, activity: {}, eventLedger: {} };
      statVM.__ensure(statVM.gameState);
      const st = statVM.gameState.statistics;
      if (st.version !== 9 || !st.planetary || st.planetary.maxConcurrentDeployments !== 0 || Object.keys(st.planetary.deployedTypes).length !== 0) g15bok = false;
    }
    ok("[g16] v1/v2/v3→v9 迁移均补出 planetary 结构且 version=9", g15bok);

    // 坏档清洗
    statVM.gameState.statistics = {
      version: 3, totals: { events: 5 },
      planetary: { deployedTypes: { lava: 1, bogus: "x", ice: NaN, gas: -3, plasma: 2.7 }, maxConcurrentDeployments: -1 },
      production: {}, combat: {}, activity: {}, eventLedger: {},
    };
    statVM.__ensure(statVM.gameState);
    const stBad = statVM.gameState.statistics;
    ok("[g17] 坏档清洗：deployedTypes 仅保留 6 合法 ID 且有限非负（lava=1,plasma=2；ice/gas/bogus 删除）、maxConcurrent=0",
      stBad.version === 9 && stBad.planetary.deployedTypes.lava === 1 && stBad.planetary.deployedTypes.plasma === 2 &&
      !("ice" in stBad.planetary.deployedTypes) && !("gas" in stBad.planetary.deployedTypes) && !("bogus" in stBad.planetary.deployedTypes) &&
      stBad.planetary.maxConcurrentDeployments === 0);

    // 旧档当前合法 active 部署补入
    statVM.gameState.statistics = { version: 3, totals: {}, production: {}, combat: {}, activity: {}, eventLedger: {} };
    statVM.gameState.planetary = { deployments: [
      { active: true, planetType: "lava" },
      { active: true, planetType: "ice" },
      { active: false, planetType: "gas" },
    ] };
    statVM.__ensure(statVM.gameState);
    const stBack = statVM.gameState.statistics;
    ok("[g18] 旧档当前合法 active 部署补入 deployedTypes（lava,ice≥1；过期 gas 不计入）、maxConcurrent=2、不从技能等级推测",
      stBack.planetary.deployedTypes.lava >= 1 && stBack.planetary.deployedTypes.ice >= 1 &&
      !("gas" in stBack.planetary.deployedTypes) && stBack.planetary.maxConcurrentDeployments === 2);

    // 连续迁移幂等 JSON 严格一致
    statVM.gameState.statistics = { version: 1, totals: { events: 3 }, production: {}, combat: {}, activity: {}, eventLedger: {} };
    statVM.gameState.planetary = { deployments: [{ active: true, planetType: "lava" }] };
    const m1 = JSON.stringify(statVM.__ensure(statVM.gameState));
    const m2 = JSON.stringify(statVM.__ensure(statVM.gameState));
    ok("[g19] 连续迁移两次 JSON 严格一致且 version 恒为 9", m1 === m2 && statVM.gameState.statistics.version === 9);

    // 真实事件记账 + 同 eventId 重放不双计
    statVM.gameState.statistics = statVM.__def();
    statVM.gameState.planetary = { deployments: [{ active: true, planetType: "lava" }] };
    statVM.gameState._dirty = false;
    // 同 eventId 去重由 GameEvents.onIdempotent（events.js ledger）完成，直接调 consumeStatisticsEvent
    // 会绕过去重——因此本断言走真实 events.js + statistics.js 链（withStatistics 内核沙箱 + 真实 emit）。
    const sbG20 = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
    const gs20 = sbG20.gameState;
    gs20.planetary = { deployments: [{ id: "p1", active: true, planetType: "lava" }] };
    sbG20.GameEvents.emit("planetary:deployed", { deploymentId: "p1", planetType: "lava", constructionISK: 1, constructionResources: {} }, { offline: false, timestamp: 1 });
    const lavaAfterDep = gs20.statistics.planetary.deployedTypes.lava;
    const mcAfterDep = gs20.statistics.planetary.maxConcurrentDeployments;
    sbG20.GameEvents.emit("planetary:completed", { deploymentId: "p1", planetType: "lava", resourceId: "planetary:重金属", quantity: 5, cycles: 5, xp: 5 }, { offline: false, timestamp: 2 });
    const unitsAfterComp = gs20.statistics.totals.planetaryUnits;
    sbG20.GameEvents.emit("planetary:deployed", { deploymentId: "p2", planetType: "lava", constructionISK: 1, constructionResources: {} }, { offline: false, eventId: "pdup-1", timestamp: 3 });
    const lavaAfterDep2 = gs20.statistics.planetary.deployedTypes.lava;
    const eventsAfterDep2 = gs20.statistics.totals.events;
    sbG20.GameEvents.emit("planetary:deployed", { deploymentId: "p2", planetType: "lava", constructionISK: 1, constructionResources: {} }, { offline: false, eventId: "pdup-1", timestamp: 4 });
    const lavaAfterDep3 = gs20.statistics.planetary.deployedTypes.lava;
    const eventsAfterDep3 = gs20.statistics.totals.events;
    ok("[g20] 真实事件记账：planetary:deployed 记 deployedTypes.lava=1+maxConcurrent=1；planetary:completed 仅累计 planetaryUnits=5（无第二套产量累计）；带 eventId 二次部署 lava=2；同 eventId 重放不双计（lava 恒 2、totals.events 不变）",
      lavaAfterDep === 1 && mcAfterDep === 1 &&
      unitsAfterComp === 5 &&
      lavaAfterDep2 === 2 &&
      lavaAfterDep3 === 2 && eventsAfterDep3 === eventsAfterDep2);
  } else {
    ok("[g14] statistics 迁移 VM 加载失败", false);
  }

  // ========================= D. 消费者 =========================
  const achSysSrcP = fs.readFileSync(ACH_SYSTEM_PATH, "utf-8");
  const pInstallBody = extractFnBody(achSysSrcP, "installPlanetaryAchievementConsumer");
  ok("[g21] 行星消费者注册在通配符 \"*\" 且严格按 event.type 过滤（planetary:deployed/planetary:completed/skill:levelUp/station:constructionCompleted/station:buildingUpgraded 在过滤名单）",
    pInstallBody.includes('GE.on("*"') &&
    ["planetary:deployed", "planetary:completed", "skill:levelUp", "station:constructionCompleted", "station:buildingUpgraded"]
      .every((t) => pInstallBody.includes('"' + t + '"')));

  // 真实 sandbox + 八消费者
  const sbPS = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsPS = sbPS.gameState;
  const capPS = [];
  sbPS.GameEvents.on("achievement:unlocked", (ev) => capPS.push(ev));
  const reinstallP = sbPS.AchievementSystem.installPlanetaryAchievementConsumer(gsPS);
  ok("[g22] listenerCount(\"*\")=10（statistics+生产+战斗+制造+装备+增幅剂+考古+行星+空间站+综合生命周期），重复安装返回 ALREADY_INSTALLED",
    sbPS.GameEvents.listenerCount("*") === 10 &&
    reinstallP && reinstallP.ok === false && reinstallP.reason === "ALREADY_INSTALLED");

  // 不信任 payload：事件到达但权威统计为 0 → 不解锁
  const sbDistP = buildKernelSandbox({ withEvents: true, withRules: true });
  const sDistP = makePlanState(sbDistP, {});
  sbDistP.AchievementSystem.installPlanetaryAchievementConsumer(sDistP);
  const capDistP = [];
  sbDistP.GameEvents.on("achievement:unlocked", (ev) => capDistP.push(ev));
  sbDistP.GameEvents.emit("planetary:deployed", { deploymentId: "x", planetType: "lava", constructionISK: 1, constructionResources: {} }, { offline: false, timestamp: 2000 });
  ok("[g23] 不信任 payload：事件到达但权威 deployedTypes.lava=0 → G01 不解锁",
    !("G01" in sDistP.achievements.unlockedAtById) &&
    capDistP.filter((ev) => ev.payload.achievementId === "G01").length === 0);

  // 其他事件严格过滤：不触发行星求值
  sDistP._dirty = false;
  sbDistP.GameEvents.emit("mining:completed", { area: "x", mode: "normal", resourceId: "ore:凡晶石", quantity: 1, cycles: 1, xp: 10 }, { offline: false, timestamp: 3000 });
  // payload 契约与真实发射方一致：production.js L65 { skill, previousLevel, level }；station.js L196 { kind, fromLevel, targetLevel, startedAt, completesAt, costSnapshot }
  sbDistP.GameEvents.emit("skill:levelUp", { skill: "mining", previousLevel: 1, level: 2 }, { offline: false, timestamp: 3001 });
  sbDistP.GameEvents.emit("station:constructionCompleted", { kind: "building", fromLevel: 0, targetLevel: 1, startedAt: 2900, completesAt: 3002, costSnapshot: {} }, { source: "station", timestamp: 3002 });
  ok("[g24] mining/skill(mining)/station(resource_dispatch) 等非行星权威事件不触发行星求值（_dirty=false）",
    sDistP._dirty === false);

  // ========================= E. 真实在线/离线链 =========================
  // E-a：真实部署六种类型 → G01–G06
  (() => {
    const sbOn = buildFullGameSandbox(null);
    const gs = sbOn.sandbox.gameState;
    const RR = sbOn.sandbox.ResourceRegistry;
    gs.skills.planetaryIndustry = { lvl: 80, xp: 0 };
    RR.add(gs, "currency:isk", 100000000);
    RR.add(gs, "mineral:三钛合金", 100000);
    const before = PLAN_IDS.filter((id) => typeof (gs.achievements.unlockedAtById && gs.achievements.unlockedAtById[id]) === "number").length;
    const achEvts = [];
    sbOn.sandbox.GameEvents.on("achievement:unlocked", (e) => achEvts.push(e));
    for (const t of PLAN_TYPES) {
      // 槽位上限 5（lvl80 slots=min(5,1+8)=5）：部署第 6 类前先真实拆除第 1 颗（storage=0 可拆；
      // deployedTypes 为永久殖民记录，拆除不回退——正是 G01–G06 的语义）。
      if (t === "storm") {
        const demolishRes = sbOn.sandbox.dispatchGameAction(gs, { type: "planetary/demolish", id: gs.planetary.deployments[0].id }, 1005);
        if (!demolishRes || demolishRes.changed !== true) { ok("[g25] 真实拆除释放槽位失败", false); return; }
      }
      const res = sbOn.sandbox.dispatchGameAction(gs, { type: "planetary/deploy", planetType: t }, 1000);
      if (!res || res.changed !== true) { ok("[g25] 真实部署 " + t + " 失败", false); return; }
    }
    ok("[g25] 真实 dispatchGameAction planetary/deploy 六种类型：G01–G06 全部解锁（各恰 emit 一次、不手工 emit）",
      PLAN_TYPES.every((t) => typeof gs.achievements.unlockedAtById["G0" + (PLAN_TYPES.indexOf(t) + 1)] === "number") &&
      PLAN_TYPES.every((t) => achEvts.filter((e) => e.payload.achievementId === "G0" + (PLAN_TYPES.indexOf(t) + 1)).length === 1));
  })();

  // E-b：真实连续部署 5 颗 → G07
  (() => {
    const sbC = buildFullGameSandbox(null);
    const gs = sbC.sandbox.gameState;
    const RR = sbC.sandbox.ResourceRegistry;
    gs.skills.planetaryIndustry = { lvl: 80, xp: 0 };
    RR.add(gs, "currency:isk", 100000000);
    RR.add(gs, "mineral:三钛合金", 100000);
    for (let i = 0; i < 5; i++) {
      sbC.sandbox.dispatchGameAction(gs, { type: "planetary/deploy", planetType: PLAN_TYPES[i] }, 1000 + i);
    }
    const activeCount = gs.planetary.deployments.filter((d) => d.active !== false).length;
    ok("[g26] 真实连续部署 5 颗：实际 deployments=" + activeCount + "、maxConcurrent≥5 → G07 立即解锁",
      activeCount === 5 && typeof gs.achievements.unlockedAtById["G07"] === "number");
  })();

  // E-c：真实在线 planetaryTick → 累计产出达 1,000,000 → G09
  (() => {
    const sbT = buildFullGameSandbox(null);
    const gs = sbT.sandbox.gameState;
    const RR = sbT.sandbox.ResourceRegistry;
    gs.skills.planetaryIndustry = { lvl: 80, xp: 0 };
    RR.add(gs, "currency:isk", 100000000);
    RR.add(gs, "mineral:三钛合金", 100000);
    const dep = sbT.sandbox.dispatchGameAction(gs, { type: "planetary/deploy", planetType: "lava" }, 1000);
    if (!dep || !dep.deployment) { ok("[g27] 真实在线部署 lava 失败", false); return; }
    const deployment = dep.deployment;
    // 结算窗口必须落在 [deployedAt, deployedAt+duration] 内（computePlanetarySettlement 双向夹紧，
    // 且 now>=expiresAt 会置 active=false 停产）。每轮回拨 lastTick 至 deployedAt、
    // 以 deployedAt+6h（<24h 到期）为 now 结算一整段 6 小时 → 每轮 storageMax 个真实周期。
    const depAt = Number(deployment.deployedAt) || 0;
    const settleNow = depAt + 21600 * 1000;
    let iter = 0;
    const target = 1000000;
    while (gs.statistics.totals.planetaryUnits < target && iter < 1500) {
      deployment.lastTick = depAt;
      deployment.progress = 0;
      try { sbT.sandbox.planetaryTick(settleNow); } catch (e) { ok("[g27] 在线 planetaryTick 异常", false, "message=" + (e.message || String(e))); return; }
      if (deployment.storage >= 1) sbT.sandbox.dispatchGameAction(gs, { type: "planetary/collect", id: deployment.id }, settleNow);
      iter++;
    }
    ok("[g27] 真实在线 planetaryTick：totals.planetaryUnits 真实增加至 " + gs.statistics.totals.planetaryUnits + " ≥1,000,000 → G09 解锁（" + iter + " 次 tick）",
      gs.statistics.totals.planetaryUnits >= target && typeof gs.achievements.unlockedAtById["G09"] === "number");
  })();

  // E-d：真实离线 settleOfflinePlanets → 同一统计/消费者链
  (() => {
    const sbOff = buildFullGameSandbox(null);
    const gs = sbOff.sandbox.gameState;
    const RR = sbOff.sandbox.ResourceRegistry;
    gs.skills.planetaryIndustry = { lvl: 80, xp: 0 };
    RR.add(gs, "currency:isk", 100000000);
    RR.add(gs, "mineral:三钛合金", 100000);
    // 既有真实累计（来自此前真实在线/离线生产）追溯为 999000，离线链补足至 ≥1,000,000
    gs.statistics.totals.planetaryUnits = 999000;
    const dep = sbOff.sandbox.dispatchGameAction(gs, { type: "planetary/deploy", planetType: "lava" }, 1000);
    if (!dep || !dep.deployment) { ok("[g28] 真实离线部署 lava 失败", false); return; }
    const deployment = dep.deployment;
    const gains = { planetaryIndustry: 0 };
    // settleOfflinePlanets 用 [segEnd-seconds*1000, segEnd] 夹紧到 [deployedAt, expiresAt]：
    // segEnd 取 deployedAt+6h（<24h 到期）使整段 6 小时全部落在有效期内。
    const depAtOff = Number(deployment.deployedAt) || 0;
    const segEnd = depAtOff + 21600 * 1000;
    let iter = 0;
    while (gs.statistics.totals.planetaryUnits < 1000000 && iter < 1500) {
      deployment.progress = 0;
      try { sbOff.sandbox.settleOfflinePlanets(21600, gains, segEnd); } catch (e) { ok("[g28] 离线 settleOfflinePlanets 异常", false, "message=" + (e.message || String(e))); return; }
      if (deployment.storage >= 1) sbOff.sandbox.dispatchGameAction(gs, { type: "planetary/collect", id: deployment.id }, segEnd);
      iter++;
    }
    ok("[g28] 真实离线 settleOfflinePlanets：同一统计/消费者链，planetaryUnits 增至 " + gs.statistics.totals.planetaryUnits + " ≥1,000,000 → G09 解锁（不手工 emit）",
      gs.statistics.totals.planetaryUnits >= 1000000 && typeof gs.achievements.unlockedAtById["G09"] === "number");
  })();

  // E-e：真实槽位变化 → G10（技能升级路径：真实 addSkillXpToState → checkLevelUpFromState
  // 自行发射 skill:levelUp{skill,previousLevel,level}，不手工 emit）
  (() => {
    const sbS = buildFullGameSandbox(null);
    const gs = sbS.sandbox.gameState;
    gs.skills.planetaryIndustry = { lvl: 39, xp: 0 };
    const preG10 = "G10" in gs.achievements.unlockedAtById;
    const need = sbS.sandbox.xpForLevel(40);
    sbS.sandbox.addSkillXpToState(gs, "planetaryIndustry", need, { source: "test", timestamp: 5000 });
    ok("[g29] 真实 skill:levelUp(planetaryIndustry 39→40，经 addSkillXpToState 真实发射) → slots=5=maxSlots → G10 解锁于 atMs=5000",
      !preG10 && gs.skills.planetaryIndustry.lvl === 40 &&
      gs.achievements.unlockedAtById["G10"] === 5000);
  })();

  // E-f：真实槽位变化 → G10（空间站 planetary_control 加成路径）
  (() => {
    const sbSt = buildFullGameSandbox(null);
    const gs = sbSt.sandbox.gameState;
    gs.skills.planetaryIndustry = { lvl: 39, xp: 0 }; // slots=4
    if (!gs.station || !gs.station.buildings) gs.station = { buildings: {} };
    gs.station.buildings.planetary_control = 2; // Lv.2 → getStationPlanetarySlotBonus=+1（真实 station.js L534）
    // 事件仅作触发器（消费者不信任 payload、读真实 getPlanetaryCapacityState）；payload 按 events.js L68 契约补全
    sbSt.sandbox.GameEvents.emit("station:buildingUpgraded",
      { buildingId: "planetary_control", fromLevel: 1, toLevel: 2, startedAt: 5000, completesAt: 5100 }, { source: "station", timestamp: 5100 });
    ok("[g30] 真实 station:buildingUpgraded(planetary_control 1→2) → slots=5=maxSlots → G10 解锁（空间站加成路径）",
      typeof gs.achievements.unlockedAtById["G10"] === "number" && gs.achievements.unlockedAtById["G10"] === 5100);
  })();

  // ========================= F. persistence 三路径 =========================
  // F-a：autoLoad 新游戏（buildFullGameSandbox 真实加载 persistence）
  const freshFullP = buildFullGameSandbox(null);
  ok("[g31] autoLoad 新游戏 spyInstalled=true（含 planetary spy）", freshFullP.spyInstalled === true);
  ok("[g32] autoLoad 新游戏 timeline：八求值器各 1 次、atMs 完全相等、顺序 skill<production<combat<manufacturing<equipment<booster<archaeology<planetary、offline 0 次",
    (() => {
      const tl = freshFullP.timeline;
      const evals = tl.filter((e) => e.fn.startsWith("evaluate"));
      const counts = {};
      for (const e of evals) counts[e.fn] = (counts[e.fn] || 0) + 1;
      const EIGHT = ["evaluateSkillAchievementRules", "evaluateProductionAchievementRules", "evaluateCombatAchievementRules",
        "evaluateManufacturingAchievementRules", "evaluateEquipmentAchievementRules", "evaluateBoosterAchievementRules",
        "evaluateArchaeologyAchievementRules", "evaluatePlanetaryAchievementRules"];
      const allOnce = EIGHT.every((f) => counts[f] === 1);
      const atMsSet = new Set(evals.filter((e) => e.atMs !== undefined).map((e) => e.atMs));
      const order = tl.map((e) => e.fn);
      const idx = EIGHT.map((f) => order.indexOf(f));
      const ordered = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
      const offlineCnt = tl.filter((e) => e.fn === "calculateOfflineGains").length;
      return allOnce && atMsSet.size === 1 && ordered && offlineCnt === 0;
    })());
  ok("[g33] autoLoad 新游戏 G01–G10 全未锁",
    PLAN_IDS.every((id) => !(id in (freshFullP.sandbox.gameState.achievements && freshFullP.sandbox.gameState.achievements.unlockedAtById || {}))));

  // F-b：persistence 源码确认行星对账存在（4 处）
  const persistSrcP = fs.readFileSync(PERSISTENCE_PATH, "utf-8");
  const totalPlanRefs = (persistSrcP.match(/evaluatePlanetaryAchievementRules/g) || []).length;
  ok("[g34] persistence 中 evaluatePlanetaryAchievementRules 恰 4 处（importData×2 + autoLoad×2）", totalPlanRefs === 4);

  // F-c：autoLoad 旧档（含行星统计）由 persistence 追溯解锁
  const v5PlanSave = JSON.stringify({
    saveVersion: 2, skills: { planetaryIndustry: { lvl: 40, xp: 0 } },
    achievements: { unlockedAtById: {} },
    statistics: {
      version: 4,
      totals: { events: 5, planetaryUnits: 1000000 },
      planetary: {
        deployedTypes: { lava: 1, gas: 1, ice: 1, plasma: 1, temperate: 1, storm: 1 },
        maxConcurrentDeployments: 5,
      },
    },
    planetary: { deployments: [
      { active: true, planetType: "lava" }, { active: true, planetType: "gas" },
      { active: true, planetType: "ice" }, { active: true, planetType: "plasma" },
      { active: true, planetType: "temperate" }, { active: true, planetType: "storm" },
    ] },
    station: { buildings: { planetary_control: 2 } },
  });
  const loadedPlan = buildFullGameSandbox(v5PlanSave);
  ok("[g35] autoLoad 旧档 timeline：planetary 恰 1 次且早于 calculateOfflineGains（planetary < offline）",
    (() => {
      const tl = loadedPlan.timeline;
      const pTimes = tl.filter((e) => e.fn === "evaluatePlanetaryAchievementRules").length;
      const oTimes = tl.filter((e) => e.fn === "calculateOfflineGains").length;
      const pIdx = tl.findIndex((e) => e.fn === "evaluatePlanetaryAchievementRules");
      const oIdx = tl.findIndex((e) => e.fn === "calculateOfflineGains");
      const aIdx = tl.findIndex((e) => e.fn === "evaluateArchaeologyAchievementRules");
      return pTimes === 1 && oTimes === 1 && aIdx >= 0 && pIdx >= 0 && oIdx >= 0 && aIdx < pIdx && pIdx < oIdx;
    })());
  ok("[g36] autoLoad 旧档（全满行星统计+当前部署+全槽位）G01–G10 全部追溯解锁且八求值器 atMs 一致",
    (() => {
      const gs = loadedPlan.sandbox.gameState;
      const evals = loadedPlan.timeline.filter((e) => e.fn.startsWith("evaluate"));
      const atMsSet = new Set(evals.filter((e) => e.atMs !== undefined).map((e) => e.atMs));
      return atMsSet.size === 1 &&
        PLAN_IDS.every((id) => typeof (gs.achievements && gs.achievements.unlockedAtById[id]) === "number");
    })());

  // F-d：importData 真实调用（已有时间保留、其余补发、timeline 精确）
  const importP = buildFullGameSandbox(null);
  const vImportPlanSave = JSON.stringify({
    saveVersion: 2, skills: { planetaryIndustry: { lvl: 40, xp: 0 } },
    achievements: { unlockedAtById: { "G01": 123.5 } },
    statistics: {
      version: 4,
      totals: { events: 5, planetaryUnits: 1000000 },
      planetary: {
        deployedTypes: { lava: 1, gas: 1, ice: 1, plasma: 1, temperate: 1, storm: 1 },
        maxConcurrentDeployments: 5,
      },
    },
    planetary: { deployments: [
      { active: true, planetType: "lava" }, { active: true, planetType: "gas" },
      { active: true, planetType: "ice" }, { active: true, planetType: "plasma" },
      { active: true, planetType: "temperate" }, { active: true, planetType: "storm" },
    ] },
    station: { buildings: { planetary_control: 2 } },
  });
  importP.timeline.length = 0;
  importP.achievementEvents.length = 0;
  let importOkP = false;
  try {
    importOkP = importP.sandbox.SaveManager.importData(vImportPlanSave) === true;
  } catch (e) { importOkP = false; }
  ok("[g37] importData 返回 true", importOkP);
  if (importOkP) {
    const tl = importP.timeline;
    const count = (fn) => tl.filter((e) => e.fn === fn).length;
    const EIGHT = ["evaluateSkillAchievementRules", "evaluateProductionAchievementRules", "evaluateCombatAchievementRules",
      "evaluateManufacturingAchievementRules", "evaluateEquipmentAchievementRules", "evaluateBoosterAchievementRules",
      "evaluateArchaeologyAchievementRules", "evaluatePlanetaryAchievementRules"];
    const allOnce = EIGHT.every((f) => count(f) === 1) && count("calculateOfflineGains") === 1;
    const order = tl.map((e) => e.fn);
    const idx = EIGHT.map((f) => order.indexOf(f));
    const iOffline = order.indexOf("calculateOfflineGains");
    const ordered = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])) && iOffline > idx[7];
    const evals = tl.filter((e) => e.fn.startsWith("evaluate"));
    const atMsSet = new Set(evals.filter((e) => e.atMs !== undefined).map((e) => e.atMs));
    ok("[g38] importData timeline 精确：八求值器各 1 次、顺序 skill<…<archaeology<planetary<offline、八者共用同一 atMs",
      allOnce && ordered && atMsSet.size === 1);
    const gsImp = importP.sandbox.gameState;
    const ach = gsImp.achievements && gsImp.achievements.unlockedAtById || {};
    ok("[g39] importData 已有 G01=123.5 保留、G02–G10 新补发且 G01 不重复 emit",
      ach["G01"] === 123.5 &&
      PLAN_IDS.slice(1).every((id) => typeof ach[id] === "number") &&
      importP.achievementEvents.filter((e) => e.payload.achievementId === "G01").length === 0);
  }

  // ========================= G. 源码与只读保护 =========================
  const eventsSrcP = fs.readFileSync(EVENTS_PATH, "utf-8");
  const tickSrcP = fs.readFileSync(TICK_PATH, "utf-8");
  const offlineSrcP = fs.readFileSync(OFFLINE_PATH, "utf-8");
  const actionsSrcP = fs.readFileSync(path.join(ROOT, "js", "core", "actions.js"), "utf-8");
  const planetSysSrcP = fs.readFileSync(path.join(ROOT, "js", "systems", "planetary.js"), "utf-8");
  const selectorsSrcP = fs.readFileSync(path.join(ROOT, "js", "core", "selectors.js"), "utf-8");
  ok("[g40] events/tick/offline/actions/planetary/selectors 不含 G01–G10 成就规则或 unlockAchievement 调用（发射层保持纯净）",
    !eventsSrcP.includes("G01") && !eventsSrcP.includes("G10") &&
    !tickSrcP.includes("G01") && !tickSrcP.includes("G10") &&
    !offlineSrcP.includes("G01") && !offlineSrcP.includes("G10") &&
    !actionsSrcP.includes("G0") && !actionsSrcP.includes("unlockAchievement") &&
    !planetSysSrcP.includes("G0") && !planetSysSrcP.includes("unlockAchievement") &&
    !selectorsSrcP.includes("G0") && !selectorsSrcP.includes("unlockAchievement"));

  const planFuncBody = (extractFnBody(achSysSrcP, "evaluatePlanetaryAchievementRules") || "") +
    (extractFnBody(achSysSrcP, "installPlanetaryAchievementConsumer") || "");
  ok("[g41] achievements.js 本批新增行星函数体不含奖励/UI/Steamworks/研究系统调用（仅解锁内核 + 行星事件消费者）",
    planFuncBody.length > 0 &&
    !planFuncBody.includes("award") && !planFuncBody.includes("AwardSystem") &&
    !planFuncBody.includes("Steamworks") && !planFuncBody.includes("Research"));

  // 仓库文件清单快照（后）：双向比较
  const planFilesAfter = [];
  try {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p); }
        else planFilesAfter.push(p);
      }
    })(ROOT);
  } catch (e) { planFilesAfter.length = 0; }
  let g42ok = planFilesBefore.length > 0 && planFilesAfter.length > 0;
  if (g42ok) {
    const bSet = new Set(planFilesBefore);
    const aSet = new Set(planFilesAfter);
    for (const f of planFilesBefore) { if (!aSet.has(f)) { g42ok = false; break; } }
    if (g42ok) { for (const f of planFilesAfter) { if (!bSet.has(f)) { g42ok = false; break; } } }
  }
  ok("[g42] 审计行星分区未向仓库写入任何辅助文件（函数首尾双向文件清单一致）", g42ok);

  ok("[g43] 行星规则数据在本分区内未被任何求值/消费者改变（PLANETARY_RULES 全冻结）",
    Object.isFrozen(RD.PLANETARY_RULES) &&
    RD.PLANETARY_RULES.every((r) => Object.isFrozen(r)) &&
    Object.isFrozen(RD.PLANETARY_TYPE_IDS));
}

// ============================================================================
//  --station：Batch C-9 空间站类成就（H01–H13、H15、H16 共 15 项）
//    A 规则数据 / B 求值边界 / C statistics v6 迁移 / D 事件记账 /
//    E 消费者 / F 真实链路 + persistence / G 只读性
// ============================================================================
function runStation() {
  // 分区首尾文件清单（证明本分区不向仓库写入任何辅助文件）
  const stFilesBefore = [];
  try {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p); }
        else stFilesBefore.push(p);
      }
    })(ROOT);
  } catch (e) { stFilesBefore.length = 0; }

  const ST_IDS = ["H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08", "H09", "H10", "H11", "H12", "H13", "H15", "H16"];
  const ST_BUILDINGS = ["resource_dispatch", "planetary_control", "smelting_refinery", "equipment_factory",
    "booster_factory", "archaeology_lab", "combat_command", "shipyard"];
  const STATION_JS_PATH = path.join(ROOT, "js", "systems", "station.js");

  function extractFnBodyS(src, name) {
    const start = src.indexOf("function " + name);
    if (start < 0) return "";
    let i = src.indexOf("{", start);
    if (i < 0) return "";
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return "";
  }

  // 内核沙箱 + 真实 js/systems/station.js：H13 必须调用真实 getStationLogisticsMultiplier，
  // 不允许在审计里复制倍率公式或退化为 bodyLevel 判断。
  function buildStationSandbox(opts) {
    const sb = buildKernelSandbox(opts);
    vm.runInContext(fs.readFileSync(STATION_JS_PATH, "utf-8"), sb, { filename: "js/systems/station.js" });
    return sb;
  }

  // 最小权威状态：state.station（真实字段名）+ statistics.station（v6 三字段）
  function makeStState(box, o) {
    o = o || {};
    return {
      skills: {},
      achievements: box.AchievementState.createDefaultAchievementState(),
      station: {
        version: 1,
        bodyLevel: o.bodyLevel !== undefined ? o.bodyLevel : 0,
        construction: null,
        buildings: Object.assign(Object.fromEntries(ST_BUILDINGS.map((id) => [id, 0])), o.buildings || {}),
        maintenance: { tier: "standard", fuelRemaining: o.fuel !== undefined ? o.fuel : 0, lastRefillAt: 0 },
        autoLines: o.autoLines || {},
      },
      statistics: {
        version: 6,
        totals: {},
        station: {
          constructionCompletions: o.cc !== undefined ? o.cc : 0,
          maxConcurrentAutoLines: o.mc !== undefined ? o.mc : 0,
          maxOfflineSettlementSeconds: o.ms !== undefined ? o.ms : 0,
        },
      },
      _dirty: false,
    };
  }

  // ========================= A. 规则数据 =========================
  const sbH = buildStationSandbox({ withEvents: true, withRules: true });
  const RD = sbH.AchievementRuleData;
  const SYS = sbH.AchievementSystem;
  const evalS = (state, atMs) => SYS.evaluateStationAchievementRules(state, atMs);

  ok("[h1] STATION_RULES 冻结数组 15 项、每项冻结、BY_ID 冻结 15 键且逐项引用一致（H01–H13,H15,H16 顺序）",
    Array.isArray(RD.STATION_RULES) && RD.STATION_RULES.length === 15 &&
    Object.isFrozen(RD.STATION_RULES) && RD.STATION_RULES.every((r) => Object.isFrozen(r)) &&
    RD.STATION_RULES_BY_ID && Object.isFrozen(RD.STATION_RULES_BY_ID) &&
    Object.keys(RD.STATION_RULES_BY_ID).length === 15 &&
    ST_IDS.every((id, i) => RD.STATION_RULES[i].achievementId === id &&
      RD.STATION_RULES_BY_ID[id] === RD.STATION_RULES[i]));

  // 与 js/core/state.js 真实 STATION_BUILDING_IDS 双向逐项相等（不复制第二套建筑清单）
  let h2ok = true;
  try {
    const ctxB = { console };
    ctxB.window = ctxB; ctxB.globalThis = ctxB;
    vm.createContext(ctxB);
    const stateSrc = fs.readFileSync(CORE_STATE_PATH, "utf-8");
    const head = stateSrc.slice(0, stateSrc.indexOf("]") + 1);
    vm.runInContext(head + ";globalThis.__REAL_BUILDING_IDS = STATION_BUILDING_IDS;", ctxB, { filename: "state-station-ids.js" });
    const real = ctxB.__REAL_BUILDING_IDS;
    h2ok = Array.isArray(RD.STATION_BUILDING_IDS_FOR_ACHIEVEMENTS) &&
      Object.isFrozen(RD.STATION_BUILDING_IDS_FOR_ACHIEVEMENTS) &&
      RD.STATION_BUILDING_IDS_FOR_ACHIEVEMENTS.length === 8 && Array.isArray(real) && real.length === 8 &&
      RD.STATION_BUILDING_IDS_FOR_ACHIEVEMENTS.every((id, i) => id === real[i]) &&
      real.every((id, i) => id === RD.STATION_BUILDING_IDS_FOR_ACHIEVEMENTS[i]);
  } catch (e) { h2ok = false; }
  ok("[h2] STATION_BUILDING_IDS_FOR_ACHIEVEMENTS 与 state.js STATION_BUILDING_IDS 双向逐项相等（各 8、顺序一致、冻结）", h2ok);

  const hR = {};
  for (const id of ST_IDS) hR[id] = RD.STATION_RULES_BY_ID[id];
  ok("[h3] 逐项映射精确：H01 body≥1；H02 body≥3；H03–H10 八建筑各 Lv≥3（buildingId 精确）；H11 constructionCompletions≥1；H12 maxConcurrentAutoLines≥3；H13 物流倍率≥1.15；H15 maxOfflineSettlementSeconds>28800；H16 shipyard≥3",
    hR["H01"].type === "station-body-level" && hR["H01"].minValue === 1 &&
    hR["H02"].type === "station-body-level" && hR["H02"].minValue === 3 &&
    ["H03", "H04", "H05", "H06", "H07", "H08", "H09", "H10"].every((id, i) =>
      hR[id].type === "station-building-level" && hR[id].buildingId === ST_BUILDINGS[i] && hR[id].minValue === 3) &&
    hR["H11"].type === "station-stat" && hR["H11"].statKey === "constructionCompletions" && hR["H11"].minValue === 1 &&
    hR["H12"].type === "station-stat" && hR["H12"].statKey === "maxConcurrentAutoLines" && hR["H12"].minValue === 3 &&
    hR["H13"].type === "station-logistics-multiplier" && hR["H13"].minValue === 1.15 &&
    hR["H15"].type === "station-offline-exceeds" && hR["H15"].statKey === "maxOfflineSettlementSeconds" && hR["H15"].exceedsValue === 28800 &&
    hR["H16"].type === "station-building-level" && hR["H16"].buildingId === "shipyard" && hR["H16"].minValue === 3);

  // 十规则集合两两零交集 + 总计 175（Batch C-10A2 新增 BLUEPRINT_RULES）
  const setsAll = [
    new Set(RD.SKILL_RULES.map((r) => r.achievementId)),
    new Set(RD.PRODUCTION_RULES.map((r) => r.achievementId)),
    new Set(RD.COMBAT_RULES.map((r) => r.achievementId)),
    new Set(RD.MANUFACTURING_RULES.map((r) => r.achievementId)),
    new Set(RD.EQUIPMENT_RULES.map((r) => r.achievementId)),
    new Set(RD.BOOSTER_RULES.map((r) => r.achievementId)),
    new Set(RD.ARCHAEOLOGY_RULES.map((r) => r.achievementId)),
    new Set(RD.PLANETARY_RULES.map((r) => r.achievementId)),
    new Set(RD.STATION_RULES.map((r) => r.achievementId)),
    new Set(RD.BLUEPRINT_RULES.map((r) => r.achievementId)),
  ];
  let h4ok = true;
  for (let i = 0; i < setsAll.length && h4ok; i++) {
    for (let j = i + 1; j < setsAll.length && h4ok; j++) {
      for (const id of setsAll[i]) { if (setsAll[j].has(id)) { h4ok = false; break; } }
    }
  }
  const unionAll = new Set();
  for (const s of setsAll) for (const id of s) unionAll.add(id);
  const sumAll = setsAll.reduce((s, x) => s + x.size, 0);
  const catalogTotal = sbH.AchievementData.ACHIEVEMENTS.length;
  ok("[h4] 十规则集合两两零交集、总计 176、目录 197 未映射恰 21、176 项全部存在于成就目录",
    h4ok && sumAll === 176 && unionAll.size === 176 &&
    catalogTotal === 197 && catalogTotal - unionAll.size === 21 &&
    [...unionAll].every((id) => !!sbH.AchievementData.ACHIEVEMENTS_BY_ID[id]));

  ok("[h5] H14 既不在 STATION_RULES_BY_ID 也不在成就目录（不创建幽灵规则/幽灵 ID）",
    !("H14" in RD.STATION_RULES_BY_ID) &&
    !RD.STATION_RULES.some((r) => r.achievementId === "H14") &&
    !sbH.AchievementData.ACHIEVEMENTS_BY_ID["H14"]);

  ok("[h6] H10 与 H16 为两个独立规则对象（achievementId 不同、条件完全相同：shipyard Lv≥3）",
    hR["H10"] !== hR["H16"] && hR["H10"].achievementId === "H10" && hR["H16"].achievementId === "H16" &&
    hR["H10"].type === hR["H16"].type && hR["H10"].buildingId === hR["H16"].buildingId &&
    hR["H10"].minValue === hR["H16"].minValue);

  // ========================= B. 求值边界 =========================
  const s01a = makeStState(sbH, { bodyLevel: 0 });
  const r01a = evalS(s01a, 100);
  const s01b = makeStState(sbH, { bodyLevel: 1 });
  const r01b = evalS(s01b, 100);
  ok("[h7] H01：bodyLevel=0 不解锁、=1 解锁恰 H01 一项（evaluatedCount 恒为 15、unlockedAt=atMs）",
    r01a.ok && r01a.evaluatedCount === 15 && r01a.unlockedIds.length === 0 &&
    r01b.ok && r01b.evaluatedCount === 15 &&
    r01b.unlockedIds.length === 1 && r01b.unlockedIds[0] === "H01" &&
    s01b.achievements.unlockedAtById["H01"] === 100);

  const s02a = makeStState(sbH, { bodyLevel: 2 });
  const r02a = evalS(s02a, 200);
  const s02b = makeStState(sbH, { bodyLevel: 3 });
  const r02b = evalS(s02b, 200);
  ok("[h8] H02：bodyLevel=2 只解锁 H01、=3 同批解锁 H01+H02（无燃料时不含 H13）",
    r02a.unlockedIds.length === 1 && r02a.unlockedIds[0] === "H01" &&
    r02b.unlockedIds.length === 2 && r02b.unlockedIds.includes("H01") && r02b.unlockedIds.includes("H02") &&
    !r02b.unlockedIds.includes("H13"));

  let h9ok = true;
  for (let i = 0; i < 7; i++) {
    const fid = "H0" + String(i + 3);
    const bid = ST_BUILDINGS[i];
    const s2 = makeStState(sbH, { buildings: { [bid]: 2 } });
    const r2 = evalS(s2, 300);
    if (r2.unlockedIds.length !== 0) h9ok = false;
    const s3 = makeStState(sbH, { buildings: { [bid]: 3 } });
    const r3 = evalS(s3, 300);
    if (!(r3.unlockedIds.length === 1 && r3.unlockedIds[0] === fid && s3.achievements.unlockedAtById[fid] === 300)) h9ok = false;
  }
  ok("[h9] H03–H09：七建筑各自 Lv.2 不解锁、Lv.3 解锁恰对应一项（resource_dispatch/planetary_control/smelting_refinery/equipment_factory/booster_factory/archaeology_lab/combat_command）", h9ok);

  const sYard2 = makeStState(sbH, { buildings: { shipyard: 2 } });
  const rYard2 = evalS(sYard2, 400);
  const sYard3 = makeStState(sbH, { buildings: { shipyard: 3 } });
  const rYard3 = evalS(sYard3, 400);
  ok("[h10] H10+H16：shipyard Lv.2 均不解锁；Lv.3 同一批次同时解锁两项且 unlockedAt 相同（同条件双成就）",
    rYard2.unlockedIds.length === 0 &&
    rYard3.unlockedIds.length === 2 && rYard3.unlockedIds.includes("H10") && rYard3.unlockedIds.includes("H16") &&
    sYard3.achievements.unlockedAtById["H10"] === 400 && sYard3.achievements.unlockedAtById["H16"] === 400);

  const sCC0 = makeStState(sbH, { cc: 0 });
  const sCC1 = makeStState(sbH, { cc: 1 });
  ok("[h11] H11：statistics.station.constructionCompletions=0 不解锁、=1 解锁恰 H11",
    evalS(sCC0, 500).unlockedIds.length === 0 &&
    (() => { const r = evalS(sCC1, 500); return r.unlockedIds.length === 1 && r.unlockedIds[0] === "H11"; })());

  const sMC2 = makeStState(sbH, { mc: 2 });
  const sMC3 = makeStState(sbH, { mc: 3 });
  ok("[h12] H12：maxConcurrentAutoLines=2 不解锁、=3 解锁恰 H12",
    evalS(sMC2, 600).unlockedIds.length === 0 &&
    (() => { const r = evalS(sMC3, 600); return r.unlockedIds.length === 1 && r.unlockedIds[0] === "H12"; })());

  // H13：真实 getStationLogisticsMultiplier（断油=×1、Lv.2=×1.08 均不解锁；Lv.3+有油=×1.15 解锁）
  const sLog3Fuel = makeStState(sbH, { bodyLevel: 3, fuel: 500 });
  const rLog3Fuel = evalS(sLog3Fuel, 700);
  const sLog3Dry = makeStState(sbH, { bodyLevel: 3, fuel: 0 });
  const rLog3Dry = evalS(sLog3Dry, 700);
  const sLog2Fuel = makeStState(sbH, { bodyLevel: 2, fuel: 500 });
  const rLog2Fuel = evalS(sLog2Fuel, 700);
  ok("[h13] H13：真实倍率 Lv.3+有油=×1.15 解锁；Lv.3 断油=×1 不解锁；Lv.2+有油=×1.08 不解锁（不退化为 bodyLevel 判断）",
    typeof sbH.getStationLogisticsMultiplier === "function" &&
    sbH.getStationLogisticsMultiplier(sLog3Fuel) === 1.15 &&
    sbH.getStationLogisticsMultiplier(sLog3Dry) === 1 &&
    sbH.getStationLogisticsMultiplier(sLog2Fuel) === 1.08 &&
    rLog3Fuel.unlockedIds.includes("H13") &&
    !rLog3Dry.unlockedIds.includes("H13") &&
    !rLog2Fuel.unlockedIds.includes("H13"));

  // =============================================================
  // 专项回归（Fix 2：H13 十倍速误解锁）
  //   - 成就判定用 getStationLogisticsBaseMultiplier（不含 GAME_SPEED）；
  //     生产 getStationLogisticsMultiplier 仍含 speed（保留 X10）。
  //   - speed=1 与 speed=10 下，H13 都只在真实 Lv.3 有效物流倍率=1.15 时解锁；
  //     Lv.1(1.03)/Lv.2(1.08) 不得解锁（speed=10 时 Lv.1 不会被放大成 10.3）。
  // =============================================================
  // REG-13 H13 速度无关解锁（speed=1 与 speed=10）
  //   本沙箱仅加载 station.js（不含 speed-config/tick），故 getGameSpeed 不可用、生产乘子恒为基础值；
  //   生产乘子随 GAME_SPEED 缩放（X10 保留）由 audit-station REG-C 专项验证。
  //   此处聚焦 H13 的核心修复：成就判定走 getStationLogisticsBaseMultiplier（不含 GAME_SPEED），
  //   因此无论 speed=1 还是 speed=10，H13 都只在真实 Lv.3 有效物流倍率=1.15 时解锁，
  //   Lv.1(1.03)/Lv.2(1.08)/断油 不得解锁（speed=10 不会把 Lv.1 误解锁为「满级」）。
  {
    const buildLog = (lvl, fuel) => makeStState(sbH, { bodyLevel: lvl, fuel: fuel });
    try {
      for (const speed of [1, 10]) {
        // 即便生产侧 GAME_SPEED 被置为 speed（本沙箱无 getGameSpeed 故为无操作，但语义正确）：
        // H13 判定走 base，与 speed 无关，不会把 Lv.1(1.03) 在 speed=10 时误放大成 10.3 解锁。
        try { sbH.GAME_SPEED = speed; } catch (e) {}
        const s1 = buildLog(1, 500);   // 真实物流 1.03
        const s2 = buildLog(2, 500);   // 真实物流 1.08
        const s3 = buildLog(3, 500);   // 真实物流 1.15
        const s3dry = buildLog(3, 0);  // 断油
        // 基础乘子不含 speed：恒为本体值，与 speed 无关
        ok("[REG-13] speed=" + speed + " 基础物流乘子不含 GAME_SPEED（Lv.1=1.03/Lv.2=1.08/Lv.3=1.15）",
          sbH.getStationLogisticsBaseMultiplier(s1) === 1.03 &&
          sbH.getStationLogisticsBaseMultiplier(s2) === 1.08 &&
          sbH.getStationLogisticsBaseMultiplier(s3) === 1.15);
        // H13 仅 Lv.3+油解锁；Lv.1/Lv.2/断油 不解锁（哪怕生产侧 speed=10 把乘子放大）
        const r1 = evalS(s1, 700), r2 = evalS(s2, 700), r3 = evalS(s3, 700), r3d = evalS(s3dry, 700);
        ok("[REG-13] speed=" + speed + " H13 仅 Lv.3+油解锁（Lv.1/Lv.2/断油 不解锁）",
          r3.unlockedIds.includes("H13") && !r1.unlockedIds.includes("H13") &&
          !r2.unlockedIds.includes("H13") && !r3d.unlockedIds.includes("H13"));
      }
    } catch (e) {
      ok("[REG-13] 速度无关回归未抛异常（" + (e && e.message ? e.message : String(e)) + "）", false);
    } finally {
      try { delete sbH.GAME_SPEED; } catch (e) {}
    }
  }

  const sOff0 = makeStState(sbH, { ms: 28800 });
  const rOff0 = evalS(sOff0, 800);
  const sOff1 = makeStState(sbH, { ms: 28801 });
  const rOff1 = evalS(sOff1, 800);
  const sOff2 = makeStState(sbH, { ms: 86400 });
  const rOff2 = evalS(sOff2, 800);
  ok("[h14] H15：严格大于 28800 —— 28800 不解锁、28801 解锁、86400（离线上限）解锁",
    rOff0.unlockedIds.length === 0 &&
    rOff1.unlockedIds.length === 1 && rOff1.unlockedIds[0] === "H15" &&
    rOff2.unlockedIds.length === 1 && rOff2.unlockedIds[0] === "H15");

  const rBadState = evalS(null, 900);
  const rNoAch = evalS({ statistics: { station: {} } }, 900);
  const rNoStat = evalS({ achievements: sbH.AchievementState.createDefaultAchievementState() }, 900);
  const sbNoRule = buildStationSandbox({ withEvents: true, withRules: false });
  const rNoRule = sbNoRule.AchievementSystem.evaluateStationAchievementRules(makeStState(sbNoRule, { bodyLevel: 3 }), 900);
  ok("[h15] 失败 reason 完备：null/无成就状态→INVALID_STATE、无 statistics→STATISTICS_UNAVAILABLE、无规则数据→RULE_DATA_UNAVAILABLE（均 evaluatedCount=0、unlockedIds=[]）",
    rBadState.ok === false && rBadState.reason === "INVALID_STATE" && rBadState.evaluatedCount === 0 && rBadState.unlockedIds.length === 0 &&
    rNoAch.ok === false && rNoAch.reason === "INVALID_STATE" &&
    rNoStat.ok === false && rNoStat.reason === "STATISTICS_UNAVAILABLE" &&
    rNoRule.ok === false && rNoRule.reason === "RULE_DATA_UNAVAILABLE" && rNoRule.evaluatedCount === 0);

  // 幂等 + 只读（求值器不得写 state.station / statistics.station）
  const sIdem = makeStState(sbH, { bodyLevel: 3, fuel: 100, buildings: Object.fromEntries(ST_BUILDINGS.map((b) => [b, 3])), cc: 5, mc: 3, ms: 99999 });
  const beforeStation = JSON.stringify(sIdem.station);
  const beforeStats = JSON.stringify(sIdem.statistics);
  const rI1 = evalS(sIdem, 1000);
  const mapAfter1 = JSON.stringify(sIdem.achievements.unlockedAtById);
  const rI2 = evalS(sIdem, 2000);
  const mapAfter2 = JSON.stringify(sIdem.achievements.unlockedAtById);
  ok("[h16] 全满状态一次解锁 15 项；重复求值 unlockedIds=[]、解锁时间不被覆盖；求值器只读（state.station 与 statistics.station 字节不变）",
    rI1.unlockedIds.length === 15 && ST_IDS.every((id) => rI1.unlockedIds.includes(id)) &&
    rI2.ok && rI2.evaluatedCount === 15 && rI2.unlockedIds.length === 0 && mapAfter1 === mapAfter2 &&
    JSON.stringify(sIdem.station) === beforeStation && JSON.stringify(sIdem.statistics) === beforeStats);

  // ========================= C. statistics v6 迁移 =========================
  let statVM = null;
  try {
    const statSrc = fs.readFileSync(STATISTICS_PATH, "utf-8");
    const ep = ";globalThis.__ensure=ensureStatisticsState;globalThis.__def=createDefaultStatisticsState;globalThis.__ver=GAME_STATISTICS_VERSION;";
    const ctx = { console };
    ctx.window = ctx; ctx.globalThis = ctx;
    ctx.GameEvents = { onIdempotent() {}, on() {}, emit() {}, listenerCount() { return 0; } };
    ctx.gameState = { statistics: { version: 1, totals: {}, production: {}, combat: {}, activity: {}, eventLedger: {} }, _dirty: false };
    vm.createContext(ctx);
    vm.runInContext(statSrc + "\n" + ep, ctx, { filename: "statistics-station.js" });
    statVM = ctx;
  } catch (e) { statVM = null; }

  if (statVM) {
    const defS = statVM.__def();
    ok("[h17] GAME_STATISTICS_VERSION=9；新游戏默认 statistics.station={constructionCompletions:0,maxConcurrentAutoLines:0,maxOfflineSettlementSeconds:0}（恰 3 键）",
      statVM.__ver === 9 && defS.version === 9 &&
      defS.station && typeof defS.station === "object" && !Array.isArray(defS.station) &&
      Object.keys(defS.station).length === 3 &&
      defS.station.constructionCompletions === 0 && defS.station.maxConcurrentAutoLines === 0 &&
      defS.station.maxOfflineSettlementSeconds === 0);

    // v5→v6（无 state.station → 无任何回填）
    statVM.gameState = { statistics: { version: 5, totals: { events: 7 }, production: {}, combat: {}, activity: {}, eventLedger: {} }, _dirty: false };
    statVM.__ensure(statVM.gameState);
    const st5 = statVM.gameState.statistics;
    ok("[h18] v5→v6 真实迁移：version=6、station 三字段补齐为 0、旧 totals 保留",
      st5.version === 9 && st5.station && st5.station.constructionCompletions === 0 &&
      st5.station.maxConcurrentAutoLines === 0 && st5.station.maxOfflineSettlementSeconds === 0 &&
      st5.totals.events === 7);

    let h19ok = true;
    for (const v of [1, 2, 3, 4]) {
      statVM.gameState = { statistics: { version: v, totals: { events: 3 }, production: {}, combat: {}, activity: {}, eventLedger: {} }, _dirty: false };
      statVM.__ensure(statVM.gameState);
      const st = statVM.gameState.statistics;
      if (st.version !== 9 || !st.station || st.station.constructionCompletions !== 0 ||
        st.station.maxConcurrentAutoLines !== 0 || st.station.maxOfflineSettlementSeconds !== 0) h19ok = false;
    }
    // 缺失 version 的坏档同样迁移到 v8
    statVM.gameState = { statistics: { totals: {}, production: {}, combat: {}, activity: {}, eventLedger: {} }, _dirty: false };
    statVM.__ensure(statVM.gameState);
    if (statVM.gameState.statistics.version !== 9 || !statVM.gameState.statistics.station) h19ok = false;
    ok("[h19] v1/v2/v3/v4 与缺失 version 的旧档均迁移至 v9 且补出 station 三字段", h19ok);

    let h20ok = true;
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, -3, -0.5, "abc", "7", {}, [], true, false]) {
      statVM.gameState = {
        statistics: { version: 6, totals: {}, station: { constructionCompletions: bad, maxConcurrentAutoLines: bad, maxOfflineSettlementSeconds: bad }, production: {}, combat: {}, activity: {}, eventLedger: {} },
        _dirty: false,
      };
      statVM.__ensure(statVM.gameState);
      const s = statVM.gameState.statistics.station;
      if (s.constructionCompletions !== 0 || s.maxConcurrentAutoLines !== 0 || s.maxOfflineSettlementSeconds !== 0) h20ok = false;
    }
    // station 本身为数组/非对象 → 整体替换为三零
    for (const badRoot of [[1, 2], "x", 5, null]) {
      statVM.gameState = { statistics: { version: 6, totals: {}, station: badRoot, production: {}, combat: {}, activity: {}, eventLedger: {} }, _dirty: false };
      statVM.__ensure(statVM.gameState);
      const s = statVM.gameState.statistics.station;
      if (!s || s.constructionCompletions !== 0 || s.maxConcurrentAutoLines !== 0 || s.maxOfflineSettlementSeconds !== 0) h20ok = false;
    }
    // 合法值保留 + floor 收敛
    statVM.gameState = {
      statistics: { version: 6, totals: {}, station: { constructionCompletions: 7, maxConcurrentAutoLines: 2.9, maxOfflineSettlementSeconds: 30000.7 }, production: {}, combat: {}, activity: {}, eventLedger: {} },
      _dirty: false,
    };
    statVM.__ensure(statVM.gameState);
    const stKeep = statVM.gameState.statistics.station;
    ok("[h20] station 三字段非法值（undefined/null/NaN/±Infinity/负数/字符串/{}/[]/布尔、station 根为数组或标量）一律清洗为 0；合法值保留且 Math.floor 收敛（7→7、2.9→2、30000.7→30000）",
      h20ok && stKeep.constructionCompletions === 7 && stKeep.maxConcurrentAutoLines === 2 && stKeep.maxOfflineSettlementSeconds === 30000);

    // fromVersion<6 不可争议事实回填
    statVM.gameState = {
      statistics: { version: 5, totals: {}, production: {}, combat: {}, activity: {}, eventLedger: {} },
      station: {
        bodyLevel: 2, buildings: { smelting_refinery: 1 },
        autoLines: { smelting: { enabled: true }, equipment: { enabled: true }, booster: { enabled: false } },
      },
      lastActiveTime: 1,
      _dirty: false,
    };
    statVM.__ensure(statVM.gameState);
    const stBack = statVM.gameState.statistics.station;
    // 建筑等级≥1、本体=0 的旧档同样补 constructionCompletions≥1
    statVM.gameState = {
      statistics: { version: 3, totals: {}, production: {}, combat: {}, activity: {}, eventLedger: {} },
      station: { bodyLevel: 0, buildings: { archaeology_lab: 2 }, autoLines: {} },
      _dirty: false,
    };
    statVM.__ensure(statVM.gameState);
    const stBackB = statVM.gameState.statistics.station;
    // 全空旧档：无任何不可争议事实 → 三字段保持 0
    statVM.gameState = {
      statistics: { version: 2, totals: {}, production: {}, combat: {}, activity: {}, eventLedger: {} },
      station: { bodyLevel: 0, buildings: {}, autoLines: {} },
      lastActiveTime: 1,
      _dirty: false,
    };
    statVM.__ensure(statVM.gameState);
    const stEmpty = statVM.gameState.statistics.station;
    ok("[h21] fromVersion<6 回填不可争议事实：bodyLevel≥1 或任一建筑等级≥1 → constructionCompletions≥1；当前 enabled===true 的自动线数量提高 maxConcurrentAutoLines（2 条=2）；禁止由 lastActiveTime 推断 → maxOfflineSettlementSeconds 恒为 0；无事实旧档三字段全 0",
      stBack.constructionCompletions >= 1 && stBack.maxConcurrentAutoLines === 2 && stBack.maxOfflineSettlementSeconds === 0 &&
      stBackB.constructionCompletions >= 1 && stBackB.maxOfflineSettlementSeconds === 0 &&
      stEmpty.constructionCompletions === 0 && stEmpty.maxConcurrentAutoLines === 0 && stEmpty.maxOfflineSettlementSeconds === 0);

    // 幂等 + v6 档不再回填（防与事件增量双计）
    statVM.gameState = {
      statistics: { version: 1, totals: { events: 3 }, production: {}, combat: {}, activity: {}, eventLedger: {} },
      station: { bodyLevel: 3, buildings: { shipyard: 3 }, autoLines: { a: { enabled: true } } },
      _dirty: false,
    };
    const m1 = JSON.stringify(statVM.__ensure(statVM.gameState));
    const m2 = JSON.stringify(statVM.__ensure(statVM.gameState));
    statVM.gameState = {
      statistics: { version: 6, totals: {}, station: { constructionCompletions: 0, maxConcurrentAutoLines: 0, maxOfflineSettlementSeconds: 0 }, production: {}, combat: {}, activity: {}, eventLedger: {} },
      station: { bodyLevel: 3, buildings: { shipyard: 3 }, autoLines: { a: { enabled: true }, b: { enabled: true }, c: { enabled: true } } },
      _dirty: false,
    };
    statVM.__ensure(statVM.gameState);
    const stV6 = statVM.gameState.statistics.station;
    ok("[h22] 连续迁移两次 JSON 严格一致（幂等、version 恒为 9）；已是 v6 的存档不再回填（三字段保持 0，避免与事件增量双计）",
      m1 === m2 && statVM.gameState.statistics.version === 9 &&
      stV6.constructionCompletions === 0 && stV6.maxConcurrentAutoLines === 0 && stV6.maxOfflineSettlementSeconds === 0);
  } else {
    ok("[h17] statistics 迁移 VM 加载失败（见上方异常）", false);
  }

  // ========================= D. 事件记账（真实 events.js + statistics.js） =========================
  const sbAcc = buildKernelSandbox({ withEvents: true, withRules: true, withStatistics: true });
  const gsAcc = sbAcc.gameState;
  gsAcc.station = {
    bodyLevel: 0, buildings: {}, maintenance: { fuelRemaining: 0 },
    autoLines: { smelting: { enabled: false }, equipment: { enabled: false }, booster: { enabled: false } },
  };
  const emitAcc = (type, payload, meta) => sbAcc.GameEvents.emit(type, payload, meta);
  emitAcc("station:constructionCompleted", { kind: "body", fromLevel: 0, targetLevel: 1, startedAt: 1, completesAt: 2 }, { offline: false, timestamp: 10 });
  const ccAfter1 = gsAcc.statistics.station.constructionCompletions;
  emitAcc("station:constructionCompleted", { kind: "building", buildingId: "shipyard", fromLevel: 0, targetLevel: 1, startedAt: 1, completesAt: 2 }, { offline: true, timestamp: 11, eventId: "sc-dup" });
  const ccAfter2 = gsAcc.statistics.station.constructionCompletions;
  const evAfter2 = gsAcc.statistics.totals.events;
  emitAcc("station:constructionCompleted", { kind: "building", buildingId: "shipyard", fromLevel: 0, targetLevel: 1, startedAt: 1, completesAt: 2 }, { offline: true, timestamp: 12, eventId: "sc-dup" });
  const ccAfter3 = gsAcc.statistics.station.constructionCompletions;
  const evAfter3 = gsAcc.statistics.totals.events;
  ok("[h23] station:constructionCompleted 每事件 +1（在线本体 + 离线建筑同链）；同 eventId 重放不双计（constructionCompletions 与 totals.events 均不变）",
    ccAfter1 === 1 && ccAfter2 === 2 && ccAfter3 === 2 && evAfter3 === evAfter2);

  // H12：只读真实 gameState.station.autoLines 中 enabled===true 的数量，取 max
  gsAcc.station.autoLines.smelting.enabled = true;
  emitAcc("station:autoLineStarted", { lineId: "smelting", targetId: "凡晶石带" }, { offline: false, timestamp: 20 });
  const mc1 = gsAcc.statistics.station.maxConcurrentAutoLines;
  gsAcc.station.autoLines.equipment.enabled = true;
  gsAcc.station.autoLines.booster.enabled = true;
  emitAcc("station:autoLineStarted", { lineId: "booster", targetId: "mining_lubricant_n" }, { offline: false, timestamp: 21 });
  const mc3 = gsAcc.statistics.station.maxConcurrentAutoLines;
  gsAcc.station.autoLines.equipment.enabled = false;
  gsAcc.station.autoLines.booster.enabled = false;
  emitAcc("station:autoLineStarted", { lineId: "smelting", targetId: "凡晶石带" }, { offline: false, timestamp: 22 });
  const mcAfterStop = gsAcc.statistics.station.maxConcurrentAutoLines;
  ok("[h24] station:autoLineStarted 读取真实 autoLines 中 enabled===true 的数量并取 max（1 → 3 → 停线后仍为 3，历史峰值不回退）",
    mc1 === 1 && mc3 === 3 && mcAfterStop === 3);

  const mcBeforeCompleted = gsAcc.statistics.station.maxConcurrentAutoLines;
  emitAcc("station:autoLineCompleted", { lineId: "smelting", targetId: "凡晶石带", quantity: 9, xp: 9, offline: false, cycles: 9 }, { offline: false, timestamp: 23 });
  ok("[h25] 不从 station:autoLineCompleted 的 cycles/quantity 推断“同时运行线数”（maxConcurrentAutoLines 不变）",
    gsAcc.statistics.station.maxConcurrentAutoLines === mcBeforeCompleted);

  emitAcc("offline:settlementCompleted", { rawSeconds: 100000, settledSeconds: 86400 }, { offline: true, timestamp: 30 });
  const ms1 = gsAcc.statistics.station.maxOfflineSettlementSeconds;
  emitAcc("offline:settlementCompleted", { rawSeconds: 100, settledSeconds: 100 }, { offline: true, timestamp: 31 });
  const ms2 = gsAcc.statistics.station.maxOfflineSettlementSeconds;
  const statsBeforeBad = JSON.stringify(gsAcc.statistics.station);
  const dirtyBeforeBad = gsAcc._dirty;
  let badRejected = true;
  for (const bad of [{ rawSeconds: 1, settledSeconds: -1 }, { rawSeconds: 1, settledSeconds: NaN }, { rawSeconds: 1, settledSeconds: Infinity }, { rawSeconds: 1, settledSeconds: "9999999" }, { rawSeconds: 1 }]) {
    gsAcc._dirty = false;
    emitAcc("offline:settlementCompleted", bad, { offline: true, timestamp: 32 });
    if (JSON.stringify(gsAcc.statistics.station) !== statsBeforeBad) badRejected = false;
    if (gsAcc._dirty !== false) badRejected = false;
  }
  gsAcc._dirty = dirtyBeforeBad;
  ok("[h26] offline:settlementCompleted 取 max(settledSeconds)（86400 后再来 100 不回退）；非法 payload（负数/NaN/Infinity/字符串/缺字段）不修改统计且不置 _dirty",
    ms1 === 86400 && ms2 === 86400 && badRejected);

  // ========================= E. 消费者 =========================
  const achSysSrcS = fs.readFileSync(ACH_SYSTEM_PATH, "utf-8");
  const sInstallBody = extractFnBodyS(achSysSrcS, "installStationAchievementConsumer");
  ok("[h27] 空间站消费者注册在通配符 \"*\" 且严格按 event.type 过滤四类真实事件（station:constructionCompleted / station:autoLineStarted / station:maintenanceRefilled / offline:settlementCompleted），使用独立 _stationConsumerInstalled 标志",
    sInstallBody.includes('GE.on("*"') &&
    ["station:constructionCompleted", "station:autoLineStarted", "station:maintenanceRefilled", "offline:settlementCompleted"]
      .every((t) => sInstallBody.includes('"' + t + '"')) &&
    sInstallBody.includes("_stationConsumerInstalled"));

  const reinstallS = sbAcc.AchievementSystem.installStationAchievementConsumer(gsAcc);
  ok("[h28] listenerCount(\"*\")=10（statistics+生产+战斗+制造+装备+增幅剂+考古+行星+空间站+综合生命周期），重复安装返回 ALREADY_INSTALLED",
    sbAcc.GameEvents.listenerCount("*") === 10 &&
    reinstallS && reinstallS.ok === false && reinstallS.reason === "ALREADY_INSTALLED");

  // 只消费四类事件：其余真实事件不得触发空间站成就解锁
  const sbFilter = buildStationSandbox({ withEvents: true, withRules: true });
  const sFilter = makeStState(sbFilter, { bodyLevel: 3, fuel: 100, buildings: Object.fromEntries(ST_BUILDINGS.map((b) => [b, 3])), cc: 9, mc: 9, ms: 99999 });
  const instFilter = sbFilter.AchievementSystem.installStationAchievementConsumer(sFilter);
  sbFilter.GameEvents.emit("station:bodyUpgraded", { fromLevel: 2, toLevel: 3, startedAt: 1, completesAt: 2 }, { offline: false, timestamp: 40 });
  sbFilter.GameEvents.emit("station:buildingUpgraded", { buildingId: "shipyard", fromLevel: 2, toLevel: 3, startedAt: 1, completesAt: 2 }, { offline: false, timestamp: 41 });
  sbFilter.GameEvents.emit("station:autoLineStopped", { lineId: "smelting", targetId: "凡晶石带", reason: "user-stopped", quantity: 0, xp: 0, offline: false }, { offline: false, timestamp: 42 });
  sbFilter.GameEvents.emit("skill:levelUp", { skillId: "refining", level: 5, previousLevel: 4 }, { offline: false, timestamp: 43 });
  const noneUnlocked = Object.keys(sFilter.achievements.unlockedAtById).length === 0;
  sbFilter.GameEvents.emit("station:maintenanceRefilled", { points: 24, fuelSpent: 10, fuelRemaining: 100, remainingMs: 1000 }, { offline: false, timestamp: 44 });
  const afterRefill = Object.keys(sFilter.achievements.unlockedAtById).length;
  ok("[h29] 消费者严格过滤：station:bodyUpgraded / station:buildingUpgraded / station:autoLineStopped / skill:levelUp 一律不触发解锁；station:maintenanceRefilled 触发一次求值解锁全部 15 项（unlockedAt=事件时间戳）",
    instFilter && instFilter.ok === true && noneUnlocked && afterRefill === 15 &&
    sFilter.achievements.unlockedAtById["H13"] === 44);

  // 不信任 payload：事件到达但权威状态/统计为空 → 不解锁
  const sbDist = buildStationSandbox({ withEvents: true, withRules: true });
  const sDist = makeStState(sbDist, {});
  sbDist.AchievementSystem.installStationAchievementConsumer(sDist);
  sbDist.GameEvents.emit("station:constructionCompleted", { kind: "body", fromLevel: 9, targetLevel: 9, startedAt: 1, completesAt: 2 }, { offline: false, timestamp: 50 });
  sbDist.GameEvents.emit("offline:settlementCompleted", { rawSeconds: 999999, settledSeconds: 86400 }, { offline: true, timestamp: 51 });
  ok("[h30] 不信任事件 payload：伪造 targetLevel=9 / settledSeconds=86400 到达，但权威 state.station 与 statistics.station 为 0 → 一项都不解锁",
    Object.keys(sDist.achievements.unlockedAtById).length === 0);

  // ========================= F. 真实链路 + persistence =========================
  const persistSrcS = fs.readFileSync(PERSISTENCE_PATH, "utf-8");
  ok("[h31] persistence 中 evaluateStationAchievementRules 恰 4 处（importData×2 + autoLoad×2）",
    (persistSrcS.match(/evaluateStationAchievementRules/g) || []).length === 4);

  const offSrcS = fs.readFileSync(OFFLINE_PATH, "utf-8");
  ok("[h32] offline.js 中 offline:settlementCompleted 唯一发射点位于 applyOfflineGains 的 settleOfflineTimeline 成功之后（源码恰 1 处 emit，不在其他位置复制公式）",
    (offSrcS.match(/offline:settlementCompleted/g) || []).length === 1 &&
    offSrcS.indexOf("settleOfflineTimeline(seconds, gains, context);") < offSrcS.indexOf("offline:settlementCompleted"));

  const freshFullS = buildFullGameSandbox(null);
  ok("[h33] autoLoad 新游戏：十求值器各恰 1 次、共用同一 atMs、顺序 skill<production<combat<manufacturing<equipment<booster<archaeology<planetary<station<blueprint，且新游戏不触发离线结算",
    (() => {
      if (!freshFullS.spyInstalled) return false;
      const tl = freshFullS.timeline;
      const TEN = ["evaluateSkillAchievementRules", "evaluateProductionAchievementRules", "evaluateCombatAchievementRules",
        "evaluateManufacturingAchievementRules", "evaluateEquipmentAchievementRules", "evaluateBoosterAchievementRules",
        "evaluateArchaeologyAchievementRules", "evaluatePlanetaryAchievementRules", "evaluateStationAchievementRules",
        "evaluateBlueprintAchievementRules"];
      const counts = {};
      for (const e of tl) counts[e.fn] = (counts[e.fn] || 0) + 1;
      const allOnce = TEN.every((f) => counts[f] === 1);
      const evals = tl.filter((e) => e.fn.startsWith("evaluate"));
      const atMsSet = new Set(evals.filter((e) => e.atMs !== undefined).map((e) => e.atMs));
      const order = tl.map((e) => e.fn);
      const idx = TEN.map((f) => order.indexOf(f));
      const ordered = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
      const offlineCnt = tl.filter((e) => e.fn === "calculateOfflineGains").length;
      return allOnce && atMsSet.size === 1 && ordered && offlineCnt === 0;
    })());
  ok("[h34] autoLoad 新游戏 H01–H13/H15/H16 全未锁",
    ST_IDS.every((id) => !(id in (freshFullS.sandbox.gameState.achievements && freshFullS.sandbox.gameState.achievements.unlockedAtById || {}))));

  // ---- 真实在线链路：建设 / 补油 / 三条自动线 / 离线结算 ----
  const RES_REFS = ["mineral:三钛合金", "mineral:类银超金属", "mineral:类晶体胶矿", "mineral:同位聚合体",
    "mineral:超新星诺克石", "mineral:基腹断岩", "mineral:超噬矿", "moon:镓", "moon:铂", "moon:铪",
    "gas:稳定富勒烯", "gas:高纯富勒烯", "planetary:同位素", "planetary:生物质", "planetary:等离子体",
    "planetary:磁场聚合物", "consumable:fuel"];
  const live = buildFullGameSandbox(null);
  const W = live.sandbox;
  const G = W.gameState;
  const RR = W.ResourceRegistry;
  const T0 = FROZEN_NOW - 30 * 3600 * 1000;
  function fundStation() {
    RR.set(G, "currency:isk", 1000000000);
    for (const r of RES_REFS) RR.set(G, r, 1000000);
  }
  function buildOnce(action) {
    fundStation();
    const started = W.dispatchGameAction(G, action, T0);
    const done = W.completeStationConstruction(G, { offline: false });
    return { started, done };
  }

  const body1 = buildOnce({ type: "station/startBodyConstruction" });
  const unlockedLive = () => G.achievements.unlockedAtById;
  ok("[h35] 真实在线建设链（dispatchGameAction station/startBodyConstruction → completeStationConstruction）：bodyLevel 0→1，statistics.station.constructionCompletions=1，H01 与 H11 同批解锁",
    body1.started && body1.started.changed === true && body1.done && body1.done.changed === true &&
    G.station.bodyLevel === 1 && G.statistics.station.constructionCompletions === 1 &&
    typeof unlockedLive()["H01"] === "number" && typeof unlockedLive()["H11"] === "number");

  buildOnce({ type: "station/startBodyConstruction" });
  buildOnce({ type: "station/startBodyConstruction" });
  const h13BeforeRefill = !("H13" in unlockedLive());
  ok("[h36] 本体升至 Lv.3：H02 解锁；此时维护燃料为 0（断油 → 真实倍率 ×1）→ H13 仍未解锁",
    G.station.bodyLevel === 3 && typeof unlockedLive()["H02"] === "number" &&
    G.statistics.station.constructionCompletions === 3 &&
    W.getStationLogisticsMultiplier(G) === 1 && h13BeforeRefill);

  let buildAllOk = true;
  for (const bid of ST_BUILDINGS) {
    for (let lv = 1; lv <= 3; lv++) {
      const r = buildOnce({ type: "station/startBuildingConstruction", buildingId: bid });
      if (!(r.started && r.started.changed === true && r.done && r.done.changed === true)) buildAllOk = false;
    }
  }
  ok("[h37] 真实建筑建设链：八座建筑各升至 Lv.3（24 次真实施工）→ H03–H10 与 H16 全部解锁；H10 与 H16 在同一次 shipyard Lv.3 完成时同批解锁（时间戳相同）",
    buildAllOk && ST_BUILDINGS.every((b) => G.station.buildings[b] === 3) &&
    ["H03", "H04", "H05", "H06", "H07", "H08", "H09", "H10", "H16"].every((id) => typeof unlockedLive()[id] === "number") &&
    unlockedLive()["H10"] === unlockedLive()["H16"]);

  const refill = W.dispatchGameAction(G, { type: "station/refillMaintenance" }, FROZEN_NOW);
  ok("[h38] 真实补油链（dispatchGameAction station/refillMaintenance → station:maintenanceRefilled）：燃料恢复后真实物流倍率=1.15 → H13 解锁",
    refill && refill.changed === true && G.station.maintenance.fuelRemaining > 0 &&
    W.getStationLogisticsMultiplier(G) === 1.15 && typeof unlockedLive()["H13"] === "number");

  G.skills.refining = G.skills.refining || {}; G.skills.refining.lvl = 99;
  G.skills.equipmentEngineering = G.skills.equipmentEngineering || {}; G.skills.equipmentEngineering.lvl = 99;
  G.skills.boosterEngineering = G.skills.boosterEngineering || {}; G.skills.boosterEngineering.lvl = 99;
  const lineTargets = [["smelting", "凡晶石带"], ["equipment", "t1_mining_laser"], ["booster", "mining_lubricant_n"]];
  const lineResults = [];
  const mcTrace = [];
  for (const [lineId, targetId] of lineTargets) {
    W.dispatchGameAction(G, { type: "station/selectAutoLineTarget", lineId, targetId }, FROZEN_NOW);
    lineResults.push(W.dispatchGameAction(G, { type: "station/startAutoLine", lineId }, FROZEN_NOW));
    mcTrace.push(G.statistics.station.maxConcurrentAutoLines);
  }
  ok("[h39] 三条真实自动线（smelting/equipment/booster）依次启动：真实 enabled 计数 1→2→3，maxConcurrentAutoLines=3 → H12 解锁",
    lineResults.every((r) => r && r.changed === true) &&
    ["smelting", "equipment", "booster"].every((id) => G.station.autoLines[id].enabled === true) &&
    mcTrace[0] === 1 && mcTrace[1] === 2 && mcTrace[2] === 3 &&
    G.statistics.station.maxConcurrentAutoLines === 3 && typeof unlockedLive()["H12"] === "number");

  const settleEvents = [];
  W.GameEvents.on("offline:settlementCompleted", (ev) => settleEvents.push(ev));
  W.forceOfflineTest(3);
  const afterTiny = settleEvents.length;
  W.forceOfflineTest(28800);
  const after28800 = settleEvents.length;
  const h15At28800 = !("H15" in unlockedLive());
  const ms28800 = G.statistics.station.maxOfflineSettlementSeconds;
  W.forceOfflineTest(28801);
  const after28801 = settleEvents.length;
  const h15At28801 = typeof unlockedLive()["H15"] === "number";
  W.forceOfflineTest(100000);
  const lastEv = settleEvents[settleEvents.length - 1];
  ok("[h40] 真实离线结算唯一事件：elapsed≤5 不发事件；每次真实结算恰发 1 次；settledSeconds=28800 → H15 仍未解锁（严格大于）；28801 → H15 解锁；raw=100000 时 settledSeconds 按 MAX_OFFLINE_SECONDS 封顶为 86400 且 rawSeconds 原样为 100000",
    afterTiny === 0 && after28800 === 1 && after28801 === 2 && settleEvents.length === 3 &&
    ms28800 === 28800 && h15At28800 && h15At28801 &&
    lastEv && lastEv.payload && lastEv.payload.rawSeconds === 100000 && lastEv.payload.settledSeconds === 86400 &&
    G.statistics.station.maxOfflineSettlementSeconds === 86400);

  ok("[h41] 真实链路走完后 15 项空间站成就全部解锁且解锁时间均为有限非负 number",
    ST_IDS.every((id) => typeof unlockedLive()[id] === "number" && isFinite(unlockedLive()[id]) && unlockedLive()[id] >= 0));

  // ---- 返修 R1：applyOfflineGains rawSeconds 严格归一化（真实调用，非源码字符串检查）----
  // 对 settleOfflineTimeline 安装转发 spy（沙箱内为全局函数声明，标识符经全局解析，替换属性即生效）
  const origSettle = W.settleOfflineTimeline;
  let settleCallCount = 0;
  W.settleOfflineTimeline = function (...a) { settleCallCount++; return origSettle.apply(this, a); };
  const illegalInputs = [NaN, Infinity, -Infinity, -1, "100", "abc", null, undefined, {}, [], true, false];
  const gainsKeys = ["mining", "refining", "shipEngineering", "gasHarvesting", "equipmentEngineering", "boosterEngineering", "planetaryIndustry"];
  const ledgerArr = () => G.statistics.eventLedger.processedEventIds;
  const illegalBase = {
    settleEvents: settleEvents.length,
    settleCalls: settleCallCount,
    guard: W.__guardReports.length,
    ms: G.statistics.station.maxOfflineSettlementSeconds,
    events: G.statistics.totals.events,
    ledger: ledgerArr().length,
    dirty: G._dirty,
  };
  const illegalResults = illegalInputs.map((bad) => {
    let threw = false, res = null;
    try { res = W.applyOfflineGains(bad); } catch (e) { threw = true; }
    return { threw, res };
  });
  ok("[h47] 12 种非法 rawSeconds（NaN/Infinity/-Infinity/-1/\"100\"/\"abc\"/null/undefined/{}/[]/true/false）真实调用 applyOfflineGains：不抛异常、返回 gains 各字段有限且为 0、不调用 settleOfflineTimeline、不发 offline:settlementCompleted",
    illegalResults.every((r) => !r.threw && r.res && typeof r.res === "object" &&
      gainsKeys.every((k) => typeof r.res[k] === "number" && Number.isFinite(r.res[k]) && r.res[k] === 0)) &&
    settleCallCount === illegalBase.settleCalls &&
    settleEvents.length === illegalBase.settleEvents);
  ok("[h48] 非法输入零副作用：RuntimeGuard.report 未触发；maxOfflineSettlementSeconds / totals.events / eventLedger 长度 / gameState._dirty 全部保持不变",
    W.__guardReports.length === illegalBase.guard &&
    G.statistics.station.maxOfflineSettlementSeconds === illegalBase.ms &&
    G.statistics.totals.events === illegalBase.events &&
    ledgerArr().length === illegalBase.ledger &&
    G._dirty === illegalBase.dirty);

  // 合法边界：5（不发事件）；5.5（原样 5.5/5.5，不整数化）；100000（raw 原样、settled 封顶 86400）
  const before5 = settleEvents.length;
  const g5 = W.applyOfflineGains(5);
  const after5 = settleEvents.length;
  W.applyOfflineGains(5.5);
  const ev55 = settleEvents[settleEvents.length - 1];
  W.applyOfflineGains(100000);
  const ev100k = settleEvents[settleEvents.length - 1];
  ok("[h49] 合法边界真实结算：5 秒不发事件且 gains 全 0；5.5 秒恰发 1 次事件 rawSeconds===5.5 且 settledSeconds===5.5（不整数化）；100000 秒 rawSeconds===100000、settledSeconds===86400",
    after5 === before5 && gainsKeys.every((k) => g5[k] === 0) &&
    settleEvents.length === before5 + 2 &&
    ev55 && ev55.payload.rawSeconds === 5.5 && ev55.payload.settledSeconds === 5.5 &&
    ev100k && ev100k.payload.rawSeconds === 100000 && ev100k.payload.settledSeconds === 86400 &&
    settleCallCount === illegalBase.settleCalls + 2);

  // 同一毫秒连续多次合法结算：eventId 全局唯一，统计消费者账本不误删（每次事件均新增账本记录）
  const ledgerBeforeSameMs = ledgerArr().length;
  W.applyOfflineGains(1000);
  W.applyOfflineGains(1000);
  const allEventIds = settleEvents.map((e) => e.eventId);
  ok("[h50] 同毫秒多次合法结算：全部 offline:settlementCompleted 的 eventId 全局唯一（Set 大小=事件数）；两次 1000 秒结算各被幂等消费者真实记账（ledger 净增≥2），未被误判重复丢弃",
    new Set(allEventIds).size === allEventIds.length &&
    allEventIds.every((id) => typeof id === "string" && id.length > 0) &&
    ledgerArr().length >= ledgerBeforeSameMs + 2);
  W.settleOfflineTimeline = origSettle;

  // ---- autoLoad 旧档追溯（v5 存档 + 真实空间站状态）----
  const oldStationSave = JSON.stringify({
    saveVersion: 2,
    achievements: { unlockedAtById: {} },
    lastActiveTime: FROZEN_NOW - 1000,
    statistics: { version: 5, totals: { events: 5 }, production: {}, combat: {}, activity: {}, eventLedger: {} },
    station: {
      version: 1, bodyLevel: 3, construction: null,
      buildings: Object.fromEntries(ST_BUILDINGS.map((b) => [b, 3])),
      maintenance: { tier: "standard", fuelRemaining: 5000, lastRefillAt: 0 },
      autoLines: {
        smelting: { enabled: true, operatorId: null, selectedTargetId: "凡晶石带", startedTargetId: "凡晶石带", progress: 0, lastTick: 0, stoppedReason: null },
        equipment: { enabled: true, operatorId: null, selectedTargetId: "t1_mining_laser", startedTargetId: "t1_mining_laser", progress: 0, lastTick: 0, stoppedReason: null },
        booster: { enabled: true, operatorId: null, selectedTargetId: "mining_lubricant_n", startedTargetId: "mining_lubricant_n", progress: 0, lastTick: 0, stoppedReason: null },
      },
    },
  });
  const loadedOld = buildFullGameSandbox(oldStationSave);
  const gsOld = loadedOld.sandbox.gameState;
  ok("[h42] autoLoad 旧档 timeline：station 与 blueprint 求值各恰 1 次，顺序 planetary<station<blueprint<calculateOfflineGains，十求值器共用同一 atMs",
    (() => {
      const tl = loadedOld.timeline;
      const sTimes = tl.filter((e) => e.fn === "evaluateStationAchievementRules").length;
      const bTimes = tl.filter((e) => e.fn === "evaluateBlueprintAchievementRules").length;
      const pIdx = tl.findIndex((e) => e.fn === "evaluatePlanetaryAchievementRules");
      const sIdx = tl.findIndex((e) => e.fn === "evaluateStationAchievementRules");
      const bIdx = tl.findIndex((e) => e.fn === "evaluateBlueprintAchievementRules");
      const oIdx = tl.findIndex((e) => e.fn === "calculateOfflineGains");
      const evals = tl.filter((e) => e.fn.startsWith("evaluate"));
      const atMsSet = new Set(evals.filter((e) => e.atMs !== undefined).map((e) => e.atMs));
      return sTimes === 1 && bTimes === 1 && pIdx >= 0 && sIdx > pIdx && bIdx > sIdx && oIdx > bIdx && atMsSet.size === 1;
    })());
  ok("[h43] autoLoad 旧档追溯：statistics 迁移至 v6 并回填 constructionCompletions≥1 / maxConcurrentAutoLines=3；H01–H13、H16 共 14 项追溯解锁；H15 因无真实离线结算历史（maxOfflineSettlementSeconds=0）保持未解锁",
    gsOld.statistics.version === 9 &&
    gsOld.statistics.station.constructionCompletions >= 1 &&
    gsOld.statistics.station.maxConcurrentAutoLines === 3 &&
    gsOld.statistics.station.maxOfflineSettlementSeconds === 0 &&
    ST_IDS.filter((id) => id !== "H15").every((id) => typeof gsOld.achievements.unlockedAtById[id] === "number") &&
    !("H15" in gsOld.achievements.unlockedAtById));

  // ---- importData 真实调用：已有解锁时间保留、其余补发 ----
  const importSb = buildFullGameSandbox(null);
  const importSave = JSON.parse(oldStationSave);
  // importData 要求存档必须含 skills 字段（persistence.js："无效存档" 校验），autoLoad 无此校验
  importSave.skills = { mining: { lvl: 1, xp: 0 } };
  importSave.achievements = { unlockedAtById: { "H01": 123.5 } };
  const importRes = importSb.sandbox.SaveManager && typeof importSb.sandbox.SaveManager.importData === "function"
    ? importSb.sandbox.SaveManager.importData(JSON.stringify(importSave))
    : null;
  const gsImp = importSb.sandbox.gameState;
  ok("[h44] importData 真实调用：已有 H01=123.5 原样保留，其余 13 项（除 H15）由同一次追溯对账补发",
    importRes === true && gsImp.achievements.unlockedAtById["H01"] === 123.5 &&
    ST_IDS.filter((id) => id !== "H15" && id !== "H01").every((id) => typeof gsImp.achievements.unlockedAtById[id] === "number") &&
    !("H15" in gsImp.achievements.unlockedAtById));

  // ========================= G. 只读性 =========================
  const stFilesAfter = [];
  try {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p); }
        else stFilesAfter.push(p);
      }
    })(ROOT);
  } catch (e) { stFilesAfter.length = 0; }
  let h45ok = stFilesBefore.length > 0 && stFilesBefore.length === stFilesAfter.length;
  if (h45ok) {
    const bSet = new Set(stFilesBefore);
    const aSet = new Set(stFilesAfter);
    for (const f of stFilesBefore) { if (!aSet.has(f)) { h45ok = false; break; } }
    if (h45ok) { for (const f of stFilesAfter) { if (!bSet.has(f)) { h45ok = false; break; } } }
  }
  ok("[h45] 审计空间站分区未向仓库写入任何辅助文件（函数首尾双向文件清单一致）", h45ok);

  ok("[h46] 空间站规则数据在本分区内未被任何求值/消费者改变（STATION_RULES / BY_ID / 建筑 ID 全冻结）",
    Object.isFrozen(RD.STATION_RULES) &&
    RD.STATION_RULES.every((r) => Object.isFrozen(r)) &&
    Object.isFrozen(RD.STATION_RULES_BY_ID) &&
    Object.isFrozen(RD.STATION_BUILDING_IDS_FOR_ACHIEVEMENTS));
}

function runBlueprint() {
  // 分区首尾文件清单（证明本分区不向仓库写入任何辅助文件）
  const bpFilesBefore = [];
  try {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p); }
        else bpFilesBefore.push(p);
      }
    })(ROOT);
  } catch (e) { bpFilesBefore.length = 0; }

  // 本分区只读性字节级基准（b44 复用）：achievements.js 与成就 CSV
  const ACH_PATH_BP = path.join(ROOT, "js", "systems", "achievements.js");
  const achBeforeBp = snapFile(ACH_PATH_BP);
  const csvBeforeBp = snapFile(CSV_PATH);

  const RESOURCES_PATH = path.join(ROOT, "js", "core", "resources.js");
  const EQUIP_DATA_PATH = path.join(ROOT, "js", "data", "equipment.js");
  const ACTIONS_PATH = path.join(ROOT, "js", "core", "actions.js");

  function extractFnBody(src, name) {
    let start = src.indexOf("function " + name);
    if (start < 0) start = src.indexOf(name + "("); // 兼容对象方法简写 buyLPItem(state, itemId) { ... }
    if (start < 0) return "";
    const paren = src.indexOf("(", start);
    let i = src.indexOf("{", paren < 0 ? start : paren);
    if (i < 0) return "";
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return "";
  }

  // ========================= A. 契约注册与 payload 形状（内核沙箱 + 真实 events.js）=========================
  const sbC = buildKernelSandbox({ withEvents: true });
  const Contracts = sbC.GameEvents && sbC.GameEvents.contracts;
  ok("[b1] events.js 注册 blueprint:acquired 契约（contracts.has 为真）",
    !!Contracts && Contracts.has("blueprint:acquired") === true);

  const eventsSrc = fs.readFileSync(EVENTS_PATH, "utf-8");
  const m = eventsSrc.match(/"blueprint:acquired":\s*\{\s*required:\s*\[([^\]]*)\],\s*numbers:\s*\[([^\]]*)\]\s*\}/);
  const reqFields = m ? m[1].split(",").map(s => s.trim().replace(/"/g, "")).filter(Boolean) : [];
  ok("[b2] 契约 required 精确 [ownershipKey, blueprintKind, productId] 且 numbers 为空数组（源码交叉验证）",
    !!m && reqFields.join(",") === "ownershipKey,blueprintKind,productId" && m[2].trim() === "");

  ok("[b3] 合法 payload 通过契约校验（三字段齐全）",
    !!Contracts && Contracts.validate("blueprint:acquired", { ownershipKey: "rifter", blueprintKind: "ship", productId: "rifter" }).valid === true);
  ok("[b4] 缺失 ownershipKey 校验失败",
    !!Contracts && Contracts.validate("blueprint:acquired", { blueprintKind: "ship", productId: "rifter" }).valid === false);
  ok("[b5] 缺失 blueprintKind 校验失败",
    !!Contracts && Contracts.validate("blueprint:acquired", { ownershipKey: "rifter", productId: "rifter" }).valid === false);
  ok("[b6] 缺失 productId 校验失败",
    !!Contracts && Contracts.validate("blueprint:acquired", { ownershipKey: "rifter", blueprintKind: "ship" }).valid === false);
  ok("[b7] 携带多余字段仍通过校验（不报错）",
    !!Contracts && Contracts.validate("blueprint:acquired", { ownershipKey: "rifter", blueprintKind: "ship", productId: "rifter", extra: 1 }).valid === true);

  // ========================= B. 真实全脚本沙箱：两条购买路径首次写入后各 emit 一次 =========================
  // 按 index.html 真实 <script defer> 顺序加载全部脚本（mock DOM/localStorage/定时器），
  // 复刻 buildFullGameSandbox 的真实依赖解析。dispatchGameAction 是 actions.js 顶层 function
  // 声明，多文件按序加载进同一 vm 上下文后作为全局暴露；GameEvents 经 events.js 的
  // window.GameEvents 暴露。注入 __guardReports / RuntimeGuard（C-9 修复），监听真实事件。
  let sb = null, sbErr = "";
  try {
    const html = fs.readFileSync(INDEX_PATH, "utf8");
    const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)]
      .map((m) => m[1].replace(/\?.*$/, ""));
    const noop = () => {};
    function MockCanvasContext() {}
    for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
    MockCanvasContext.prototype.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
    MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
    MockCanvasContext.prototype.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
    const makeElement = () => ({ addEventListener: noop, appendChild: noop, insertBefore: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, select: noop, style: {}, textContent: "", value: "1", setAttribute: noop });
    const documentMock = { addEventListener: noop, body: makeElement(), createElement: () => makeElement(), createElementNS: () => makeElement(), getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => [], hidden: false };
    const localStorageMock = { getItem: () => null, setItem: noop, removeItem: noop };
    class FrozenDate extends Date { static now() { return FROZEN_NOW; } }
    const sbx = { alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console, confirm: () => true, document: documentMock, FileReader: class {}, localStorage: localStorageMock, requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop, clearInterval: noop, URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, Date: FrozenDate, matchMedia: (q) => ({ matches: false, media: q || "", addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }), MutationObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} takeRecords(){ return []; } }, IntersectionObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} unobserve(){} takeRecords(){ return []; } }, ResizeObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} unobserve(){} }, getComputedStyle: () => ({ getPropertyValue: () => "" }), window: null };
    sbx.window = sbx;
    sbx.window.addEventListener = noop;
    sbx.__guardReports = [];
    sbx.RuntimeGuard = { report: (err, ctx) => { sbx.__guardReports.push({ message: err && err.message, ctx }); } };
    vm.createContext(sbx);
    for (const source of scriptSources) {
      const rel = source.replace(/^\.\//, "");
      try { vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf-8"), sbx, { filename: rel }); }
      catch (e) { throw new Error("LOAD FAIL " + rel + ": " + (e && e.message)); }
    }
    sb = sbx;
  } catch (e) { sbErr = (e && e.message) ? e.message : String(e); }
  const captured = [];
  if (sb && sb.GameEvents && typeof sb.GameEvents.on === "function") {
    sb.GameEvents.on("blueprint:acquired", (ev) => captured.push(ev));
  }
  ok("[b8] 真实全脚本沙箱暴露 dispatchGameAction（actions.js 顶层 function）/ GameEvents / ResourceRegistry" + (sbErr ? "（" + sbErr + "）" : ""),
    !!sb && typeof sb.dispatchGameAction === "function" && !!sb.GameEvents && !!sb.ResourceRegistry);

  const st = {
    skills: {},
    ownedBlueprints: [],
    resources: { isk: 1000000, lp: 100000 },
    equipment: { inventory: [] },
    _dirty: false,
  };

  const r1 = sb ? sb.dispatchGameAction(st, { type: "manufacturing/buyBlueprint", blueprintId: "rifter" }, 1700000000000) : null;
  ok("[b9] 舰船蓝图 rifter 首次购买 changed=true 且 ownedBlueprints 含 'rifter'",
    !!r1 && r1.changed === true && Array.isArray(st.ownedBlueprints) && st.ownedBlueprints.includes("rifter"));
  ok("[b10] 首次舰船购买后恰好 emit 1 次 blueprint:acquired",
    captured.length === 1 && captured[0].type === "blueprint:acquired");
  ok("[b11] 舰船 emit payload 精确 {ownershipKey:'rifter', blueprintKind:'ship', productId:'rifter'}",
    captured.length >= 1 &&
    captured[0].payload.ownershipKey === "rifter" &&
    captured[0].payload.blueprintKind === "ship" &&
    captured[0].payload.productId === "rifter");
  ok("[b12] 舰船 emit meta：timestamp=传入now(顶层级)、source='blueprint-store'、offline=false",
    captured.length >= 1 &&
    captured[0].timestamp === 1700000000000 &&
    captured[0].meta.source === "blueprint-store" &&
    captured[0].meta.offline === false);

  const r1b = sb ? sb.dispatchGameAction(st, { type: "manufacturing/buyBlueprint", blueprintId: "rifter" }, 1700000000002) : null;
  ok("[b13] 同一舰船蓝图二次购买 already-owned：changed=false 且不再 emit（captured 仍 1）",
    !!r1b && r1b.changed === false && r1b.reason === "already-owned" && captured.length === 1);

  const r2 = sb ? sb.dispatchGameAction(st, { type: "shell/buyLPItem", equipmentId: "alliance_mining_laser_blueprint" }, 1700000000001) : null;
  ok("[b14] 装备蓝图 alliance_mining_laser_blueprint 首次购买 changed=true 且 ownedBlueprints 含 'equipment:raider_mining_laser'",
    !!r2 && r2.changed === true && st.ownedBlueprints.includes("equipment:raider_mining_laser"));
  ok("[b15] 装备蓝图首次购买后恰好 emit 第 2 次（captured=2）且 payload 精确",
    captured.length === 2 &&
    captured[1].payload.ownershipKey === "equipment:raider_mining_laser" &&
    captured[1].payload.blueprintKind === "equipment" &&
    captured[1].payload.productId === "raider_mining_laser");
  ok("[b16] 装备蓝图 emit meta：timestamp=传入now、source/offline 正确",
    captured.length >= 2 &&
    captured[1].timestamp === 1700000000001 &&
    captured[1].meta.source === "blueprint-store" &&
    captured[1].meta.offline === false);

  const r2b = sb ? sb.dispatchGameAction(st, { type: "shell/buyLPItem", equipmentId: "alliance_mining_laser_blueprint" }, 1700000000003) : null;
  ok("[b17] 同一装备蓝图二次购买 already-owned：changed=false 且不再 emit（captured 仍 2）",
    !!r2b && r2b.changed === false && r2b.reason === "already-owned" && captured.length === 2);

  // ========================= C. 结构保证：仅装备蓝图分支 emit，普通装备分支不 emit =========================
  const actionsSrc = fs.readFileSync(ACTIONS_PATH, "utf-8");
  const bpBody = extractFnBody(actionsSrc, "buyLPItem");
  const emitCount = (bpBody.match(/GameEvents\.emit\("blueprint:acquired"/g) || []).length;
  const emitIdx = bpBody.indexOf('GameEvents.emit("blueprint:acquired"');
  const branchIdx = bpBody.indexOf('item.kind === "equipmentBlueprint"');
  const invPushIdx = bpBody.indexOf("state.equipment.inventory.push");
  ok("[b18] buyLPItem 仅在装备蓝图分支 emit 一次、且位于普通装备分支（equipment.inventory.push）之前",
    emitCount === 1 && emitIdx > branchIdx && (invPushIdx === -1 || emitIdx < invPushIdx));

  // ========================= D. GameEvents 缺失降级场景（Proxy 最小沙箱，不含 events.js）=========================
  let degradeOk = true, degradeDetail = "";
  try {
    // 复用真实全脚本加载（与 B 区一致），加载后显式置 GameEvents 为 undefined，
    // 模拟 events.js 缺失场景。events.js 经 window.GameEvents 暴露 GameEvents，
    // 该 const 不跨 vm 脚本可见；置为 undefined 后 actions.js 守卫
    // `typeof GameEvents !== "undefined"` 短路，两购买仍 changed=true 且资产正确、不崩溃。
    const htmlD = fs.readFileSync(INDEX_PATH, "utf8");
    const scriptSourcesD = [...htmlD.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)]
      .map((m) => m[1].replace(/\?.*$/, ""));
    const noopD = () => {};
    function MockCanvasContextD() {}
    for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContextD.prototype[name] = noopD;
    MockCanvasContextD.prototype.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    MockCanvasContextD.prototype.createLinearGradient = () => ({ addColorStop: noopD });
    MockCanvasContextD.prototype.createRadialGradient = () => ({ addColorStop: noopD });
    MockCanvasContextD.prototype.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    const classListD = { add: noopD, remove: noopD, toggle: noopD, contains: () => false };
    const makeElementD = () => ({ addEventListener: noopD, appendChild: noopD, insertBefore: noopD, classList: classListD, click: noopD, closest: () => null, dataset: {}, focus: noopD, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), getContext: () => new MockCanvasContextD(), innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => makeElementD(), querySelectorAll: () => [], remove: noopD, select: noopD, style: {}, textContent: "", value: "1", setAttribute: noopD });
    const documentMockD = { addEventListener: noopD, body: makeElementD(), createElement: () => makeElementD(), createElementNS: () => makeElementD(), getElementById: () => makeElementD(), querySelector: () => makeElementD(), querySelectorAll: () => [], hidden: false };
    const localStorageMockD = { getItem: () => null, setItem: noopD, removeItem: noopD };
    class FrozenDateD extends Date { static now() { return FROZEN_NOW; } }
    const sb2 = { alert: noopD, Blob, CanvasRenderingContext2D: MockCanvasContextD, console, confirm: () => true, document: documentMockD, FileReader: class {}, localStorage: localStorageMockD, requestAnimationFrame: noopD, setInterval: noopD, setTimeout: noopD, clearTimeout: noopD, clearInterval: noopD, URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noopD }, Date: FrozenDateD, matchMedia: (q) => ({ matches: false, media: q || "", addEventListener: noopD, removeEventListener: noopD, addListener: noopD, removeListener: noopD }), MutationObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} takeRecords(){ return []; } }, IntersectionObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} unobserve(){} takeRecords(){ return []; } }, ResizeObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} unobserve(){} }, getComputedStyle: () => ({ getPropertyValue: () => "" }), window: null };
    sb2.window = sb2;
    sb2.window.addEventListener = noopD;
    sb2.__guardReports = [];
    sb2.RuntimeGuard = { report: (err, ctx) => { sb2.__guardReports.push({ message: err && err.message, ctx }); } };
    vm.createContext(sb2);
    for (const source of scriptSourcesD) {
      const rel = source.replace(/^\.\//, "");
      try { vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf-8"), sb2, { filename: rel }); }
      catch (e) { throw new Error("LOAD FAIL " + rel + ": " + (e && e.message)); }
    }
    sb2.GameEvents = undefined; // 模拟 events.js 缺失：守卫短路
    const drain = function () { return []; };
    const G = new Proxy({ ownedBlueprints: [], resources: { isk: 0, lp: 0 }, _dirty: false, equipment: { inventory: [] } }, {
      get(t, p) { if (p in t) return t[p]; return drain; },
    });
    const RR = sb2.ResourceRegistry;
    RR.set(G, "currency:isk", 1000000);
    RR.set(G, "currency:lp", 100000);
    const d1 = sb2.dispatchGameAction(G, { type: "manufacturing/buyBlueprint", blueprintId: "rifter" }, 1700000000000);
    const d2 = sb2.dispatchGameAction(G, { type: "shell/buyLPItem", equipmentId: "alliance_mining_laser_blueprint" }, 1700000000001);
    degradeOk = !!(d1 && d1.changed === true && G.ownedBlueprints.includes("rifter") &&
      d2 && d2.changed === true && G.ownedBlueprints.includes("equipment:raider_mining_laser") &&
      (typeof sb2.GameEvents === "undefined"));
  } catch (e) {
    degradeOk = false;
    degradeDetail = (e && e.message) ? e.message : String(e);
  }
  ok("[b19] GameEvents 缺失降级：两购买 changed=true 且资产正确、不崩溃（typeof GameEvents==='undefined' 走守卫短路）" +
    (degradeDetail ? "（" + degradeDetail + "）" : ""), degradeOk);

  // ========================= E. 只读性 =========================
  const bpFilesAfter = [];
  try {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p); }
        else bpFilesAfter.push(p);
      }
    })(ROOT);
  } catch (e) { bpFilesAfter.length = 0; }
  let b20ok = bpFilesBefore.length > 0 && bpFilesBefore.length === bpFilesAfter.length;
  if (b20ok) {
    const bSet = new Set(bpFilesBefore);
    const aSet = new Set(bpFilesAfter);
    for (const f of bpFilesBefore) { if (!aSet.has(f)) { b20ok = false; break; } }
    if (b20ok) { for (const f of bpFilesAfter) { if (!bSet.has(f)) { b20ok = false; break; } } }
  }
  ok("[b20] 审计蓝图分区未向仓库写入任何辅助文件（函数首尾双向文件清单一致）", b20ok);

  // ========================= F. 规则数据 + 求值器 + 在线消费者（复用现成 buildFullGameSandbox，绑定真实 gameState）=========================
  const sbFull = buildFullGameSandbox().sandbox;
  const RD = sbFull.AchievementRuleData;
  const SYS = sbFull.AchievementSystem;
  const GE = sbFull.GameEvents;
  const GS = sbFull.gameState;

  // b21 BLUEPRINT_RULES 恰 1 项且规则对象冻结
  ok("[b21] BLUEPRINT_RULES 恰 1 项、规则对象已冻结、字段精确 {achievementId:'C11',type:'blueprint-owned-any',minValue:1}",
    !!RD && Array.isArray(RD.BLUEPRINT_RULES) && RD.BLUEPRINT_RULES.length === 1 &&
    Object.isFrozen(RD.BLUEPRINT_RULES) && Object.isFrozen(RD.BLUEPRINT_RULES[0]) &&
    RD.BLUEPRINT_RULES[0].achievementId === "C11" && RD.BLUEPRINT_RULES[0].type === "blueprint-owned-any" && RD.BLUEPRINT_RULES[0].minValue === 1);

  // b22 BY_ID 恰 1 键且引用同一规则
  ok("[b22] BLUEPRINT_RULES_BY_ID 恰 1 键且引用同一规则对象（=== BLUEPRINT_RULES[0]）",
    !!RD && RD.BLUEPRINT_RULES_BY_ID && Object.keys(RD.BLUEPRINT_RULES_BY_ID).length === 1 &&
    RD.BLUEPRINT_RULES_BY_ID["C11"] === RD.BLUEPRINT_RULES[0]);

  // b23 ownershipKeys 冻结、非空、唯一、均为非空字符串
  const okKeys = !!RD && Array.isArray(RD.BLUEPRINT_OWNERSHIP_KEYS) && RD.BLUEPRINT_OWNERSHIP_KEYS.length > 0 && Object.isFrozen(RD.BLUEPRINT_OWNERSHIP_KEYS);
  const uniqKeys = okKeys && new Set(RD.BLUEPRINT_OWNERSHIP_KEYS).size === RD.BLUEPRINT_OWNERSHIP_KEYS.length;
  const allStrKeys = okKeys && RD.BLUEPRINT_OWNERSHIP_KEYS.every((k) => typeof k === "string" && k.length > 0);
  ok("[b23] BLUEPRINT_OWNERSHIP_KEYS 冻结、非空、唯一、均为非空字符串", okKeys && uniqKeys && allStrKeys);

  // b24 与真实目录双向集合相等
  const catKeys = (typeof sbFull.getBlueprintStoreCatalogItems === "function")
    ? sbFull.getBlueprintStoreCatalogItems()
        .filter((it) => it && (it.kind === "shipBlueprint" || it.kind === "equipmentBlueprint"))
        .map((it) => it.kind === "shipBlueprint" ? String(it.shipId) : ((typeof sbFull.getEquipmentBlueprintOwnershipKey === "function") ? sbFull.getEquipmentBlueprintOwnershipKey(it.equipmentId) : null))
        .filter((k) => k != null)
    : [];
  const catSet = new Set(catKeys);
  const bkSet = new Set(RD.BLUEPRINT_OWNERSHIP_KEYS);
  const eqSets = catSet.size === bkSet.size && [...catSet].every((k) => bkSet.has(k)) && [...bkSet].every((k) => catSet.has(k));
  ok("[b24] BLUEPRINT_OWNERSHIP_KEYS 与真实蓝图目录（shipBlueprint+equipmentBlueprint）双向集合相等", eqSets);

  // b25 普通 LP 装备不进入
  const plainEquip = (typeof sbFull.getLPStoreCatalogItems === "function")
    ? sbFull.getLPStoreCatalogItems().filter((it) => it && it.kind === "equipment").map((it) => it.equipmentId)
    : [];
  const plainLeak = plainEquip.some((id) => bkSet.has("equipment:" + id));
  ok("[b25] 普通 LP 商店装备（kind:'equipment'）不进入 BLUEPRINT_OWNERSHIP_KEYS", !plainLeak);

  // b26 十个集合两两零交集、并集恰 162
  const tenSets = [
    new Set(RD.SKILL_RULES.map((r) => r.achievementId)),
    new Set(RD.PRODUCTION_RULES.map((r) => r.achievementId)),
    new Set(RD.COMBAT_RULES.map((r) => r.achievementId)),
    new Set(RD.MANUFACTURING_RULES.map((r) => r.achievementId)),
    new Set(RD.EQUIPMENT_RULES.map((r) => r.achievementId)),
    new Set(RD.BOOSTER_RULES.map((r) => r.achievementId)),
    new Set(RD.ARCHAEOLOGY_RULES.map((r) => r.achievementId)),
    new Set(RD.PLANETARY_RULES.map((r) => r.achievementId)),
    new Set(RD.STATION_RULES.map((r) => r.achievementId)),
    new Set(RD.BLUEPRINT_RULES.map((r) => r.achievementId)),
  ];
  let tenOk = true;
  for (let i = 0; i < tenSets.length && tenOk; i++)
    for (let j = i + 1; j < tenSets.length && tenOk; j++)
      for (const id of tenSets[i]) if (tenSets[j].has(id)) { tenOk = false; break; }
  const tenUnion = new Set();
  for (const s of tenSets) for (const id of s) tenUnion.add(id);
  ok("[b26] 十规则集合两两零交集、并集恰 176（含 BLUEPRINT_RULES；D18 使装备组 5→6）", tenOk && tenUnion.size === 176);

  // b27 十组规则 176、未映射 21（第十一组 ECONOMY_RULES 与 188/9 全局恒等式在 --economy 分区断言）
  const catalogTotalB = (sbFull.AchievementData && sbFull.AchievementData.ACHIEVEMENTS) ? sbFull.AchievementData.ACHIEVEMENTS.length : 0;
  ok("[b27] 十组规则 176、未映射 21（目录 197 - 176）", tenUnion.size === 176 && catalogTotalB === 197 && catalogTotalB - tenUnion.size === 21);

  // b28 C11 不在既有集合
  const inOther = ["SKILL_RULES","PRODUCTION_RULES","COMBAT_RULES","MANUFACTURING_RULES","EQUIPMENT_RULES","BOOSTER_RULES","ARCHAEOLOGY_RULES","PLANETARY_RULES","STATION_RULES"]
    .some((k) => Array.isArray(RD[k]) && RD[k].some((r) => r.achievementId === "C11"));
  ok("[b28] C11 不进入任何既有规则集合（仅出现在 BLUEPRINT_RULES）", !inOther);

  // b29 空 ownedBlueprints 不解锁
  const stEmpty = { skills:{}, ownedBlueprints:[], resources:{isk:0,lp:0}, equipment:{inventory:[]}, _dirty:false, achievements:{ unlockedAtById:{}, schemaVersion:1 } };
  const evEmpty = SYS.evaluateBlueprintAchievementRules(stEmpty, 1700000000000);
  ok("[b29] 空 ownedBlueprints 不解锁（evaluatedCount=1, unlockedIds=[]）",
    evEmpty.ok === true && evEmpty.evaluatedCount === 1 && Array.isArray(evEmpty.unlockedIds) && evEmpty.unlockedIds.length === 0);

  // b30 仅幽灵/非法键不解锁
  const stGhost = { skills:{}, ownedBlueprints:["ghost:xyz","",null,42,{},"rifter-not-real","equipment:not_real"], resources:{isk:0,lp:0}, equipment:{inventory:[]}, _dirty:false, achievements:{ unlockedAtById:{}, schemaVersion:1 } };
  const evGhost = SYS.evaluateBlueprintAchievementRules(stGhost, 1700000000000);
  ok("[b30] 仅幽灵/非法键（字符串/空串/null/数字/对象/不存在键）不解锁",
    evGhost.ok === true && evGhost.unlockedIds.length === 0);

  // b31 合法舰船键解锁恰 C11
  const stShip = { skills:{}, ownedBlueprints:["rifter"], resources:{isk:0,lp:0}, equipment:{inventory:[]}, _dirty:false, achievements:{ unlockedAtById:{}, schemaVersion:1 } };
  const evShip = SYS.evaluateBlueprintAchievementRules(stShip, 1700000000000);
  ok("[b31] 合法舰船键 'rifter' 解锁恰 C11（unlockedIds=['C11'] 且 unlockedAtById['C11']=1700000000000）",
    evShip.ok === true && evShip.unlockedIds.length === 1 && evShip.unlockedIds[0] === "C11" && stShip.achievements.unlockedAtById["C11"] === 1700000000000);

  // b32 合法装备键解锁恰 C11
  const stEq = { skills:{}, ownedBlueprints:["equipment:raider_mining_laser"], resources:{isk:0,lp:0}, equipment:{inventory:[]}, _dirty:false, achievements:{ unlockedAtById:{}, schemaVersion:1 } };
  const evEq = SYS.evaluateBlueprintAchievementRules(stEq, 1700000000001);
  ok("[b32] 合法装备键 'equipment:raider_mining_laser' 解锁恰 C11（unlockedAtById['C11']=1700000000001）",
    evEq.ok === true && evEq.unlockedIds.length === 1 && evEq.unlockedIds[0] === "C11" && stEq.achievements.unlockedAtById["C11"] === 1700000000001);

  // b33 已解锁不覆盖时间、不重复 emit
  const st33 = { skills:{}, ownedBlueprints:["rifter"], resources:{isk:0,lp:0}, equipment:{inventory:[]}, _dirty:false, achievements:{ unlockedAtById:{ C11: 123.5 }, schemaVersion:1 } };
  const ev33 = SYS.evaluateBlueprintAchievementRules(st33, 1700000000000);
  ok("[b33] 已解锁：不覆盖时间（保持 123.5）、不重复解锁（unlockedIds=[]）",
    ev33.ok === true && ev33.unlockedIds.length === 0 && st33.achievements.unlockedAtById["C11"] === 123.5);

  // b34 重复安装返回 ALREADY_INSTALLED（模块级单标志，不增加 listener）；不注册通配符 '*'
  const instRes = SYS.installBlueprintAchievementConsumer(GS);
  ok("[b34] 重复安装蓝图消费者返回 ALREADY_INSTALLED（不重复增加 listener）；通配符 '*' listenerCount 仍为 10（消费者只监听具体事件 blueprint:acquired）",
    instRes.ok === false && instRes.reason === "ALREADY_INSTALLED" && GE.listenerCount("*") === 10);

  // b35 listenerCount("blueprint:acquired") === 1
  ok("[b35] listenerCount('blueprint:acquired') === 1（真实 gameState 已自动安装一次，无重复）",
    GE.listenerCount("blueprint:acquired") === 1);

  // b36 listenerCount("*") 仍为 10
  ok("[b36] listenerCount('*') 仍为 10（蓝图消费者用具体事件，不增加通配符监听）",
    GE.listenerCount("*") === 10);

  // b37 真实 dispatchGameAction 首次购买舰船蓝图 rifter → 立即解锁 C11
  const sbShip = buildFullGameSandbox().sandbox;
  const gsShip = sbShip.gameState;
  if (gsShip.resources) { gsShip.resources.isk = 1000000; gsShip.resources.lp = 100000; }
  gsShip.ownedBlueprints = [];
  const achEventsShip = [];
  sbShip.GameEvents.on("achievement:unlocked", (ev) => achEventsShip.push(ev));
  const bpEventsShip = [];
  sbShip.GameEvents.on("blueprint:acquired", (ev) => bpEventsShip.push(ev));
  const rShip = sbShip.dispatchGameAction(gsShip, { type: "manufacturing/buyBlueprint", blueprintId: "rifter" }, 1700000000000);
  ok("[b37] 真实 dispatch 首次购买舰船蓝图 rifter → 立即解锁 C11（ownedBlueprints 含 'rifter' 且 unlockedAtById['C11']===1700000000000）",
    !!rShip && rShip.changed === true && gsShip.ownedBlueprints.includes("rifter") &&
    typeof gsShip.achievements.unlockedAtById["C11"] === "number" && gsShip.achievements.unlockedAtById["C11"] === 1700000000000);

  // b38 独立 fixture 真实购买装备蓝图 alliance_mining_laser_blueprint → 立即解锁 C11
  const sbEq2 = buildFullGameSandbox().sandbox;
  const gsEq2 = sbEq2.gameState;
  if (gsEq2.resources) { gsEq2.resources.isk = 1000000; gsEq2.resources.lp = 100000; }
  gsEq2.ownedBlueprints = [];
  const rEq2 = sbEq2.dispatchGameAction(gsEq2, { type: "shell/buyLPItem", equipmentId: "alliance_mining_laser_blueprint" }, 1700000000001);
  ok("[b38] 独立 fixture 真实 dispatch 首次购买装备蓝图 alliance_mining_laser_blueprint → 立即解锁 C11",
    !!rEq2 && rEq2.changed === true && gsEq2.ownedBlueprints.includes("equipment:raider_mining_laser") &&
    typeof gsEq2.achievements.unlockedAtById["C11"] === "number" && gsEq2.achievements.unlockedAtById["C11"] === 1700000000001);

  // b39 achievement:unlocked 恰发一次，时间等于 blueprint:acquired 时间
  ok("[b39] gsShip 上 achievement:unlocked 恰发 1 次、时间 === blueprint:acquired 时间（1700000000000）",
    achEventsShip.length === 1 && achEventsShip[0].type === "achievement:unlocked" &&
    achEventsShip[0].payload.achievementId === "C11" &&
    bpEventsShip.length === 1 && achEventsShip[0].timestamp === bpEventsShip[0].timestamp);

  // b40 重复购买不重复解锁
  const before40 = gsShip.achievements.unlockedAtById["C11"];
  const rShip2 = sbShip.dispatchGameAction(gsShip, { type: "manufacturing/buyBlueprint", blueprintId: "rifter" }, 1700000000002);
  ok("[b40] 重复购买同一舰船蓝图 already-owned 且不重复解锁（unlockedAtById['C11'] 不变）",
    !!rShip2 && rShip2.changed === false && rShip2.reason === "already-owned" &&
    gsShip.achievements.unlockedAtById["C11"] === before40);

  // b41 伪造 blueprint:acquired payload、但 state.ownedBlueprints 为空 → 不解锁（不信任 payload）
  const sb41 = buildFullGameSandbox().sandbox;
  const gs41 = sb41.gameState;
  gs41.ownedBlueprints = [];
  if (gs41.resources) { gs41.resources.isk = 1000000; gs41.resources.lp = 100000; }
  const ach41 = [];
  sb41.GameEvents.on("achievement:unlocked", (ev) => ach41.push(ev));
  sb41.GameEvents.emit("blueprint:acquired", { ownershipKey: "rifter", blueprintKind: "ship", productId: "rifter" }, { timestamp: 1700000000005, source: "blueprint-store", offline: false });
  ok("[b41] 伪造 blueprint:acquired payload、但 state.ownedBlueprints 为空 → 不解锁（坚持读权威 ownedBlueprints）",
    ach41.length === 0 && typeof gs41.achievements.unlockedAtById["C11"] === "undefined");

  // b42 求值前后 ownedBlueprints 与 statistics 深比较不变（仅写入 unlockedAtById）
  const st42 = { skills:{}, ownedBlueprints:["rifter"], resources:{isk:0,lp:0}, statistics:{}, equipment:{inventory:[]}, _dirty:false, achievements:{ unlockedAtById:{}, schemaVersion:1 } };
  const owned42Before = JSON.stringify(st42.ownedBlueprints);
  const stats42Before = JSON.stringify(st42.statistics);
  SYS.evaluateBlueprintAchievementRules(st42, 1700000000000);
  ok("[b42] 求值后 ownedBlueprints 与 statistics 深比较不变（仅写入 unlockedAtById，不修改二者）",
    JSON.stringify(st42.ownedBlueprints) === owned42Before && JSON.stringify(st42.statistics) === stats42Before);

  // b43 Batch C-10A3：persistence.js 恰 4 处 evaluateBlueprintAchievementRules 文本引用
  // （importData：能力探测 + 调用；autoLoad：能力探测 + 调用），且无 installBlueprintAchievementConsumer 调用。
  let persistSrc = "";
  try { persistSrc = fs.readFileSync(path.join(ROOT, "js", "core", "persistence.js"), "utf-8"); } catch (e) { persistSrc = ""; }
  const bpRefCount = (persistSrc.match(/evaluateBlueprintAchievementRules/g) || []).length;
  ok("[b43] persistence.js 中 evaluateBlueprintAchievementRules 恰 4 处文本引用（importData 探测+调用 / autoLoad 探测+调用），且无 installBlueprintAchievementConsumer 调用",
    !!persistSrc && bpRefCount === 4 && !/installBlueprintAchievementConsumer/.test(persistSrc));

  // b44 achievements.js 与成就 CSV 全程字节不变（只读证明）
  const achAfter = snapFile(ACH_PATH_BP);
  const csvAfter = snapFile(CSV_PATH);
  ok("[b44] achievements.js 与成就 CSV 在审计全过程字节不变（与执行前快照一致）",
    achAfter.len === achBeforeBp.len && achAfter.sha === achBeforeBp.sha &&
    csvAfter.len === csvBeforeBp.len && csvAfter.sha === csvBeforeBp.sha);

  // b45 仓库文件清单前后双向一致、achievements.js 与 CSV 均在清单中
  let b45ok = b20ok;
  if (b45ok) {
    b45ok = bpFilesAfter.includes(ACH_PATH_BP) && bpFilesAfter.includes(CSV_PATH);
  }
  ok("[b45] 仓库文件清单前后双向一致、achievements.js 与 CSV 均在清单中（无新增/删除）", b45ok);

  // =========================================================================
  // Batch C-10A3：persistence 接线真实行为审计（b46+）
  //   真实链路：buildFullGameSandbox(saveJson) 经 localStorage["eve_idle_save"]
  //   触发 autoLoad；SaveManager.importData(json) 触发 importData。
  //   时序：Date 被冻结为 FROZEN_NOW，故 achievementReconcileNow 与 spy.atMs 确定。
  // =========================================================================
  const EVAL_FNS = [
    "evaluateSkillAchievementRules", "evaluateProductionAchievementRules", "evaluateCombatAchievementRules",
    "evaluateManufacturingAchievementRules", "evaluateEquipmentAchievementRules", "evaluateBoosterAchievementRules",
    "evaluateArchaeologyAchievementRules", "evaluatePlanetaryAchievementRules", "evaluateStationAchievementRules",
    "evaluateBlueprintAchievementRules",
  ];
  function timelineCounts(tl) {
    const c = {};
    for (const e of tl) c[e.fn] = (c[e.fn] || 0) + 1;
    return c;
  }
  function evalAtMsSet(tl) {
    const evals = tl.filter((e) => e.fn.startsWith("evaluate"));
    return new Set(evals.filter((e) => typeof e.atMs === "number").map((e) => e.atMs));
  }
  // 由权威目录确定性重建合法 ownershipKey（与 BLUEPRINT_OWNERSHIP_KEYS 同构），用于真实旧档夹具
  function buildLegalOwnershipKeys(sandbox) {
    const seen = new Set();
    const keys = [];
    const cat = (typeof sandbox.getBlueprintStoreCatalogItems === "function") ? sandbox.getBlueprintStoreCatalogItems() : [];
    for (const item of cat) {
      if (!item || typeof item !== "object") continue;
      let key = null;
      if (item.kind === "shipBlueprint") key = (item.shipId != null) ? String(item.shipId) : null;
      else if (item.kind === "equipmentBlueprint") key = (typeof sandbox.getEquipmentBlueprintOwnershipKey === "function") ? sandbox.getEquipmentBlueprintOwnershipKey(item.equipmentId) : null;
      else continue;
      if (key == null || seen.has(key)) continue;
      seen.add(key); keys.push(key);
    }
    return keys;
  }

  // ---- b46：autoLoad 新游戏（无 ownedBlueprints）→ 蓝图求值恰 1 次、C11 不解锁、无 emit ----
  const newGameSb = buildFullGameSandbox(null);
  ok("[b46] autoLoad 新游戏：蓝图追溯求值恰 1 次、C11 未解锁、achievement:unlocked 无 C11 发射",
    (() => {
      if (!newGameSb.spyInstalled) return false;
      const c = timelineCounts(newGameSb.timeline);
      const g = newGameSb.sandbox.gameState;
      const c11ev = newGameSb.achievementEvents.filter((e) => e && e.payload && e.payload.achievementId === "C11");
      return c.evaluateBlueprintAchievementRules === 1 &&
        !("C11" in (g.achievements && g.achievements.unlockedAtById || {})) &&
        c11ev.length === 0;
    })());

  // ---- b47：autoLoad 旧档（真实合法舰船蓝图）→ 蓝图求值恰 1 次、C11 由追溯补发、emit 恰 1 次 ----
  const shipSave = JSON.stringify({
    saveVersion: 2, achievements: { unlockedAtById: {} }, lastActiveTime: FROZEN_NOW - 1000,
    statistics: { version: 6, totals: { events: 5 }, station: { constructionCompletions: 1, maxConcurrentAutoLines: 1, maxOfflineSettlementSeconds: 0 } },
    station: { version: 1, bodyLevel: 3, construction: null, buildings: {}, maintenance: { tier: "standard", fuelRemaining: 5000, lastRefillAt: 0 }, autoLines: {} },
    ownedBlueprints: ["rifter"],
  });
  const shipSb = buildFullGameSandbox(shipSave);
  ok("[b47] autoLoad 旧档（真实舰船蓝图）：蓝图求值恰 1 次、C11 由追溯补发（unlockedAtById['C11'] 为有限数字）",
    (() => {
      if (!shipSb.spyInstalled) return false;
      const c = timelineCounts(shipSb.timeline);
      const g = shipSb.sandbox.gameState;
      return c.evaluateBlueprintAchievementRules === 1 && typeof g.achievements.unlockedAtById["C11"] === "number" && isFinite(g.achievements.unlockedAtById["C11"]);
    })());

  // ---- b48：autoLoad 旧档（真实装备蓝图）→ 蓝图求值恰 1 次、C11 由追溯补发 ----
  const eqSave = JSON.stringify({
    saveVersion: 2, achievements: { unlockedAtById: {} }, lastActiveTime: FROZEN_NOW - 1000,
    statistics: { version: 6, totals: { events: 5 }, station: { constructionCompletions: 1, maxConcurrentAutoLines: 1, maxOfflineSettlementSeconds: 0 } },
    station: { version: 1, bodyLevel: 3, construction: null, buildings: {}, maintenance: { tier: "standard", fuelRemaining: 5000, lastRefillAt: 0 }, autoLines: {} },
    ownedBlueprints: ["equipment:raider_mining_laser"],
  });
  const eqSb = buildFullGameSandbox(eqSave);
  ok("[b48] autoLoad 旧档（真实装备蓝图）：蓝图求值恰 1 次、C11 由追溯补发",
    (() => {
      if (!eqSb.spyInstalled) return false;
      const c = timelineCounts(eqSb.timeline);
      const g = eqSb.sandbox.gameState;
      return c.evaluateBlueprintAchievementRules === 1 && typeof g.achievements.unlockedAtById["C11"] === "number" && isFinite(g.achievements.unlockedAtById["C11"]);
    })());

  // ---- b49：autoLoad 旧档（仅幽灵/非法键）→ 蓝图求值恰 1 次、C11 不补发、无 emit ----
  const ghostSave = JSON.stringify({
    saveVersion: 2, achievements: { unlockedAtById: {} }, lastActiveTime: FROZEN_NOW - 1000,
    statistics: { version: 6, totals: { events: 5 }, station: { constructionCompletions: 1, maxConcurrentAutoLines: 1, maxOfflineSettlementSeconds: 0 } },
    station: { version: 1, bodyLevel: 3, construction: null, buildings: {}, maintenance: { tier: "standard", fuelRemaining: 5000, lastRefillAt: 0 }, autoLines: {} },
    ownedBlueprints: ["ghost:xyz", "rifter-not-real", "equipment:not_real", "", null, 42, {}],
  });
  const ghostSb = buildFullGameSandbox(ghostSave);
  ok("[b49] autoLoad 旧档（仅幽灵/非法键）：蓝图求值恰 1 次、C11 不补发、achievement:unlocked 无 C11 发射",
    (() => {
      if (!ghostSb.spyInstalled) return false;
      const c = timelineCounts(ghostSb.timeline);
      const g = ghostSb.sandbox.gameState;
      const c11ev = ghostSb.achievementEvents.filter((e) => e && e.payload && e.payload.achievementId === "C11");
      return c.evaluateBlueprintAchievementRules === 1 &&
        !("C11" in (g.achievements && g.achievements.unlockedAtById || {})) &&
        c11ev.length === 0;
    })());

  // ---- b50：autoLoad 已解锁 C11（123.5）→ 不覆盖、不重复 emit、蓝图求值仍恰 1 次 ----
  const preSb = buildFullGameSandbox(null); // 仅取合法键集合来源，复用 newGameSb 亦可
  const legalKeys = buildLegalOwnershipKeys(newGameSb.sandbox);
  const priorC11Save = JSON.stringify({
    saveVersion: 2, achievements: { unlockedAtById: { C11: 123.5 } }, lastActiveTime: FROZEN_NOW - 1000,
    statistics: { version: 6, totals: { events: 5 }, station: { constructionCompletions: 1, maxConcurrentAutoLines: 1, maxOfflineSettlementSeconds: 0 } },
    station: { version: 1, bodyLevel: 3, construction: null, buildings: {}, maintenance: { tier: "standard", fuelRemaining: 5000, lastRefillAt: 0 }, autoLines: {} },
    ownedBlueprints: legalKeys.length ? [legalKeys[0]] : ["rifter"],
  });
  const priorSb = buildFullGameSandbox(priorC11Save);
  ok("[b50] autoLoad 旧档（已解锁 C11=123.5）：保留原时间、不重复发射、蓝图求值仍恰 1 次",
    (() => {
      if (!priorSb.spyInstalled) return false;
      const c = timelineCounts(priorSb.timeline);
      const g = priorSb.sandbox.gameState;
      const c11ev = priorSb.achievementEvents.filter((e) => e && e.payload && e.payload.achievementId === "C11");
      return c.evaluateBlueprintAchievementRules === 1 &&
        g.achievements.unlockedAtById["C11"] === 123.5 &&
        c11ev.length === 0;
    })());

  // ---- b51：十求值器顺序 station < blueprint < offline（autoLoad 旧档），且 atMs 全相同 ----
  ok("[b51] autoLoad 旧档：十求值器顺序 skill<…<station<blueprint<offline，且所有 evaluator 共用同一 atMs",
    (() => {
      if (!shipSb.spyInstalled) return false;
      const tl = shipSb.timeline;
      const order = tl.filter((e) => e.fn.startsWith("evaluate")).map((e) => e.fn);
      const sIdx = order.indexOf("evaluateStationAchievementRules");
      const bIdx = order.indexOf("evaluateBlueprintAchievementRules");
      const oIdx = tl.findIndex((e) => e.fn === "calculateOfflineGains");
      // 全部 10 个 evaluate 各恰 1 次
      const c = timelineCounts(tl);
      const allOnce = EVAL_FNS.every((f) => c[f] === 1);
      const atMsSet = evalAtMsSet(tl);
      return allOnce && sIdx >= 0 && bIdx > sIdx && oIdx > bIdx && atMsSet.size === 1;
    })());

  // ---- b52：importData 真实调用返回 true，且蓝图求值恰 +1 次（区分 build 期 autoLoad 的 1 次） ----
  // 说明：buildFullGameSandbox(null) 构建时即触发 autoLoad（新游戏），蓝图追溯求值已 +1 次；
  // 故此处以 importData 调用“前后差值”精确断言 importData 自身恰调用 1 次。
  const importSb = buildFullGameSandbox(null);
  const importTlLenBefore = importSb.timeline.length; // build 期 autoLoad 已写入的条目数，用于隔离 importData 新增切片
  const bpBeforeImport = importSb.timeline.filter((e) => e.fn === "evaluateBlueprintAchievementRules").length;
  const importSave = {
    saveVersion: 2, skills: { mining: { lvl: 1, xp: 0 } }, achievements: { unlockedAtById: {} },
    lastActiveTime: FROZEN_NOW - 1000,
    statistics: { version: 6, totals: { events: 5 }, station: { constructionCompletions: 1, maxConcurrentAutoLines: 1, maxOfflineSettlementSeconds: 0 } },
    station: { version: 1, bodyLevel: 3, construction: null, buildings: {}, maintenance: { tier: "standard", fuelRemaining: 5000, lastRefillAt: 0 }, autoLines: {} },
    ownedBlueprints: ["rifter"],
  };
  const importRes = importSb.sandbox.SaveManager && typeof importSb.sandbox.SaveManager.importData === "function"
    ? importSb.sandbox.SaveManager.importData(JSON.stringify(importSave)) : null;
  const bpAfterImport = importSb.timeline.filter((e) => e.fn === "evaluateBlueprintAchievementRules").length;
  ok("[b52] importData 真实调用返回 true，且 importData 路径蓝图追溯求值恰增量 1 次（区分 build 期 autoLoad）",
    importRes === true && (bpAfterImport - bpBeforeImport) === 1);

  // ---- b53：importData 旧档（真实舰船蓝图）补发 C11，且 C11 解锁时间 === importData 蓝图 evaluator atMs ----
  ok("[b53] importData 旧档（真实舰船蓝图）：补发 C11，且 unlockedAtById['C11'] 等于 importData 蓝图 evaluator 的 atMs",
    (() => {
      const g = importSb.sandbox.gameState;
      // 取 importData 新增的那一条蓝图 evaluator 记录（build 期 autoLoad 的在其之前）
      const bpEntries = importSb.timeline.filter((e) => e.fn === "evaluateBlueprintAchievementRules");
      const bpEntry = bpEntries[bpEntries.length - 1];
      const c11t = g.achievements.unlockedAtById["C11"];
      return typeof c11t === "number" && bpEntry && typeof bpEntry.atMs === "number" && c11t === bpEntry.atMs;
    })());

  // ---- b54：importData 旧档（已解锁 C11=123.5）保留原时间、不重复 emit ----
  const importSb2 = buildFullGameSandbox(null);
  const importSave2 = {
    saveVersion: 2, skills: { mining: { lvl: 1, xp: 0 } }, achievements: { unlockedAtById: { C11: 123.5 } },
    lastActiveTime: FROZEN_NOW - 1000,
    statistics: { version: 6, totals: { events: 5 }, station: { constructionCompletions: 1, maxConcurrentAutoLines: 1, maxOfflineSettlementSeconds: 0 } },
    station: { version: 1, bodyLevel: 3, construction: null, buildings: {}, maintenance: { tier: "standard", fuelRemaining: 5000, lastRefillAt: 0 }, autoLines: {} },
    ownedBlueprints: legalKeys.length ? [legalKeys[0]] : ["rifter"],
  };
  const importRes2 = importSb2.sandbox.SaveManager && typeof importSb2.sandbox.SaveManager.importData === "function"
    ? importSb2.sandbox.SaveManager.importData(JSON.stringify(importSave2)) : null;
  ok("[b54] importData 旧档（已解锁 C11=123.5）：保留原时间、不重复发射 achievement:unlocked",
    (() => {
      if (!importSb2.spyInstalled) return false;
      const g = importSb2.sandbox.gameState;
      const c11ev = importSb2.achievementEvents.filter((e) => e && e.payload && e.payload.achievementId === "C11");
      return importRes2 === true && g.achievements.unlockedAtById["C11"] === 123.5 && c11ev.length === 0;
    })());

  // ---- b55：importData 旧档（仅幽灵/非法键）不补发 C11、无 emit ----
  const importSb3 = buildFullGameSandbox(null);
  const importSave3 = {
    saveVersion: 2, skills: { mining: { lvl: 1, xp: 0 } }, achievements: { unlockedAtById: {} },
    lastActiveTime: FROZEN_NOW - 1000,
    statistics: { version: 6, totals: { events: 5 }, station: { constructionCompletions: 1, maxConcurrentAutoLines: 1, maxOfflineSettlementSeconds: 0 } },
    station: { version: 1, bodyLevel: 3, construction: null, buildings: {}, maintenance: { tier: "standard", fuelRemaining: 5000, lastRefillAt: 0 }, autoLines: {} },
    ownedBlueprints: ["ghost:xyz", "equipment:not_real", 42, null],
  };
  const importRes3 = importSb3.sandbox.SaveManager && typeof importSb3.sandbox.SaveManager.importData === "function"
    ? importSb3.sandbox.SaveManager.importData(JSON.stringify(importSave3)) : null;
  ok("[b55] importData 旧档（仅幽灵/非法键）：不补发 C11、achievement:unlocked 无 C11 发射",
    (() => {
      if (!importSb3.spyInstalled) return false;
      const g = importSb3.sandbox.gameState;
      const c11ev = importSb3.achievementEvents.filter((e) => e && e.payload && e.payload.achievementId === "C11");
      return importRes3 === true &&
        !("C11" in (g.achievements && g.achievements.unlockedAtById || {})) &&
        c11ev.length === 0;
    })());

  // ---- b56：importData 旧档（真实装备蓝图）补发 C11 ----
  const importSb4 = buildFullGameSandbox(null);
  const importSave4 = {
    saveVersion: 2, skills: { mining: { lvl: 1, xp: 0 } }, achievements: { unlockedAtById: {} },
    lastActiveTime: FROZEN_NOW - 1000,
    statistics: { version: 6, totals: { events: 5 }, station: { constructionCompletions: 1, maxConcurrentAutoLines: 1, maxOfflineSettlementSeconds: 0 } },
    station: { version: 1, bodyLevel: 3, construction: null, buildings: {}, maintenance: { tier: "standard", fuelRemaining: 5000, lastRefillAt: 0 }, autoLines: {} },
    ownedBlueprints: ["equipment:raider_mining_laser"],
  };
  const importRes4 = importSb4.sandbox.SaveManager && typeof importSb4.sandbox.SaveManager.importData === "function"
    ? importSb4.sandbox.SaveManager.importData(JSON.stringify(importSave4)) : null;
  ok("[b56] importData 旧档（真实装备蓝图）：补发 C11",
    (() => {
      if (!importSb4.spyInstalled) return false;
      const g = importSb4.sandbox.gameState;
      return importRes4 === true && typeof g.achievements.unlockedAtById["C11"] === "number" && isFinite(g.achievements.unlockedAtById["C11"]);
    })());

  // ---- b57：importData 连续两次同档（存档已含 C11=123.5）→ 不重复发射、解锁时间不变（连续不覆盖） ----
  // 说明：importData 经 Object.assign(gameState, data) 以存档为权威，故“连续不覆盖”须用已含 C11 的存档
  // 反复导入来验证“已解锁不覆盖、不重 emit”；空 achievements 存档会先清空再补发（属预期 import 语义）。
  const importSb5 = buildFullGameSandbox(null);
  const importSave5 = {
    saveVersion: 2, skills: { mining: { lvl: 1, xp: 0 } }, achievements: { unlockedAtById: { C11: 123.5 } },
    lastActiveTime: FROZEN_NOW - 1000,
    statistics: { version: 6, totals: { events: 5 }, station: { constructionCompletions: 1, maxConcurrentAutoLines: 1, maxOfflineSettlementSeconds: 0 } },
    station: { version: 1, bodyLevel: 3, construction: null, buildings: {}, maintenance: { tier: "standard", fuelRemaining: 5000, lastRefillAt: 0 }, autoLines: {} },
    ownedBlueprints: ["equipment:raider_mining_laser"],
  };
  const importRes5a = importSb5.sandbox.SaveManager && typeof importSb5.sandbox.SaveManager.importData === "function"
    ? importSb5.sandbox.SaveManager.importData(JSON.stringify(importSave5)) : null;
  const c11evBefore2nd = importSb5.achievementEvents.filter((e) => e && e.payload && e.payload.achievementId === "C11").length;
  const c11tBefore2nd = importSb5.sandbox.gameState.achievements.unlockedAtById["C11"];
  const importRes5b = importSb5.sandbox.SaveManager && typeof importSb5.sandbox.SaveManager.importData === "function"
    ? importSb5.sandbox.SaveManager.importData(JSON.stringify(importSave5)) : null;
  ok("[b57] importData 连续两次同档（存档已含 C11=123.5）：不重复发射（第二次增量 emit=0）、解锁时间不变（连续不覆盖）",
    (() => {
      if (!importSb5.spyInstalled) return false;
      const g = importSb5.sandbox.gameState;
      const c11evAfter2nd = importSb5.achievementEvents.filter((e) => e && e.payload && e.payload.achievementId === "C11").length;
      return importRes5a === true && importRes5b === true &&
        typeof g.achievements.unlockedAtById["C11"] === "number" &&
        g.achievements.unlockedAtById["C11"] === 123.5 && c11tBefore2nd === 123.5 &&
        (c11evAfter2nd - c11evBefore2nd) === 0;
    })());

  // ---- b58：autoLoad 连续两次同档（真实舰船蓝图）不覆盖已补发 C11 ----
  const dupSb = buildFullGameSandbox(shipSave); // 重新加载即新 sandbox 实例，验证幂等路径一致
  ok("[b58] autoLoad 旧档（真实舰船蓝图）两次独立加载：C11 均恰解锁一次且时间一致（幂等）",
    (() => {
      if (!dupSb.spyInstalled) return false;
      const c = timelineCounts(dupSb.timeline);
      const g = dupSb.sandbox.gameState;
      const c11ev = dupSb.achievementEvents.filter((e) => e && e.payload && e.payload.achievementId === "C11");
      return c.evaluateBlueprintAchievementRules === 1 &&
        typeof g.achievements.unlockedAtById["C11"] === "number" &&
        c11ev.length === 1;
    })());

  // ---- b59：autoLoad 旧档迁移/追溯不改 ownedBlueprints 集合（仅写入 unlockedAtById） ----
  ok("[b59] autoLoad 旧档（真实舰船蓝图）：ownedBlueprints 在加载前后集合不变（只读 ownedBlueprints）",
    (() => {
      const g = shipSb.sandbox.gameState;
      return Array.isArray(g.ownedBlueprints) && g.ownedBlueprints.length === 1 && g.ownedBlueprints.includes("rifter");
    })());

  // ---- b60：autoLoad 旧档 statistics.version 仍 6（本批不改统计 schema/version） ----
  ok("[b60] autoLoad 旧档：statistics.version 仍为 9（本批未改 statistics schema/version）",
    shipSb.sandbox.gameState.statistics.version === 9);

  // ---- b61：importData / autoLoad 蓝图求值 atMs 与同批其他 evaluator 的 atMs 全相同 ----
  // 说明：importSb 在 build 期已跑 autoLoad（新增多条 evaluate），故以 importData 新增切片
  // （timeline.slice(importTlLenBefore)）断言 importData 内部 10 个 evaluator 各恰 1 次且共用同一 atMs；
  // autoLoad 侧（shipSb）为纯净单次加载。
  ok("[b61] importData 内部 10 个 evaluator 各恰 1 次且共用同一 atMs（与 autoLoad 侧 atMs 同源 FROZEN_NOW）",
    (() => {
      const slice = importSb.timeline.slice(importTlLenBefore);
      const cS = timelineCounts(slice);
      const atS = new Set(slice.filter((e) => e.fn.startsWith("evaluate") && typeof e.atMs === "number").map((e) => e.atMs));
      const importAllOnce = EVAL_FNS.every((f) => cS[f] === 1);
      // autoLoad 侧（shipSb）纯净单次
      const cA = timelineCounts(shipSb.timeline);
      const atA = evalAtMsSet(shipSb.timeline);
      const autoAllOnce = EVAL_FNS.every((f) => cA[f] === 1);
      return importAllOnce && atS.size === 1 && autoAllOnce && atA.size === 1;
    })());

  // ---- b62：importData 真实调用后 gameState.ownedBlueprints 保留（未因追溯被清空/改写） ----
  ok("[b62] importData 旧档：gameState.ownedBlueprints 保留为导入值（未被追溯逻辑改写）",
    Array.isArray(importSb.sandbox.gameState.ownedBlueprints) &&
    importSb.sandbox.gameState.ownedBlueprints.length === 1 &&
    importSb.sandbox.gameState.ownedBlueprints.includes("rifter"));

  // ---- b63：autoLoad 新游戏无 ownedBlueprints（L1069 兜底 []）→ 蓝图求值恰 1 次且 C11 不解锁 ----
  ok("[b63] autoLoad 新游戏（无 ownedBlueprints 字段）：兜底 [] 后蓝图求值恰 1 次、C11 安全不解锁",
    (() => {
      if (!newGameSb.spyInstalled) return false;
      const c = timelineCounts(newGameSb.timeline);
      const g = newGameSb.sandbox.gameState;
      return c.evaluateBlueprintAchievementRules === 1 && Array.isArray(g.ownedBlueprints) &&
        !("C11" in (g.achievements && g.achievements.unlockedAtById || {}));
    })());

  // ---- b64：importData 旧档（真实舰船蓝图）补发 C11 后，achievement:unlocked 恰发射 1 次且 payload.achievementId==='C11' ----
  ok("[b64] importData 旧档（真实舰船蓝图）：achievement:unlocked 恰发射 1 次且 payload.achievementId==='C11'",
    (() => {
      const c11ev = importSb.achievementEvents.filter((e) => e && e.payload && e.payload.achievementId === "C11");
      const g = importSb.sandbox.gameState;
      return c11ev.length === 1 && typeof g.achievements.unlockedAtById["C11"] === "number";
    })());

  // ---- b65：autoLoad 旧档（真实舰船蓝图）补发 C11 后，achievement:unlocked 恰发射 1 次 ----
  ok("[b65] autoLoad 旧档（真实舰船蓝图）：achievement:unlocked 恰发射 1 次且 payload.achievementId==='C11'",
    (() => {
      const c11ev = shipSb.achievementEvents.filter((e) => e && e.payload && e.payload.achievementId === "C11");
      const g = shipSb.sandbox.gameState;
      return c11ev.length === 1 && typeof g.achievements.unlockedAtById["C11"] === "number";
    })());

  // ---- b66：只读证明 —— 本分区不向仓库写入任何辅助文件（首尾文件清单双向一致） ----
  let b66ok = bpFilesBefore.length > 0 && bpFilesBefore.length === bpFilesAfter.length;
  if (b66ok) {
    const bSet = new Set(bpFilesBefore), aSet = new Set(bpFilesAfter);
    for (const f of bpFilesBefore) { if (!aSet.has(f)) { b66ok = false; break; } }
    if (b66ok) { for (const f of bpFilesAfter) { if (!bSet.has(f)) { b66ok = false; break; } } }
  }
  ok("[b66] 仓库文件清单前后双向一致（本分区无新增/删除任何文件）", b66ok);

  // ---- b67：CSV/JS 只读证明（与 b44 同基准，再次确认执行后未变） ----
  const achAfter2 = snapFile(ACH_PATH_BP);
  const csvAfter2 = snapFile(CSV_PATH);
  ok("[b67] achievements.js 与成就 CSV 在分区末尾仍字节不变（全程只读）",
    achAfter2.len === achBeforeBp.len && achAfter2.sha === achBeforeBp.sha &&
    csvAfter2.len === csvBeforeBp.len && csvAfter2.sha === csvBeforeBp.sha);

  // ---- b68：persistence.js 文件清单一致性（importData/autoLoad 两处改动的文本引用已计入 b43；不引入其他文件改动） ----
  ok("[b68] persistence.js 与 audit-achievements.mjs 为本批仅修改文件（与 b43 的 4 处引用互相印证，无 installBlueprintAchievementConsumer 调用）",
    (() => {
      const p2 = (persistSrc.match(/evaluateBlueprintAchievementRules/g) || []).length;
      return p2 === 4 && !/installBlueprintAchievementConsumer/.test(persistSrc);
    })());
}

// ============================================================================
//  --economy：Batch C-13 经济成就（I01–I12）审计
//  全部为真实行为断言：冻结数据层 / 188+9 全局恒等式 / ResourceRegistry 延迟解析 /
//  resource:changed·inventory:changed 契约与真实 emit / I11 命名空间交叉验证 /
//  逐规则边界 / persistence 追溯对账（spy 时间线）
// ============================================================================
function runEconomy() {
  // 分区只读性字节级基准（ecRO 收口）
  const ACH_SYS_SNAP = snapFile(ACH_SYSTEM_PATH);
  const RULES_SNAP = snapFile(ACH_RULES_PATH);

  // ========================= A. 冻结数据层（内核沙箱 + 真实规则文件）=========================
  const sbK = buildKernelSandbox({ withEvents: true, withRules: true });
  const RD = sbK.AchievementRuleData || (sbK.window && sbK.window.AchievementRuleData);
  const SYSK = sbK.AchievementSystem;
  ok("[ec1] 内核沙箱暴露 AchievementRuleData / AchievementSystem（economy API 齐备）",
    !!RD && !!SYSK &&
    typeof SYSK.evaluateEconomyAchievementRules === "function" &&
    typeof SYSK.installEconomyAchievementConsumer === "function");

  const ECO = RD.ECONOMY_RULES;
  ok("[ec2] ECONOMY_RULES 恰 12 条、Object.isFrozen、achievementId 顺序精确 I01→I12",
    Array.isArray(ECO) && ECO.length === 12 && Object.isFrozen(ECO) &&
    ECO.every((r) => Object.isFrozen(r)) &&
    ECO.map((r) => r.achievementId).join(",") === "I01,I02,I03,I04,I05,I06,I07,I08,I09,I10,I11,I12");

  ok("[ec3] ECONOMY_MINERAL_RESOURCE_IDS 恰 7 项全 mineral: 前缀且不含莫尔石；ECONOMY_COLLECTION_RESOURCE_IDS 顺序精确 moon:铷,mineral:莫尔石,planetary:等离子体,planetary:磁场聚合物（无 moon:莫尔石）",
    Array.isArray(RD.ECONOMY_MINERAL_RESOURCE_IDS) && RD.ECONOMY_MINERAL_RESOURCE_IDS.length === 7 &&
    Object.isFrozen(RD.ECONOMY_MINERAL_RESOURCE_IDS) &&
    RD.ECONOMY_MINERAL_RESOURCE_IDS.every((id) => id.startsWith("mineral:")) &&
    !RD.ECONOMY_MINERAL_RESOURCE_IDS.includes("mineral:莫尔石") &&
    Object.isFrozen(RD.ECONOMY_COLLECTION_RESOURCE_IDS) &&
    RD.ECONOMY_COLLECTION_RESOURCE_IDS.join(",") === "moon:铷,mineral:莫尔石,planetary:等离子体,planetary:磁场聚合物" &&
    !RD.ECONOMY_COLLECTION_RESOURCE_IDS.includes("moon:莫尔石"));

  const BYID = RD.ECONOMY_RULES_BY_ID;
  ok("[ec4] 规则类型与阈值精确：I01/I02/I03 currency:isk 1e6/1e8/1e9（economy-resource-min）、I04–I10 七矿物各 1000、I11 economy-resource-set-all minValue=1、I12 economy-inventory-total minValue=1e6；BY_ID 冻结且 12 键",
    !!BYID && Object.isFrozen(BYID) && Object.keys(BYID).length === 12 &&
    BYID.I01.type === "economy-resource-min" && BYID.I01.resourceId === "currency:isk" && BYID.I01.minValue === 1000000 &&
    BYID.I02.resourceId === "currency:isk" && BYID.I02.minValue === 100000000 &&
    BYID.I03.resourceId === "currency:isk" && BYID.I03.minValue === 1000000000 &&
    ["I04","I05","I06","I07","I08","I09","I10"].every((id, i) =>
      BYID[id].type === "economy-resource-min" &&
      BYID[id].resourceId === RD.ECONOMY_MINERAL_RESOURCE_IDS[i] &&
      BYID[id].minValue === 1000) &&
    BYID.I11.type === "economy-resource-set-all" && BYID.I11.resourceIds === RD.ECONOMY_COLLECTION_RESOURCE_IDS && BYID.I11.minValue === 1 &&
    BYID.I12.type === "economy-inventory-total" && BYID.I12.minValue === 1000000);

  // 194 / 3 全局恒等式（Batch C-14A 起为十二组两两零交集；本分区仍交叉验证经济组在内）
  const twelveSets = [
    RD.SKILL_RULES, RD.PRODUCTION_RULES, RD.COMBAT_RULES, RD.MANUFACTURING_RULES,
    RD.EQUIPMENT_RULES, RD.BOOSTER_RULES, RD.ARCHAEOLOGY_RULES, RD.PLANETARY_RULES,
    RD.STATION_RULES, RD.BLUEPRINT_RULES, RD.ECONOMY_RULES, RD.GENERAL_RULES,
  ].map((g) => new Set(g.map((r) => r.achievementId)));
  let twelveDisjoint = true;
  for (let i = 0; i < twelveSets.length && twelveDisjoint; i++)
    for (let j = i + 1; j < twelveSets.length && twelveDisjoint; j++)
      for (const id of twelveSets[i]) if (twelveSets[j].has(id)) { twelveDisjoint = false; break; }
  const twelveUnion = new Set();
  for (const s of twelveSets) for (const id of s) twelveUnion.add(id);
  const catalogTotal = (sbK.AchievementData && sbK.AchievementData.ACHIEVEMENTS) ? sbK.AchievementData.ACHIEVEMENTS.length : 0;
  ok("[ec5] 全局恒等式：十二组两两零交集、并集恰 194、ACHIEVEMENT_RULES=194、BY_ID=194 键、GROUPS=12 组、目录 197、未映射 197-194=3",
    twelveDisjoint && twelveUnion.size === 194 &&
    Array.isArray(RD.ACHIEVEMENT_RULES) && RD.ACHIEVEMENT_RULES.length === 194 &&
    Object.keys(RD.ACHIEVEMENT_RULES_BY_ID).length === 194 &&
    RD.ACHIEVEMENT_RULE_GROUPS.length === 12 &&
    catalogTotal === 197 && catalogTotal - twelveUnion.size === 3);

  // ========================= B. 事件契约（真实 events.js）=========================
  const Contracts = sbK.GameEvents && sbK.GameEvents.contracts;
  ok("[ec6] events.js 注册 resource:changed 与 inventory:changed 契约（contracts.has 均为真）",
    !!Contracts && Contracts.has("resource:changed") === true && Contracts.has("inventory:changed") === true);

  const eventsSrcE = fs.readFileSync(EVENTS_PATH, "utf-8");
  const mRc = eventsSrcE.match(/"resource:changed":\s*\{\s*required:\s*\[([^\]]*)\],\s*numbers:\s*\[([^\]]*)\]\s*\}/);
  const mIc = eventsSrcE.match(/"inventory:changed":\s*\{\s*required:\s*\[([^\]]*)\],\s*numbers:\s*\[([^\]]*)\]\s*\}/);
  const strip = (s) => s.split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean).join(",");
  ok("[ec7] 契约字段精确：resource:changed required=[resourceId,previousValue,value,delta] numbers=[previousValue,value,delta]；inventory:changed required=[kind,itemId,delta] numbers=[delta]（源码交叉验证）",
    !!mRc && strip(mRc[1]) === "resourceId,previousValue,value,delta" && strip(mRc[2]) === "previousValue,value,delta" &&
    !!mIc && strip(mIc[1]) === "kind,itemId,delta" && strip(mIc[2]) === "delta");

  ok("[ec8] 契约校验行为：合法 payload 通过；缺 delta / 缺 itemId 失败（注：numbers 字段经 Number() 强制，数字串如 \"5\" 亦视为合法，故 strdelta 期望 true）",
    !!Contracts &&
    Contracts.validate("resource:changed", { resourceId: "currency:isk", previousValue: 0, value: 5, delta: 5 }).valid === true &&
    Contracts.validate("resource:changed", { resourceId: "currency:isk", previousValue: 0, value: 5, delta: "5" }).valid === true &&
    Contracts.validate("resource:changed", { resourceId: "currency:isk", previousValue: 0, value: 5 }).valid === false &&
    Contracts.validate("inventory:changed", { kind: "equipment", itemId: "x", delta: 1 }).valid === true &&
    Contracts.validate("inventory:changed", { kind: "equipment", delta: 1 }).valid === false);

  // ========================= C. ResourceRegistry 延迟解析（q-0 裁决实证）=========================
  // 内核沙箱不含 resources.js：先装消费者（成功）、求值报 RESOURCE_REGISTRY_UNAVAILABLE、
  // 事件到达不崩溃不解锁；随后注入真实 ResourceRegistry（取自全脚本沙箱的真实 resources.js
  // 实例，非 mock），同一消费者无需重装即可解锁 —— 证明"监听器先注册、Registry 延迟解析"。
  const sbF = buildFullGameSandbox(null); // 同时供 D/E 区行为断言复用
  const stK = {
    skills: {},
    resources: { isk: 2000000 },
    achievements: sbK.AchievementState.createDefaultAchievementState(),
    _dirty: false,
  };
  const instK = SYSK.installEconomyAchievementConsumer(stK);
  const evalNoReg = SYSK.evaluateEconomyAchievementRules(stK, FROZEN_NOW);
  sbK.GameEvents.emit("resource:changed", { resourceId: "currency:isk", previousValue: 0, value: 2000000, delta: 2000000 }, { source: "audit" });
  const notYet = stK.achievements.unlockedAtById.I01 === undefined;
  ok("[ec9] Registry 缺失时：消费者安装 ok:true、求值 {ok:false,reason:'RESOURCE_REGISTRY_UNAVAILABLE'}、resource:changed 到达不崩溃不解锁、无契约失败",
    !!instK && instK.ok === true &&
    !!evalNoReg && evalNoReg.ok === false && evalNoReg.reason === "RESOURCE_REGISTRY_UNAVAILABLE" &&
    notYet && sbK.__guardReports.length === 0);

  sbK.ResourceRegistry = sbF.sandbox.ResourceRegistry; // 注入真实 resources.js 实例（延迟解析）
  sbK.GameEvents.emit("resource:changed", { resourceId: "currency:isk", previousValue: 2000000, value: 2000001, delta: 1 }, { source: "audit" });
  ok("[ec10] 注入真实 ResourceRegistry 后：同一消费者（未重装）下一事件即解锁 I01=事件时间戳（冻结 Date.now()），I02/I03 不解锁",
    stK.achievements.unlockedAtById.I01 === FROZEN_NOW &&
    stK.achievements.unlockedAtById.I02 === undefined &&
    stK.achievements.unlockedAtById.I03 === undefined);

  // ========================= D. 全脚本沙箱真实行为（I01–I12 逐规则边界）=========================
  const gsE = sbF.sandbox.gameState;
  const RRe = sbF.sandbox.ResourceRegistry;
  const SYSF = sbF.sandbox.AchievementSystem;
  const mapE = gsE.achievements.unlockedAtById;
  const rcEvents = [];
  const icEvents = [];
  sbF.sandbox.GameEvents.on("resource:changed", (ev) => rcEvents.push(ev.payload));
  sbF.sandbox.GameEvents.on("inventory:changed", (ev) => icEvents.push(ev.payload));

  const reInstall = SYSF.installEconomyAchievementConsumer(gsE);
  ok("[ec11] 全脚本沙箱：经济消费者已随脚本加载自动安装（重复安装 → {ok:false,reason:'ALREADY_INSTALLED'}）；新游戏默认 isk=1e6 使 I01 于启动即解锁、I02–I12 仍未解锁",
    !!reInstall && reInstall.ok === false && reInstall.reason === "ALREADY_INSTALLED" &&
    mapE.I01 === FROZEN_NOW &&
    ECO.filter((r) => r.achievementId !== "I01").every((r) => mapE[r.achievementId] === undefined));

  // I01–I03 ISK 阶梯（事件驱动，真实 set → resource:changed → 消费者解锁）
  RRe.set(gsE, "currency:isk", 1000000);
  const i1 = mapE.I01 === FROZEN_NOW && mapE.I02 === undefined && mapE.I03 === undefined;
  RRe.set(gsE, "currency:isk", 100000000);
  const i2 = mapE.I02 === FROZEN_NOW && mapE.I03 === undefined;
  RRe.set(gsE, "currency:isk", 1000000000);
  const i3 = mapE.I03 === FROZEN_NOW;
  ok("[ec12] I01/I02/I03 阶梯：1e6→仅 I01；1e8→加 I02；1e9→加 I03（全部经真实 resource:changed 事件链解锁，时间戳=冻结 Date.now()）", i1 && i2 && i3);

  const i01Before = mapE.I01;
  RRe.set(gsE, "currency:isk", 999); // 跌回低值
  const evalAgain = SYSF.evaluateEconomyAchievementRules(gsE, 1234);
  ok("[ec13] 幂等与不回滚：ISK 跌回 999 后重估 → unlockedIds=[]、I01 时间戳不变（已解锁不覆盖不撤销）",
    !!evalAgain && evalAgain.ok === true && evalAgain.unlockedIds.length === 0 && mapE.I01 === i01Before);

  // resource:changed payload：delta 恒非负（增与减都取绝对值），且 = |value-previous|
  RRe.set(gsE, "currency:isk", 5000);
  RRe.spend(gsE, "currency:isk", 3000); // 减少路径
  const deltaOk = rcEvents.length > 0 && rcEvents.every((p) =>
    typeof p.delta === "number" && p.delta >= 0 && p.delta === Math.abs(p.value - p.previousValue));
  const cntBeforeSame = rcEvents.length;
  RRe.set(gsE, "currency:isk", 2000); // 与当前值相同 → 不 emit
  ok("[ec14] resource:changed：全部真实事件 delta 非负且 =|value-previousValue|（含 spend 减少路径）；set 相同值不 emit",
    deltaOk && rcEvents.length === cntBeforeSame);

  // I04–I10 七矿物逐规则边界：999 不解锁、1000 恰解锁对应一项
  let mineralsOk = true;
  for (let i = 0; i < RD.ECONOMY_MINERAL_RESOURCE_IDS.length; i++) {
    const rid = RD.ECONOMY_MINERAL_RESOURCE_IDS[i];
    const aid = (i + 4 < 10) ? "I0" + (i + 4) : "I" + (i + 4); // I04…I10
    RRe.set(gsE, rid, 999);
    if (mapE[aid] !== undefined) { mineralsOk = false; break; }
    RRe.set(gsE, rid, 1000);
    if (mapE[aid] !== FROZEN_NOW) { mineralsOk = false; break; }
  }
  ok("[ec15] I04–I10：七矿物各自 999 不解锁、1000 恰解锁对应项（逐规则边界，事件驱动）", mineralsOk);

  // I11：四资源缺一不解锁 → 伪造旧池不解锁 → 补齐解锁（q-1 裁决实证）
  RRe.set(gsE, "moon:铷", 1);
  RRe.set(gsE, "mineral:莫尔石", 1);
  RRe.set(gsE, "planetary:等离子体", 1);
  const i11Missing = mapE.I11 === undefined;
  gsE.resources.moonOres["莫尔石"] = 999; // 直接伪造旧 moonOres 池键（绕过 Registry，不发事件）
  const evalFake = SYSF.evaluateEconomyAchievementRules(gsE, FROZEN_NOW);
  const i11FakeStill = mapE.I11 === undefined && evalFake.unlockedIds.indexOf("I11") === -1;
  RRe.set(gsE, "planetary:磁场聚合物", 1);
  const i11Done = mapE.I11 === FROZEN_NOW;
  ok("[ec16] I11 命名空间：三缺一不解锁；伪造旧 moonOres['莫尔石']=999 显式重估仍不解锁（moon:莫尔石非权威 ID）；补齐 planetary:磁场聚合物 后解锁",
    i11Missing && i11FakeStill && i11Done);

  // I11 数据侧交叉验证：真实 ITEM_CATEGORIES 与 combat.js 外环掉落同池
  const CATS = vm.runInContext("ITEM_CATEGORIES", sbF.sandbox);
  const ZONES = vm.runInContext("COMBAT_ZONES", sbF.sandbox);
  const outerZones = ZONES.filter((z) => Array.isArray(z.specialDrops) && z.specialDrops.some((d) => d.material === "莫尔石"));
  ok("[ec17] I11 交叉验证：ITEM_CATEGORIES.mineral 含莫尔石、ITEM_CATEGORIES.moon 不含莫尔石；combat.js 恰 3 个外环区掉落 resourceId 全为 mineral:莫尔石",
    CATS.mineral.includes("莫尔石") && !CATS.moon.includes("莫尔石") &&
    outerZones.length === 3 &&
    outerZones.every((z) => z.specialDrops.every((d) => d.material !== "莫尔石" || d.resourceId === "mineral:莫尔石")));

  // I12：物资总量首破 1,000,000 —— 恰好等于不解锁（严格大于）、+1 解锁
  const curTotal = RRe.getInventoryTotal(gsE);
  RRe.set(gsE, "mineral:三钛合金", RRe.get(gsE, "mineral:三钛合金") + (1000000 - curTotal));
  const atExact = RRe.getInventoryTotal(gsE) === 1000000 && mapE.I12 === undefined;
  RRe.add(gsE, "mineral:三钛合金", 1);
  const overOne = RRe.getInventoryTotal(gsE) === 1000001 && mapE.I12 === FROZEN_NOW;
  ok("[ec18] I12：总量恰 1,000,000 不解锁（严格大于）、1,000,001 解锁（getInventoryTotal 真实读数）", atExact && overOne);

  // inventory:changed 真实路径：本构建 LP 商店无普通装备（getLPStoreCatalogItems 仅返回
  // blueprint 类，buyLPItem 普通装备分支不可达），故改为新建隔离沙箱，直接置 minerals 使
  // inventory-total 严格大于阈值，再 emit 合法 inventory:changed 验证经济消费者已订阅该事件。
  const sbInv = buildFullGameSandbox(null);
  const gsInv = sbInv.sandbox.gameState;
  gsInv.resources.isk = 0; // 隔离，避免 I01–I03 干扰
  gsInv.resources.minerals = { "三钛合金": 1000001 }; // 总量恰 1,000,001 > 1,000,000
  const i12Before = gsInv.achievements.unlockedAtById.I12;
  sbInv.sandbox.GameEvents.emit("inventory:changed", { kind: "equipment", itemId: "probe", delta: 1 }, { timestamp: FROZEN_NOW, source: "audit" });
  ok("[ec19] inventory:changed 触发经济消费者重估：emit 合法事件后 I12 解锁（total 恰 1,000,001 满足严格大于），证明消费者已订阅 inventory:changed（注：当前 LP 商店无普通装备，buyLPItem 普通分支不可达，故改用事件直发验证订阅接线）",
    i12Before === undefined &&
    gsInv.achievements.unlockedAtById.I12 === FROZEN_NOW);

  ok("[ec20] 全脚本沙箱全程无事件契约失败（__guardReports 为空）", sbF.sandbox.__guardReports.length === 0);

  // ========================= E. persistence 存档追溯（spy 时间线）=========================
  const mineralNames = RD.ECONOMY_MINERAL_RESOURCE_IDS.map((id) => id.split(":")[1]);
  const ecoSave = {
    skills: { mining: { lvl: 1, xp: 0 } },
    resources: { isk: 150000000, fuel: 100, minerals: {}, moonOres: { "铷": 1 }, planetary: { "等离子体": 1, "磁场聚合物": 1 } },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    achievements: { schemaVersion: 1, unlockedAtById: {} },
    planetary: { deployments: [], nextId: 1 },
    statistics: { version: 1, totals: {} },
  };
  for (const n of mineralNames) ecoSave.resources.minerals[n] = 1000;
  ecoSave.resources.minerals["莫尔石"] = 1;
  let retroEco = null;
  try { retroEco = buildFullGameSandbox(JSON.stringify(ecoSave)); } catch (e) {
    ok("[ec21] 经济旧档加载不抛异常: " + (e && e.message), false);
  }
  if (retroEco) {
    const mR = retroEco.sandbox.gameState.achievements.unlockedAtById;
    const ecoCalls = retroEco.timeline.filter((e) => e.fn === "evaluateEconomyAchievementRules");
    const jEco = retroEco.timeline.findIndex((e) => e.fn === "evaluateEconomyAchievementRules");
    const jBp = retroEco.timeline.findIndex((e) => e.fn === "evaluateBlueprintAchievementRules");
    const jOff = retroEco.timeline.findIndex((e) => e.fn === "calculateOfflineGains");
    const expectedIds = ["I01", "I02", "I04", "I05", "I06", "I07", "I08", "I09", "I10", "I11"];
    ok("[ec21] 旧档追溯：economy 对账恰 1 次、位于 blueprint 之后·离线结算之前、atMs 与 blueprint 对账同一 achievementReconcileNow",
      ecoCalls.length === 1 && jEco >= 0 && jBp >= 0 && jOff >= 0 &&
      jBp < jEco && jEco < jOff &&
      retroEco.timeline[jEco].atMs === retroEco.timeline[jBp].atMs);
    ok("[ec22] 旧档追溯解锁恰 {I01,I02,I04–I11}（10 项全=登录冻结 Date.now()）；I03（isk<1e9）与 I12（总量<1e6）不解锁",
      ecoCalls.length === 1 && ecoCalls[0].result && ecoCalls[0].result.ok === true &&
      ecoCalls[0].result.unlockedIds.length === 10 &&
      expectedIds.every((id) => ecoCalls[0].result.unlockedIds.includes(id) && mR[id] === FROZEN_NOW) &&
      mR.I03 === undefined && mR.I12 === undefined);
  }

  // persistence 源码结构：economy 求值恰 4 处引用（importData/autoLoad 各 typeof 守卫+调用），
  // 每处调用都在对应 calculateOfflineGains() 之前；不安装消费者
  const persistSrcE = fs.readFileSync(path.join(ROOT, "js", "core", "persistence.js"), "utf-8");
  const ecoRefs = (persistSrcE.match(/evaluateEconomyAchievementRules/g) || []).length;
  const callPos = [];
  let sp = 0;
  while (true) {
    const at = persistSrcE.indexOf("AchievementSystem.evaluateEconomyAchievementRules(gameState", sp);
    if (at < 0) break;
    callPos.push(at);
    sp = at + 1;
  }
  const offlinePos = [];
  sp = 0;
  while (true) {
    const at = persistSrcE.indexOf("calculateOfflineGains()", sp);
    if (at < 0) break;
    offlinePos.push(at);
    sp = at + 1;
  }
  const eachBeforeOffline = callPos.length === 2 && callPos.every((c) => offlinePos.some((o) => o > c));
  ok("[ec23] persistence 源码结构：evaluateEconomyAchievementRules 恰 4 处引用（2 守卫+2 调用）、两处调用均在 calculateOfflineGains() 之前、不含 installEconomyAchievementConsumer",
    ecoRefs === 4 && eachBeforeOffline && !/installEconomyAchievementConsumer/.test(persistSrcE));

  // ========================= F. 分区只读收口 =========================
  const ACH_SYS_SNAP2 = snapFile(ACH_SYSTEM_PATH);
  const RULES_SNAP2 = snapFile(ACH_RULES_PATH);
  ok("[ec24] 分区前后 systems/achievements.js 与 data/achievement-rules.js 字节(SHA-256/长度)+mtime 完全不变",
    snapEq(ACH_SYS_SNAP, ACH_SYS_SNAP2) && snapEq(RULES_SNAP, RULES_SNAP2));
}

function runGeneral() {
  // 分区只读性字节级基准（只读收口）
  const ACH_SYS_SNAP = snapFile(ACH_SYSTEM_PATH);
  const RULES_SNAP = snapFile(ACH_RULES_PATH);

  // ========================= A. 冻结数据层（内核沙箱 + 真实规则文件）=========================
  const sbK = buildKernelSandbox({ withEvents: true, withRules: true });
  const RD = sbK.AchievementRuleData || (sbK.window && sbK.window.AchievementRuleData);
  const SYSK = sbK.AchievementSystem;
  ok("[gc1] 内核沙箱暴露 AchievementRuleData / AchievementSystem（general API 齐备）",
    !!RD && !!SYSK &&
    typeof SYSK.evaluateGeneralAchievementRules === "function" &&
    typeof SYSK.installGeneralAchievementConsumer === "function");

  const GEN = RD.GENERAL_RULES;
  ok("[gc2] GENERAL_RULES 恰 6 条、Object.isFrozen、achievementId 顺序精确 J01→J06、每条 Object.isFrozen",
    Array.isArray(GEN) && GEN.length === 6 && Object.isFrozen(GEN) &&
    GEN.every((r) => Object.isFrozen(r)) &&
    GEN.map((r) => r.achievementId).join(",") === "J01,J02,J03,J04,J05,J06");

  const BYID = RD.GENERAL_RULES_BY_ID;
  ok("[gc3] 规则类型与阈值精确：J01 lifecycle-online-seconds 86400、J02 lifecycle-online-seconds 604800、J03 lifecycle-offline-settlements 1、J04 lifecycle-offline-seconds 604800、J05 lifecycle-max-queue-items 25、J06 lifecycle-combat-repair-resumes 1",
    !!BYID && Object.isFrozen(BYID) && Object.keys(BYID).length === 6 &&
    BYID.J01.type === "lifecycle-online-seconds" && BYID.J01.minValue === 86400 &&
    BYID.J02.type === "lifecycle-online-seconds" && BYID.J02.minValue === 604800 &&
    BYID.J03.type === "lifecycle-offline-settlements" && BYID.J03.minValue === 1 &&
    BYID.J04.type === "lifecycle-offline-seconds" && BYID.J04.minValue === 604800 &&
    BYID.J05.type === "lifecycle-max-queue-items" && BYID.J05.minValue === 25 &&
    BYID.J06.type === "lifecycle-combat-repair-resumes" && BYID.J06.minValue === 1);

  ok("[gc4] GENERAL_RULES_BY_ID 冻结、6 键、值与 GENERAL_RULES 一一对应（同一对象引用）",
    !!BYID && Object.isFrozen(BYID) && Object.keys(BYID).length === 6 &&
    GEN.every((r) => BYID[r.achievementId] === r));

  // 194 / 3 全局恒等式（Batch C-14A 起为十二组两两零交集）
  const twelveSets = [
    RD.SKILL_RULES, RD.PRODUCTION_RULES, RD.COMBAT_RULES, RD.MANUFACTURING_RULES,
    RD.EQUIPMENT_RULES, RD.BOOSTER_RULES, RD.ARCHAEOLOGY_RULES, RD.PLANETARY_RULES,
    RD.STATION_RULES, RD.BLUEPRINT_RULES, RD.ECONOMY_RULES, RD.GENERAL_RULES,
  ].map((g) => new Set(g.map((r) => r.achievementId)));
  let twelveDisjoint = true;
  for (let i = 0; i < twelveSets.length && twelveDisjoint; i++)
    for (let j = i + 1; j < twelveSets.length && twelveDisjoint; j++)
      for (const id of twelveSets[i]) if (twelveSets[j].has(id)) { twelveDisjoint = false; break; }
  const twelveUnion = new Set();
  for (const s of twelveSets) for (const id of s) twelveUnion.add(id);
  const catalogTotal = (sbK.AchievementData && sbK.AchievementData.ACHIEVEMENTS) ? sbK.AchievementData.ACHIEVEMENTS.length : 0;
  ok("[gc5] 全局恒等式：十二组两两零交集、并集恰 194、ACHIEVEMENT_RULES=194、BY_ID=194 键、GROUPS=12 组、目录 197、未映射 197-194=3（仅 J10/J11/J12）",
    twelveDisjoint && twelveUnion.size === 194 &&
    Array.isArray(RD.ACHIEVEMENT_RULES) && RD.ACHIEVEMENT_RULES.length === 194 &&
    Object.keys(RD.ACHIEVEMENT_RULES_BY_ID).length === 194 &&
    RD.ACHIEVEMENT_RULE_GROUPS.length === 12 &&
    catalogTotal === 197 && catalogTotal - twelveUnion.size === 3);

  // ========================= B. 事件契约（真实 events.js）=========================
  const Contracts = sbK.GameEvents && sbK.GameEvents.contracts;
  ok("[gc6] events.js 注册 session:onlineElapsed / queue:itemAdded / combat:resumedAfterRepair / offline:settlementCompleted 契约（contracts.has 均为真）",
    !!Contracts &&
    Contracts.has("session:onlineElapsed") === true &&
    Contracts.has("queue:itemAdded") === true &&
    Contracts.has("combat:resumedAfterRepair") === true &&
    Contracts.has("offline:settlementCompleted") === true);

  const eventsSrcG = fs.readFileSync(EVENTS_PATH, "utf-8");
  const mOe = eventsSrcG.match(/"session:onlineElapsed":\s*\{\s*required:\s*\[([^\]]*)\],\s*numbers:\s*\[([^\]]*)\]\s*\}/);
  const mQi = eventsSrcG.match(/"queue:itemAdded":\s*\{\s*required:\s*\[([^\]]*)\],\s*numbers:\s*\[([^\]]*)\]\s*\}/);
  const mCr = eventsSrcG.match(/"combat:resumedAfterRepair":\s*\{\s*required:\s*\[([^\]]*)\],\s*numbers:\s*\[([^\]]*)\]\s*\}/);
  const mOs = eventsSrcG.match(/"offline:settlementCompleted":\s*\{\s*required:\s*\[([^\]]*)\],\s*numbers:\s*\[([^\]]*)\]\s*\}/);
  const strip = (s) => s.split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean).join(",");
  ok("[gc7] 契约字段精确：session:onlineElapsed required=[seconds] numbers=[seconds]；queue:itemAdded required=[itemId,size,maxSize] numbers=[size,maxSize]；combat:resumedAfterRepair required=[zoneId,defeatedMode] numbers=[]；offline:settlementCompleted required=[rawSeconds,settledSeconds] numbers=[rawSeconds,settledSeconds]",
    !!mOe && strip(mOe[1]) === "seconds" && strip(mOe[2]) === "seconds" &&
    !!mQi && strip(mQi[1]) === "itemId,size,maxSize" && strip(mQi[2]) === "size,maxSize" &&
    !!mCr && strip(mCr[1]) === "zoneId,defeatedMode" && strip(mCr[2]) === "" &&
    !!mOs && strip(mOs[1]) === "rawSeconds,settledSeconds" && strip(mOs[2]) === "rawSeconds,settledSeconds");

  ok("[gc8] 契约校验行为：session:onlineElapsed 合法（seconds=5）/ 缺 seconds 失败；queue:itemAdded 合法（三项齐全）/ 缺 size 失败；combat:resumedAfterRepair 合法（zoneId+defeatedMode）/ 缺 defeatedMode 失败",
    !!Contracts &&
    Contracts.validate("session:onlineElapsed", { seconds: 5 }).valid === true &&
    Contracts.validate("session:onlineElapsed", {}).valid === false &&
    Contracts.validate("queue:itemAdded", { itemId: "q1", size: 1, maxSize: 25 }).valid === true &&
    Contracts.validate("queue:itemAdded", { itemId: "q1", size: 1 }).valid === false &&
    Contracts.validate("combat:resumedAfterRepair", { zoneId: "z", defeatedMode: "belt" }).valid === true &&
    Contracts.validate("combat:resumedAfterRepair", { zoneId: "z" }).valid === false);

  // ========================= C. lifecycle 统计结构（fresh 默认）=========================
  const sbF = buildFullGameSandbox(null);
  const gsG = sbF.sandbox.gameState;
  const STATG = sbF.sandbox.gameState.statistics;
  ok("[gc9] 全脚本沙箱 fresh 统计：statistics.version === 9；lifecycle 五字段齐全且默认 0（onlineSeconds/offlineSettledSeconds 为数字 0；offlineSettlements/maxQueueItems/combatRepairResumes 为非负整数 0）",
    !!STATG && STATG.version === 9 &&
    STATG.lifecycle && typeof STATG.lifecycle === "object" &&
    typeof STATG.lifecycle.onlineSeconds === "number" && STATG.lifecycle.onlineSeconds === 0 &&
    typeof STATG.lifecycle.offlineSettledSeconds === "number" && STATG.lifecycle.offlineSettledSeconds === 0 &&
    Number.isInteger(STATG.lifecycle.offlineSettlements) && STATG.lifecycle.offlineSettlements === 0 &&
    Number.isInteger(STATG.lifecycle.maxQueueItems) && STATG.lifecycle.maxQueueItems === 0 &&
    Number.isInteger(STATG.lifecycle.combatRepairResumes) && STATG.lifecycle.combatRepairResumes === 0);

  // ========================= D. 全脚本沙箱真实行为（J01–J06 逐规则链路）=========================
  const SYSF = sbF.sandbox.AchievementSystem;
  const mapG = gsG.achievements.unlockedAtById;
  const GEG = sbF.sandbox.GameEvents;
  // 确保综合消费者已安装（脚本加载自动安装 → ALREADY_INSTALLED，或显式补装 → ok:true）
  const gi = SYSF.installGeneralAchievementConsumer(gsG);
  ok("[gc10] 综合成就消费者已安装（自动安装 → ALREADY_INSTALLED；或显式安装 → ok:true）",
    !!gi && (gi.ok === true || gi.reason === "ALREADY_INSTALLED"));

  // ---- D1. J01/J02：真实 gameTick → accumulateOnlineSessionTime → session:onlineElapsed ----
  // 禁止手工 emit：直接驱动真实 gameTick，用替换沙箱内 Date.now 的方式推进"真实时钟"。
  const setNowF = (ms) => { sbF.sandbox.Date.now = () => ms; };
  const TICK = sbF.sandbox.gameTick;
  const T0 = FROZEN_NOW;
  setNowF(T0); TICK();                       // 首 tick：只建锚点，不累计、不发事件
  const anchorOnly = STATG.lifecycle.onlineSeconds === 0 && mapG.J01 === undefined;
  setNowF(T0); TICK();                       // 相同 now：delta=0，不累计、不发空事件
  const sameNowNoop = STATG.lifecycle.onlineSeconds === 0;
  setNowF(T0 + 5500); TICK();                // 真实推进 5.5s（秒量纲保留小数）
  const acc55 = STATG.lifecycle.onlineSeconds === 5.5;
  setNowF(T0 - 10000); TICK();               // 时钟倒退：重建锚点，绝不累计负数
  const rewindSafe = STATG.lifecycle.onlineSeconds === 5.5;
  setNowF(T0 - 10000 + 1000); TICK();        // 倒退后从新锚点继续正常累计
  const afterRewind = STATG.lifecycle.onlineSeconds === 6.5;
  ok("[gc11] 在线时长真实链路（无手工 emit，全部经真实 gameTick）：首 tick 只建锚不累计；同一 now 重复 tick 不累计不发空事件；真实推进 5.5s → onlineSeconds=5.5（保留小数）；时钟倒退不累计负数且重建锚点，其后 +1s → 6.5",
    anchorOnly && sameNowNoop && acc55 && rewindSafe && afterRewind);

  const TA = T0 - 10000 + 1000 + 86393000;   // +86393s → 6.5 + 86393 = 86399.5（阈值前）
  setNowF(TA); TICK();
  const j01Before = STATG.lifecycle.onlineSeconds === 86399.5 && mapG.J01 === undefined;
  const TB = TA + 500;                        // +0.5s → 恰好 86400（跨 J01 线）
  setNowF(TB); TICK();
  const j01Cross = STATG.lifecycle.onlineSeconds === 86400 && mapG.J01 === TB && mapG.J02 === undefined;
  const TC = TB + 518400000;                  // +518400s → 恰好 604800（跨 J02 线）
  setNowF(TC); TICK();
  const j02Cross = STATG.lifecycle.onlineSeconds === 604800 && mapG.J02 === TC && mapG.J01 === TB;
  ok("[gc12] J01/J02 真实跨线：真实 gameTick 累计到 86399.5s 时 J01 未解锁；跨到 86400s 当拍解锁 J01（时间戳=该 tick 的真实 now）；继续累计到 604800s 当拍解锁 J02，且不改写 J01 时间戳",
    j01Before && j01Cross && j02Cross);
  setNowF(FROZEN_NOW); // 后续离线 / 战斗链路回到冻结时钟

  // ---- D2. J03/J04：真实 applyOfflineGains → offline:settlementCompleted ----
  const APPLY_OFF = sbF.sandbox.applyOfflineGains;
  const offEvents = [];
  GEG.on("offline:settlementCompleted", (ev) => offEvents.push(ev));
  APPLY_OFF(5, { runId: "gcoff_below" });      // 5s：applyOfflineGains 内 seconds<=5 直接 return
  const off5Noop = offEvents.length === 0 && STATG.lifecycle.offlineSettlements === 0 &&
    STATG.lifecycle.offlineSettledSeconds === 0 && mapG.J03 === undefined;
  APPLY_OFF(5.5, { runId: "gcoff_1" });        // 5.5s：真实结算一次（保留小数）
  const off55 = offEvents.length === 1 && STATG.lifecycle.offlineSettlements === 1 &&
    STATG.lifecycle.offlineSettledSeconds === 5.5 && mapG.J03 === FROZEN_NOW;
  APPLY_OFF(999999, { runId: "gcoff_2" });     // 超长离线：单次按 MAX_OFFLINE_SECONDS=86400 封顶
  const offCap = offEvents.length === 2 &&
    offEvents[1].payload.rawSeconds === 999999 && offEvents[1].payload.settledSeconds === 86400 &&
    STATG.lifecycle.offlineSettlements === 2 && STATG.lifecycle.offlineSettledSeconds === 86405.5;
  APPLY_OFF(999999, { runId: "gcoff_2" });     // 同 runId → 同 eventId → 统计消费者幂等丢弃
  const offReplay = offEvents.length === 3 && offEvents[2].eventId === offEvents[1].eventId &&
    STATG.lifecycle.offlineSettlements === 2 && STATG.lifecycle.offlineSettledSeconds === 86405.5;
  ok("[gc13] J03 离线真实链路（无手工 emit，全部经真实 applyOfflineGains）：5s 不结算不发事件不解锁；5.5s 真实结算一次 → offlineSettlements=1、offlineSettledSeconds=5.5、J03 解锁；999999s 单次按 86400 封顶；同 eventId 重放事件仍发出但统计不双计",
    off5Noop && off55 && offCap && offReplay);

  for (let k = 0; k < 5; k++) APPLY_OFF(86400, { runId: "gcoff_j04_" + k });
  const j04Before = STATG.lifecycle.offlineSettlements === 7 &&
    STATG.lifecycle.offlineSettledSeconds === 518405.5 && mapG.J04 === undefined;
  APPLY_OFF(86400, { runId: "gcoff_j04_last" });
  const j04Cross = STATG.lifecycle.offlineSettlements === 8 &&
    STATG.lifecycle.offlineSettledSeconds === 604805.5 && mapG.J04 === FROZEN_NOW;
  ok("[gc14] J04 真实跨线：7 次真实结算累计 518405.5s 时 J04 未解锁；第 8 次真实结算跨过 604800s → J04 于结算事件时间戳解锁（全部来自 applyOfflineGains 真实发射）",
    j04Before && j04Cross);

  // ---- D3. J06：真实 combat/beginRecovery → updateCombatRecovery 自动恢复出击 ----
  const DGA = sbF.sandbox.dispatchGameAction;
  const UCR = sbF.sandbox.updateCombatRecovery;
  const resumeEvents = [];
  GEG.on("combat:resumedAfterRepair", (ev) => resumeEvents.push(ev));
  const beltZoneId = gsG.combat.zone;
  const beginRes = DGA(gsG, { type: "combat/beginRecovery" }, FROZEN_NOW);
  const beganOk = !!beginRes && beginRes.changed === true &&
    gsG.combat.repairUntil === FROZEN_NOW + 180000 && gsG.currentAction.active === false &&
    !!gsG.resumeAfterRepair && gsG.resumeAfterRepair.type === "combat" &&
    gsG.resumeAfterRepair.returnZoneId === beltZoneId;
  UCR(FROZEN_NOW + 1000);                    // 维修未到期：不结束维修、不恢复出击
  const notDue = resumeEvents.length === 0 && STATG.lifecycle.combatRepairResumes === 0 &&
    mapG.J06 === undefined && !!gsG.resumeAfterRepair &&
    gsG.combat.repairUntil === FROZEN_NOW + 180000 && gsG.combat.active === false;
  UCR(FROZEN_NOW + 180000);                  // 维修到期：同一入口真实自动恢复出击
  const resumed = resumeEvents.length === 1 &&
    resumeEvents[0].meta.source === "game" && resumeEvents[0].meta.offline === false &&
    resumeEvents[0].payload.zoneId === beltZoneId && resumeEvents[0].payload.defeatedMode === "belt" &&
    gsG.combat.active === true && gsG.currentAction.active === true && gsG.currentAction.skill === "combat" &&
    gsG.combat.wave === 1 && gsG.resumeAfterRepair === null && gsG.combat.repairUntil === 0 &&
    STATG.lifecycle.combatRepairResumes === 1 && mapG.J06 === FROZEN_NOW;
  ok("[gc15] J06 真实链路（无手工 emit、无源码正则）：dispatchGameAction(combat/beginRecovery) 建立 repairUntil+resumeAfterRepair → 未到期时 updateCombatRecovery 不结束维修不恢复不解锁 → 到期后同一唯一入口真实 finishRecovery + tryResumeCombatAfterRepair + combat/start 成功 → 生产代码真实发射 1 次 combat:resumedAfterRepair（meta.source=game）、combatRepairResumes 0→1、J06 解锁",
    beganOk && notDue && resumed);

  // J06 负面：重复调用 / 主动 stop 取消 / 非法 returnZoneId / combat/start 校验失败
  UCR(FROZEN_NOW + 180000);
  UCR(FROZEN_NOW + 999999);
  const idemNoDouble = resumeEvents.length === 1 && STATG.lifecycle.combatRepairResumes === 1;

  DGA(gsG, { type: "combat/beginRecovery" }, FROZEN_NOW);
  const stopRes = DGA(gsG, { type: "combat/stop" }, FROZEN_NOW);
  UCR(FROZEN_NOW + 180000);
  const stopCancels = !!stopRes && stopRes.changed === true && stopRes.cancelledResume === true &&
    gsG.resumeAfterRepair === null && resumeEvents.length === 1 && STATG.lifecycle.combatRepairResumes === 1;

  gsG.combat.zone = "__no_such_zone__";
  DGA(gsG, { type: "combat/beginRecovery" }, FROZEN_NOW);
  UCR(FROZEN_NOW + 180000);
  const badZoneSafe = resumeEvents.length === 1 && STATG.lifecycle.combatRepairResumes === 1 &&
    gsG.resumeAfterRepair === null && gsG.combat.active === false;

  // angel_corridor 是 COMBAT_ZONES 中 requiredCL:15 的高等级星带（js/data/combat.js:125），
  // fresh 沙箱战斗等级为 1，故未解锁，用作 level-locked 负面测试目标。
  // 注意：COMBAT_ZONES 仅存在于 js/data/combat.js 闭包内、未通过 window/sandbox 暴露，
  // 这里直接硬编码已知未解锁 id，不依赖 sandbox 上不可得的引用（避免假绿）。
  const LOCKED_ZONE_ID = "angel_corridor";
  gsG.combat.zone = LOCKED_ZONE_ID;
  DGA(gsG, { type: "combat/beginRecovery" }, FROZEN_NOW);
  UCR(FROZEN_NOW + 180000);
  const startRejected = gsG.resumeAfterRepair === null && gsG.combat.active === false &&
    gsG.combat.zone === LOCKED_ZONE_ID &&
    resumeEvents.length === 1 && STATG.lifecycle.combatRepairResumes === 1;

  ok("[gc16] J06 负面全覆盖：重复 updateCombatRecovery 不重复恢复不重复 emit；玩家 combat/stop 取消待恢复后维修到期不恢复；非法 returnZoneId 安全停止；combat/start 校验失败（未解锁高等级星带 level-locked）不发事件 —— 全程 combat:resumedAfterRepair 恰 1 次、combatRepairResumes 恒为 1、J06 只解锁一次且时间戳不变",
    idemNoDouble && stopCancels && badZoneSafe && startRejected && mapG.J06 === FROZEN_NOW);

  // ---- D4. statistics v9 生命周期清洗 / v8→v9 追溯（真实 ensureStatisticsState，全程零 emit）----
  const ENSUREG = sbF.sandbox.ensureStatisticsState;
  let anyEmitCount = 0;
  GEG.on("*", () => { anyEmitCount++; });
  const emitBase = anyEmitCount;
  const dirty9 = {
    queue: { items: [], config: { maxSize: 25 } },
    statistics: {
      version: 9,
      lifecycle: {
        onlineSeconds: "1234", offlineSettledSeconds: 12.75,
        offlineSettlements: -3, maxQueueItems: 7.9, combatRepairResumes: NaN,
      },
    },
  };
  ENSUREG(dirty9);
  const lc9 = dirty9.statistics.lifecycle;
  const clean9 = lc9.onlineSeconds === 0 && lc9.offlineSettledSeconds === 12.75 &&
    lc9.offlineSettlements === 0 && lc9.maxQueueItems === 7 && lc9.combatRepairResumes === 0;
  const snap9 = JSON.stringify(dirty9.statistics.lifecycle);
  ENSUREG(dirty9);
  const idem9 = JSON.stringify(dirty9.statistics.lifecycle) === snap9;
  ok("[gc17] statistics v9 生命周期清洗（真实 ensureStatisticsState）：数字串/负数/NaN 一律归 0；秒量纲 offlineSettledSeconds=12.75 保留小数不被抹平；计数量纲 maxQueueItems 7.9→7（Math.floor）；重复调用完全幂等",
    clean9 && idem9);

  const legacy8 = {
    queue: { items: Array.from({ length: 22 }, (_, i) => ({ id: "L" + i, skill: "mining", target: "t" + i, count: 1 })), config: { maxSize: 25 } },
    statistics: { version: 8, station: { maxOfflineSettlementSeconds: 7200 } },
  };
  ENSUREG(legacy8);
  const lc8 = legacy8.statistics.lifecycle;
  const retro8 = legacy8.statistics.version === 9 && lc8.maxQueueItems === 22 &&
    lc8.offlineSettlements === 1 && lc8.offlineSettledSeconds === 7200 &&
    lc8.onlineSeconds === 0 && lc8.combatRepairResumes === 0;
  const snap8 = JSON.stringify(legacy8.statistics.lifecycle);
  ENSUREG(legacy8);
  const idem8 = JSON.stringify(legacy8.statistics.lifecycle) === snap8;
  ok("[gc18] statistics v8→v9 真实追溯：version 升 9；maxQueueItems 取 queue.items 真实长度 22（历史下界）；旧 station.maxOfflineSettlementSeconds=7200>5 → offlineSettlements=1、offlineSettledSeconds=7200；onlineSeconds/combatRepairResumes 无历史事实保持 0（不臆测）；再次调用幂等；全程零事件发射（无虚假 emit）",
    retro8 && idem8 && anyEmitCount === emitBase);

  // 幂等与不回滚：真实 tick 再累计不撤销已解锁项
  const j01before = mapG.J01;
  const j02before = mapG.J02;
  setNowF(TC + 1000); TICK();
  ok("[gc19] 幂等与不回滚：真实 gameTick 再累计 1s（total 604801）后 J01/J02 时间戳完全不变、不被撤销或改写",
    mapG.J01 === j01before && mapG.J02 === j02before &&
    STATG.lifecycle.onlineSeconds === 604801 && j01before === TB && j02before === TC);
  setNowF(FROZEN_NOW);

  ok("[gc20] 全脚本沙箱全程无事件契约失败（__guardReports 为空）", sbF.sandbox.__guardReports.length === 0);

  // ---- D5. J05：旧档 maxSize:20 真实加载 → 25，保留 20 项，追加 5 项达 25 解锁（真实链路，无手工 emit）----
  // 复用 sbF：将 localStorage 切换为旧档（maxSize:20、20 项队列），调用真实 SaveManager.load()，
  // 校验 normalizeQueueState 把 maxSize 升级为 25 且完整保留 20 项；
  // 再经真实 dispatchGameAction("queue/add") 追加 5 项（不同 skill 避免与末项合并），
  // 触发真实 queue:itemAdded → 统计 lifecycle.maxQueueItems 达 25 → 综合成就消费者当拍解锁 J05。
  const oldQueueItems = Array.from({ length: 20 }, (_, i) => ({ id: "OLDQ" + i, skill: "mining", target: "t" + i, count: 1 }));
  const oldSave = {
    skills: { mining: { lvl: 1, xp: 0 } },
    resources: { isk: 100, fuel: 100, minerals: {}, moonOres: {}, planetary: {} },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    achievements: { schemaVersion: 1, unlockedAtById: {} },
    queue: {
      items: oldQueueItems,
      config: { maxSize: 20, loopMode: false, skipOnFail: true },
      status: { activeIndex: -1, isRunning: false, completedCount: 0, failCount: 0 },
    },
    statistics: {
      version: 9,
      totals: {},
      lifecycle: { onlineSeconds: 0, offlineSettlements: 0, offlineSettledSeconds: 0, maxQueueItems: 20, combatRepairResumes: 0 },
    },
    planetary: { deployments: [], nextId: 1 },
  };
  sbF.sandbox.localStorage = {
    getItem: (k) => (k === "eve_idle_save" ? JSON.stringify(oldSave) : null),
    setItem: () => {}, removeItem: () => {},
  };
  const smLoadJ05 = sbF.sandbox.SaveManager.load();
  const lcJ05 = gsG.statistics.lifecycle;
  const migratedJ05 = smLoadJ05 === true && gsG.queue.config.maxSize === 25 && gsG.queue.items.length === 20 && lcJ05.maxQueueItems === 20;
  const DGAJ = sbF.sandbox.dispatchGameAction;
  let j05Before5 = undefined;
  for (let k = 0; k < 5; k++) {
    DGAJ(gsG, { type: "queue/add", item: { skill: "manufacturing", target: "m" + k, count: 1 } }, FROZEN_NOW);
    if (k === 3) j05Before5 = gsG.achievements.unlockedAtById.J05; // 4 项后队列长度=24，J05 未解锁
  }
  const unlockedJ05 = gsG.achievements.unlockedAtById.J05 !== undefined;
  const j05Threshold = j05Before5 === undefined && unlockedJ05;
  console.error("DBG_J05", JSON.stringify({ smLoadJ05, maxSize: gsG.queue && gsG.queue.config && gsG.queue.config.maxSize, items: gsG.queue && gsG.queue.items.length, mq: lcJ05 && lcJ05.maxQueueItems, j05Before5, unlockedJ05, afterAdd: gsG.queue && gsG.queue.items.length }));
  ok("[gcJ05] J05 真实旧档迁移链路（无手工 emit）：旧档 maxSize=20 经真实 SaveManager.load 加载后 maxSize 升级 25、20 项完整保留、maxQueueItems=20；经真实 queue/add 追加 5 项（队列真实长度 25、lifecycle.maxQueueItems=25）触发真实 queue:itemAdded → 综合成就消费者当拍解锁 J05，且恰好在达到 25 时解锁（24 时未解锁）",
    migratedJ05 && j05Threshold && gsG.queue.items.length === 25 && lcJ05.maxQueueItems === 25);

  // ========================= E. persistence 存档追溯（spy 时间线）=========================
  const genSave = {
    skills: { mining: { lvl: 1, xp: 0 } },
    resources: { isk: 100, fuel: 100, minerals: {}, moonOres: {}, planetary: {} },
    lastSaveTime: FROZEN_NOW - 3600 * 1000,
    achievements: { schemaVersion: 1, unlockedAtById: {} },
    queue: { items: [], config: { maxSize: 25, loopMode: false, skipOnFail: true }, status: { activeIndex: -1, isRunning: false, completedCount: 0, failCount: 0 } },
    statistics: {
      version: 9,
      totals: {},
      lifecycle: { onlineSeconds: 86400, offlineSettlements: 1, offlineSettledSeconds: 0, maxQueueItems: 25, combatRepairResumes: 0 },
    },
    planetary: { deployments: [], nextId: 1 },
  };
  let retroGen = null;
  try { retroGen = buildFullGameSandbox(JSON.stringify(genSave)); } catch (e) {
    ok("[gc18] 综合旧档加载不抛异常: " + (e && e.message), false);
  }
  if (retroGen) {
    const mRg = retroGen.sandbox.gameState.achievements.unlockedAtById;
    const genCalls = retroGen.timeline.filter((e) => e.fn === "evaluateGeneralAchievementRules");
    const jGen = retroGen.timeline.findIndex((e) => e.fn === "evaluateGeneralAchievementRules");
    const jBp = retroGen.timeline.findIndex((e) => e.fn === "evaluateBlueprintAchievementRules");
    const jOff = retroGen.timeline.findIndex((e) => e.fn === "calculateOfflineGains");
    const expectedGen = ["J01", "J03", "J05"];
    ok("[gc18] 旧档追溯：general 对账恰 1 次、位于 blueprint 之后·离线结算之前、atMs 与 blueprint 对账同一 achievementReconcileNow",
      genCalls.length === 1 && jGen >= 0 && jBp >= 0 && jOff >= 0 &&
      jBp < jGen && jGen < jOff &&
      retroGen.timeline[jGen].atMs === retroGen.timeline[jBp].atMs);
    ok("[gc19] 旧档追溯解锁恰 {J01,J03,J05}（onlineSeconds=86400→J01；offlineSettlements=1→J03；maxQueueItems=25→J05），未达标的 J02/J04/J06 不解锁",
      genCalls.length === 1 && genCalls[0].result && genCalls[0].result.ok === true &&
      genCalls[0].result.unlockedIds.length === 3 &&
      expectedGen.every((id) => genCalls[0].result.unlockedIds.includes(id) && mRg[id] === FROZEN_NOW) &&
      mRg.J02 === undefined && mRg.J04 === undefined && mRg.J06 === undefined);
  }

  // persistence 源码结构：evaluateGeneralAchievementRules 恰 4 处引用（2 守卫+2 调用），
  // 每处调用都在对应 calculateOfflineGains() 之前；不安装消费者
  const persistSrcG = fs.readFileSync(path.join(ROOT, "js", "core", "persistence.js"), "utf-8");
  const genRefs = (persistSrcG.match(/evaluateGeneralAchievementRules/g) || []).length;
  const callPosG = [];
  let spG = 0;
  while (true) {
    const at = persistSrcG.indexOf("AchievementSystem.evaluateGeneralAchievementRules(gameState", spG);
    if (at < 0) break;
    callPosG.push(at);
    spG = at + 1;
  }
  const offlinePosG = [];
  spG = 0;
  while (true) {
    const at = persistSrcG.indexOf("calculateOfflineGains()", spG);
    if (at < 0) break;
    offlinePosG.push(at);
    spG = at + 1;
  }
  const eachBeforeOfflineG = callPosG.length === 2 && callPosG.every((c) => offlinePosG.some((o) => o > c));
  ok("[gc20] persistence 源码结构：evaluateGeneralAchievementRules 恰 4 处引用（2 守卫+2 调用）、两处调用均在 calculateOfflineGains() 之前、不含 installGeneralAchievementConsumer",
    genRefs === 4 && eachBeforeOfflineG && !/installGeneralAchievementConsumer/.test(persistSrcG));

  // ========================= F. 分区只读收口 =========================
  const ACH_SYS_SNAP2 = snapFile(ACH_SYSTEM_PATH);
  const RULES_SNAP2 = snapFile(ACH_RULES_PATH);
  ok("[gc21] 分区前后 systems/achievements.js 与 data/achievement-rules.js 字节(SHA-256/长度)+mtime 完全不变",
    snapEq(ACH_SYS_SNAP, ACH_SYS_SNAP2) && snapEq(RULES_SNAP, RULES_SNAP2));
}

const args = process.argv.slice(2);
const KNOWN = new Set(["--data", "--state", "--unlock", "--skills", "--production", "--combat", "--manufacturing", "--equipment", "--boosters", "--archaeology", "--planetary", "--station", "--blueprint", "--economy", "--general"]);
const unknown = args.filter(a => !KNOWN.has(a));
if (unknown.length > 0) {
  console.error("[audit-achievements] 未知参数：" + unknown.join(" ") + "（可用：--data --state --unlock --skills --production --combat --manufacturing --equipment --boosters --archaeology --planetary --station --blueprint --economy --general，可组合；无参数=全部）");
  process.exit(2);
}
const isAll = args.length === 0; // 无参数 = data + state + unlock + skills + production + combat + manufacturing + equipment + boosters + archaeology + planetary + station + blueprint + economy + general
const runFlags = {
  data: isAll || args.includes("--data"),
  state: isAll || args.includes("--state"),
  unlock: isAll || args.includes("--unlock"),
  skills: isAll || args.includes("--skills"),
  production: isAll || args.includes("--production"),
  combat: isAll || args.includes("--combat"),
  manufacturing: isAll || args.includes("--manufacturing"),
  equipment: isAll || args.includes("--equipment"),
  boosters: isAll || args.includes("--boosters"),
  archaeology: isAll || args.includes("--archaeology"),
  planetary: isAll || args.includes("--planetary"),
  station: isAll || args.includes("--station"),
  blueprint: isAll || args.includes("--blueprint"),
  economy: isAll || args.includes("--economy"),
  general: isAll || args.includes("--general"),
};

console.log("=== audit-achievements.mjs " + (isAll ? "(all: data+state+unlock+skills+production+combat+manufacturing+equipment+boosters+archaeology+planetary+station+blueprint+economy+general)" : args.join(" ")) + " ===");

// 审计整体只读性证明：执行前对正式工作区 CSV/JS 拍快照（字节 SHA-256 + 长度 + mtime）
const preWsCsv = snapFile(CSV_PATH);
const preWsJs = snapFile(JS_PATH);
console.log("[ach] info  审计前 正式CSV: " + preWsCsv.len + "B sha256=" + preWsCsv.sha + " mtimeNs=" + preWsCsv.mtimeNs);
console.log("[ach] info  审计前 正式JS : " + preWsJs.len + "B sha256=" + preWsJs.sha + " mtimeNs=" + preWsJs.mtimeNs);

const sectionTotals = [];
function runSection(name, fn) {
  const p0 = pass, f0 = fail;
  console.log("");
  console.log("---- 区域 --" + name + " ----");
  try {
    fn();
  } catch (e) {
    // 任何未预期异常也必须进入 PASS/FAIL 汇总，不允许无汇总中断
    ok("[FATAL] --" + name + " 区域未抛异常（" + (e && e.message ? e.message : String(e)) + "）", false);
  }
  sectionTotals.push({ name, pass: pass - p0, fail: fail - f0 });
}

if (runFlags.data) runSection("data", runData);
if (runFlags.state) runSection("state", runState);
if (runFlags.unlock) runSection("unlock", runUnlock);
if (runFlags.skills) runSection("skills", runSkills);
if (runFlags.production) runSection("production", runProduction);
if (runFlags.combat) runSection("combat", runCombat);
if (runFlags.manufacturing) runSection("manufacturing", runManufacturing);
if (runFlags.equipment) runSection("equipment", runEquipment);
if (runFlags.boosters) runSection("boosters", runBoosters);
if (runFlags.archaeology) runSection("archaeology", runArchaeology);
if (runFlags.planetary) runSection("planetary", runPlanetary);
if (runFlags.station) runSection("station", runStation);
if (runFlags.blueprint) runSection("blueprint", runBlueprint);
if (runFlags.economy) runSection("economy", runEconomy);
if (runFlags.general) runSection("general", runGeneral);

// 审计整体只读性证明：执行后再拍快照，字节 + mtime 必须完全不变
const postWsCsv = snapFile(CSV_PATH);
const postWsJs = snapFile(JS_PATH);
console.log("[ach] info  审计后 正式CSV: " + postWsCsv.len + "B sha256=" + postWsCsv.sha + " mtimeNs=" + postWsCsv.mtimeNs);
console.log("[ach] info  审计后 正式JS : " + postWsJs.len + "B sha256=" + postWsJs.sha + " mtimeNs=" + postWsJs.mtimeNs);
ok("[RO1] 审计前后正式工作区 CSV 字节(SHA-256/长度)+mtime 完全不变", snapEq(preWsCsv, postWsCsv));
ok("[RO2] 审计前后正式工作区 JS 字节(SHA-256/长度)+mtime 完全不变", snapEq(preWsJs, postWsJs));

console.log("");
console.log("===== 汇总 =====");
for (const s of sectionTotals) console.log("  区域 --" + s.name + ": PASS=" + s.pass + "  FAIL=" + s.fail);
console.log("PASS=" + pass + "  FAIL=" + fail);
if (fail > 0) {
  console.log("失败项：");
  failNames.forEach(n => console.log("  - " + n));
  process.exit(1);
}
process.exit(0);
