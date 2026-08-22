// tools/test-leaderboard-calculation.mjs
//
// 标准服技能排行榜 —— 第一阶段只读计算层专项测试（动态版）。
// 核心要求：单项榜由真实技能注册表（state.skills）动态生成，固定 16 项不达标。
//
// 覆盖：
//   - 可升级技能数量 === 单项榜数量（动态，不写死 16）
//   - 每个 skillId 都有且只有一个 boardId
//   - 无重复、无遗漏
//   - 新增一个临时技能定义后，生成榜单数量自动增加
//   - 综合榜求和正确（total / combat.total / production.total / gathering.total / research.total）
//   - 战斗技能按真实注册表全部拆开（不预设激光/炮台/...名称）
//   - 缺失技能不报错
//   - NaN / 负数经验归零
//   - 调用前后 state 深比较完全一致（函数不写入 state）
//   - 不创建 timer（setInterval/setTimeout 未被调用）
//   - 不接 TapTap/Steam
//   - 不改 UI
//
// 运行（FRESH 根目录）：
//   node tools/test-leaderboard-calculation.mjs
//
// 本脚本不写入仓库、不接入任何平台、不修改运行时。

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  getLeaderboardScore,
  getLeaderboardSnapshot,
  getLeaderboardDefinitions,
  getSkillRegistry,
} from "../js/data/leaderboard.js";

let passCount = 0;
let failCount = 0;
function totalFor(v) {
  const lvl = Math.max(0, Math.floor(v && v.lvl || 0));
  const current = v && Number.isFinite(v.xp) && v.xp > 0 ? v.xp : 0;
  return current + Array.from({ length: Math.max(0, lvl - 1) }, (_, i) => Math.floor(100 * Math.pow(1.1, i + 1))).reduce((a, b) => a + b, 0);
}
function ok(name, cond, detail = "") {
  if (cond) passCount++;
  else failCount++;
  console.log((cond ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
}

// 深比较（结构 + 值），用于验证 state 未被修改
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

// 基础 state（含全部真实技能字段，lvl/xp 已知）
function baseState() {
  return {
    lastSavedAt: 1700000000000,
    skills: {
      mining:                 { lvl: 3, xp: 100 },
      planetaryIndustry:      { lvl: 1, xp: 0 },
      refining:               { lvl: 4, xp: 200 },   // smelting
      gasHarvesting:          { lvl: 2, xp: 50 },
      shipEngineering:        { lvl: 5, xp: 300 },
      equipmentEngineering:   { lvl: 1, xp: 10 },
      boosterEngineering:     { lvl: 2, xp: 20 },
      laserOps:               { lvl: 3, xp: 30 },
      cannonOps:              { lvl: 3, xp: 40 },
      missileOperations:      { lvl: 3, xp: 50 },
      defense:                { lvl: 2, xp: 60 },
      shieldOperation:        { lvl: 4, xp: 70 },
      armorReinforcement:     { lvl: 4, xp: 80 },
      hullEngineering:        { lvl: 4, xp: 90 },
      targeting:              { lvl: 1, xp: 5 },
      piloting:               { lvl: 1, xp: 0 },
      capacitorManagement:    { lvl: 1, xp: 0 },
      drones:                 { lvl: 1, xp: 0 },
      combat:                 { lvl: 1, xp: 0 },
      archaeology:            { lvl: 6, xp: 400 },
    },
  };
}

function main() {
  const st = baseState();

  // ---------- 真实技能注册表输出 ----------
  const registry = getSkillRegistry(st);
  const registryIds = registry.map((r) => r.id);
  console.log("\n=== 真实技能注册表（getSkillRegistry）===");
  console.log("可升级技能总数 = " + registry.length);
  for (const r of registry) {
    console.log("  " + r.id.padEnd(22) + " name=" + r.name.padEnd(8) + " category=" + r.category);
  }

  // ---------- 1) 单项榜完整清单（动态）----------
  const defs = getLeaderboardDefinitions(st);
  const singleDefs = defs.filter((d) => d.type === "single");
  const aggDefs = defs.filter((d) => d.type === "aggregate");
  console.log("\n=== 单项榜清单（动态 skill:<id>）===");
  for (const d of singleDefs) console.log("  " + d.boardId + "  <- " + d.skillId + " (" + d.category + ")");
  console.log("\n=== 综合榜清单（固定）===");
  for (const d of aggDefs) console.log("  " + d.boardId + "  (" + (d.category || "all") + ")");

  // ---------- 2) 可升级技能数量 === 单项榜数量 ----------
  ok("2 可升级技能数=单项榜数", registry.length === singleDefs.length,
     "registry=" + registry.length + " single=" + singleDefs.length);

  // ---------- 3) 每个 skillId 都有且只有一个 boardId；无重复无遗漏 ----------
  {
    const boardIds = singleDefs.map((d) => d.boardId);
    const skillIds = singleDefs.map((d) => d.skillId);
    // 每个 skillId 恰一个 boardId
    const uniqueBoard = new Set(boardIds).size === boardIds.length;
    const uniqueSkill = new Set(skillIds).size === skillIds.length;
    // 无遗漏：注册表每个 id 都有对应单项榜
    const noMissing = registryIds.every((id) => boardIds.includes("skill:" + id));
    // 无多余：单项榜每个 skillId 都在注册表里
    const noExtra = skillIds.every((id) => registryIds.includes(id));
    ok("3a 每个 skillId 恰一个 boardId（无重复）", uniqueBoard && uniqueSkill);
    ok("3b 注册表无遗漏（每个 skillId 有单项榜）", noMissing);
    ok("3c 单项榜无多余（不臆造技能）", noExtra);
    // boardId 格式
    ok("3d boardId 均为 skill:<id> 格式", boardIds.every((b) => b.startsWith("skill:")));
  }

  // ---------- 4) 新增临时技能后，榜单数自动增加 ----------
  {
    const before = getLeaderboardDefinitions(st).length;
    const beforeSingle = getLeaderboardSnapshot(st).length;
    const st2 = baseState();
    st2.skills.temporaryNewSkill = { lvl: 7, xp: 999 }; // 临时新增技能
    const after = getLeaderboardDefinitions(st2).length;
    const afterSingle = getLeaderboardSnapshot(st2).length;
    ok("4a 新增技能后定义总数自动 +1", after === before + 1, "before=" + before + " after=" + after);
    ok("4b 新增技能后快照总数自动 +1", afterSingle === beforeSingle + 1, "before=" + beforeSingle + " after=" + afterSingle);
    const newDef = getLeaderboardDefinitions(st2).find((d) => d.skillId === "temporaryNewSkill");
    ok("4c 新技能生成单项榜 skill:temporaryNewSkill", !!newDef && newDef.boardId === "skill:temporaryNewSkill");
    const newEntry = getLeaderboardScore(st2, "skill:temporaryNewSkill");
    const newTotalXp = 999 + Array.from({ length: 6 }, (_, i) => Math.floor(100 * Math.pow(1.1, i + 1))).reduce((a, b) => a + b, 0);
    ok("4d 新技能榜读数正确", newEntry && newEntry.score === newTotalXp && newEntry.level === 7,
       "score=" + (newEntry && newEntry.score) + " lvl=" + (newEntry && newEntry.level));
  }

  // ---------- 5) 综合榜求和正确 ----------
  {
    const snap = getLeaderboardSnapshot(st);
    const byId = Object.fromEntries(snap.map((e) => [e.boardId, e]));

    // total = 全部技能 xp 总和
    const totalXp = Object.values(st.skills).reduce((s, v) => s + totalFor(v), 0);
    ok("5a total = 全部技能 xp 总和", byId["total"] && byId["total"].score === totalXp,
       "期望=" + totalXp + " 实际=" + (byId["total"] && byId["total"].score));
    const totalLevel = registry.reduce((s, r) => s + (Number.isFinite(Number(st.skills[r.id] && st.skills[r.id].lvl)) && Number(st.skills[r.id].lvl) > 0 ? Number(st.skills[r.id].lvl) : 0), 0);
    ok("5a-level total 等级 = 全部技能等级之和", byId["total"] && byId["total"].level === totalLevel,
       "期望=" + totalLevel + " 实际=" + (byId["total"] && byId["total"].level));

    // combat.total = 所有 category=combat 的技能 xp 求和（动态，不预设名称）
    const combatIds = registry.filter((r) => r.category === "combat").map((r) => r.id);
    const combatXp = combatIds.reduce((s, id) => s + totalFor(st.skills[id]), 0);
    const combatLevel = combatIds.reduce((s, id) => s + (Number(st.skills[id] && st.skills[id].lvl) || 0), 0);
    ok("5b combat.total = 战斗类技能 xp 求和（动态拆分）", byId["combat.total"] && byId["combat.total"].score === combatXp,
       "combatIds=" + combatIds.length + " 期望=" + combatXp + " 实际=" + (byId["combat.total"] && byId["combat.total"].score));
    ok("5b-level combat.total 等级 = 战斗技能等级之和", byId["combat.total"] && byId["combat.total"].level === combatLevel,
       "期望=" + combatLevel + " 实际=" + (byId["combat.total"] && byId["combat.total"].level));
    console.log("    战斗技能拆分清单（" + combatIds.length + " 项）: " + combatIds.join(", "));

    // production.total
    const prodIds = registry.filter((r) => r.category === "production").map((r) => r.id);
    const prodXp = prodIds.reduce((s, id) => s + totalFor(st.skills[id]), 0);
    ok("5c production.total = 生产类 xp 求和", byId["production.total"] && byId["production.total"].score === prodXp,
       "期望=" + prodXp + " 实际=" + (byId["production.total"] && byId["production.total"].score));

    // gathering.total
    const gatherIds = registry.filter((r) => r.category === "gathering").map((r) => r.id);
    const gatherXp = gatherIds.reduce((s, id) => s + totalFor(st.skills[id]), 0);
    ok("5d gathering.total = 采集类 xp 求和", byId["gathering.total"] && byId["gathering.total"].score === gatherXp,
       "期望=" + gatherXp + " 实际=" + (byId["gathering.total"] && byId["gathering.total"].score));

    // research.total
    ok("5e 不创建空的 research.total", !byId["research.total"]);

    // 综合榜之间无重叠计数核对：各项类彼此独立，total == 四类之和
    const sum4 = byId["combat.total"].score + byId["production.total"].score +
                 byId["gathering.total"].score;
    ok("5f 三类综合榜之和 == total", sum4 === byId["total"].score, "sum3=" + sum4 + " total=" + byId["total"].score);

    // 单项榜不替代综合榜：单项榜存在于快照，综合榜也存在
    ok("5g 单项榜与综合榜并存", snap.some((e) => e.boardId === "skill:mining") &&
                                 snap.some((e) => e.boardId === "total"));
  }

  // ---------- 6) 缺失技能不报错 ----------
  {
    const stMiss = baseState();
    delete stMiss.skills.mining;
    delete stMiss.skills.laserOps;
    delete stMiss.skills.archaeology;
    let threw = false;
    let snap = null;
    try { snap = getLeaderboardSnapshot(stMiss); } catch (e) { threw = true; }
    ok("6a 缺失技能调用不抛异常", !threw && Array.isArray(snap));
    const defsMiss = getLeaderboardDefinitions(stMiss);
    // 注册表随 state.skills 变化（缺失即不在注册表）
    const regMiss = getSkillRegistry(stMiss).map((r) => r.id);
    ok("6b 缺失技能不在注册表/单项榜中", !regMiss.includes("mining") && !regMiss.includes("laserOps"));
    // 综合榜仍基于现有技能正确求和（total 自动减少）
    const totalMissing = Object.values(stMiss.skills).reduce((s, v) => s + totalFor(v), 0);
    const totalEntry = getLeaderboardScore(stMiss, "total");
    ok("6c 缺失技能时 total 自动重算", totalEntry && totalEntry.score === totalMissing,
       "期望=" + totalMissing + " 实际=" + (totalEntry && totalEntry.score));
  }

  // ---------- 7) NaN / 负数经验归零 ----------
  {
    const stBad = baseState();
    stBad.skills.mining = { lvl: 3, xp: NaN };
    stBad.skills.refining = { lvl: 4, xp: -50 };
    stBad.skills.laserOps = { lvl: 3, xp: Infinity };
    stBad.skills.cannonOps = { lvl: 3, xp: "abc" };
    stBad.skills.missileOperations = { lvl: 3, xp: null };
    stBad.skills.gasHarvesting = { lvl: -2, xp: 50 }; // 负等级
    const mining = getLeaderboardScore(stBad, "skill:mining");
    const smelt = getLeaderboardScore(stBad, "skill:refining");
    const laser = getLeaderboardScore(stBad, "skill:laserOps");
    const cannon = getLeaderboardScore(stBad, "skill:cannonOps");
    const missile = getLeaderboardScore(stBad, "skill:missileOperations");
    const gas = getLeaderboardScore(stBad, "skill:gasHarvesting");
    ok("7a NaN/负数/Infinity/非数字/null xp 归零",
       mining.score === 231 && smelt.score === 364 && laser.score === 231 && cannon.score === 231 && missile.score === 231,
       `mining=${mining.score} smelt=${smelt.score} laser=${laser.score} cannon=${cannon.score} missile=${missile.score}`);
    ok("7b 负等级归零（lvl=-2 -> 0）", gas.level === 0 && gas.score === 50, "level=" + gas.level);
  }

  // ---------- 8) 调用前后 state 深比较完全一致（不写入）----------
  {
    const snapBefore = JSON.parse(JSON.stringify(st));
    const snap = getLeaderboardSnapshot(st);
    const after = JSON.parse(JSON.stringify(st));
    ok("8a 调用后 state 深比较一致", deepEqual(snapBefore, after), "snapshot长度=" + (snap ? snap.length : "null"));
    getLeaderboardScore(st, "total");
    getLeaderboardScore(st, "skill:mining");
    getLeaderboardScore(st, "combat.total");
    ok("8b 多次调用后 state 仍不变", deepEqual(snapBefore, JSON.parse(JSON.stringify(st))));
  }

  // ---------- 9) 不创建 timer ----------
  {
    let intervalCalled = 0, timeoutCalled = 0;
    const origSetInterval = global.setInterval;
    const origSetTimeout = global.setTimeout;
    global.setInterval = () => { intervalCalled++; return 0; };
    global.setTimeout = () => { timeoutCalled++; return 0; };
    try {
      getLeaderboardSnapshot(st);
      getLeaderboardDefinitions(st);
      getLeaderboardScore(st, "total");
    } finally {
      global.setInterval = origSetInterval;
      global.setTimeout = origSetTimeout;
    }
    ok("9 计算层不创建 timer（setInterval/setTimeout 调用次数=0）",
       intervalCalled === 0 && timeoutCalled === 0,
       "setInterval=" + intervalCalled + " setTimeout=" + timeoutCalled);
  }

  // ---------- 10) 不修改技能等级和经验 ----------
  {
    const before = JSON.parse(JSON.stringify(st.skills));
    getLeaderboardSnapshot(st);
    const after = st.skills;
    let unchanged = true;
    const changed = [];
    for (const id of Object.keys(before)) {
      if (!deepEqual(before[id], after[id])) { unchanged = false; changed.push(id); }
    }
    ok("10 计算层不修改任何技能等级/经验", unchanged, changed.join(","));
  }

  // ---------- 11) 不接平台 / 不改 UI（源码静态检查，排除注释）----------
  {
    const src = fs.readFileSync(path.join(process.cwd(), "js/data/leaderboard.js"), "utf8");
    // 逐行检查，跳过 // 注释；只查代码级平台/DOM 依赖
    const codeLines = src.split("\n").filter((l) => !/^\s*\/\//.test(l));
    const codeOnly = codeLines.join("\n");
    const platformHit = /taptap|steam|electron|window\.|document\.|localStorage|fetch\(|import\s+.*\.(css|html)/i.test(codeOnly);
    ok("11 模块代码层不含平台词/DOM 依赖（纯数据+纯函数）", !platformHit,
       platformHit ? "platform-or-dom-word" : "clean");
  }

  // ---------- 12) 未知 boardId 返回 null / updatedAt 透传 ----------
  {
    const e = getLeaderboardScore(st, "skill:mining");
    ok("12a updatedAt 透传 state.lastSavedAt", e.updatedAt === 1700000000000, "updatedAt=" + e.updatedAt);
    ok("12b platformGroup 固定 standard", e.platformGroup === "standard");
    const stNoTs = { skills: { mining: { lvl: 1, xp: 1 } } };
    ok("12c 无时间戳时 updatedAt=null（不自行生成）", getLeaderboardScore(stNoTs, "skill:mining").updatedAt === null);
    ok("12d 未知 boardId 返回 null", getLeaderboardScore(st, "doesNotExist") === null);
    ok("12e skill: 前缀但无对应技能返回 null", getLeaderboardScore(st, "skill:nonexistent") === null);
  }

  console.log("\n=== 标准服技能排行榜 第一阶段只读计算层测试（动态）: " + passCount + " PASS / " + failCount + " FAIL ===");
  process.exit(failCount ? 1 : 0);
}

main();
