// ============================================================================
//  tools/audit-research.mjs
//  研究系统审计 —— 批次 A：--data；批次 B：--state / --queue；批次 C：--settle
//
//  子命令：
//    --data            数据保真 / 31 组映射 / 图结构 / 迁移幂等 / 拒绝复利
//    --state           状态迁移契约 + 真实存档路径（importData / autoLoad）+
//                      planetary autoRenew 迁移 + index.html 脚本顺序
//    --queue           单槽科研队列（投影入队 / 真实等级启动 / guard / 坏格式矩阵）
//    --settle          在线/离线统一时间结算（批次 C）：纯逻辑（轻沙箱研究三文件）
//                      + 真实路径（全脚本沙箱 spy gameTick / calculateOfflineGains）
//    （组合任意；无参数 = 运行已实装的全部区域 data+state+queue+settle）
//    未知参数：EXIT=2（绝不静默当成功）
//
//  校验风格（全部为行为/结构真实断言，禁用弱断言 / assert(true) / 源码字符串
//  存在性伪测试 / 只验非空的宽泛检查）：
//    - --data / --queue / --settle(逻辑)：VM 轻沙箱直接运行研究三文件，无需 index.html。
//    - --state 真实路径项：按 index.html 实际 <script defer> 顺序全量加载
//      45 个脚本到 VM 沙箱（mock DOM/localStorage），对 SaveManager.importData
//      与 autoLoad 做真实调用观测（spy + 迁移效果双重证据）。
//    - --settle 真实路径项：同样全量加载 45 脚本，对 ResearchSystem.processResearchUntil
//      安装 spy，真实调用 gameTick / calculateOfflineGains 观测结算接线（每函数恰好一次）。
//    - 时间基准统一 FROZEN_NOW（冻结 Date.now），消除时序偶发。
//
//  退出码：全部通过 EXIT=0；任一断言失败 EXIT=1；未知参数 EXIT=2。
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// ---- 断言框架 ----
let passCount = 0;
let failCount = 0;
const failures = [];

// 确定性时钟基准（--state / --queue 共用；runData 内部有同值局部常量）
const FROZEN_NOW = 1700000000000;

function ok(cond, msg) {
  if (cond) {
    passCount += 1;
  } else {
    failCount += 1;
    failures.push(msg);
  }
}

function close(a, b, eps, msg) {
  ok(Math.abs(a - b) <= eps, `${msg}（期望≈${b}，实际=${a}，容差=${eps}）`);
}

function deepEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function setEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  for (const x of b) if (!a.has(x)) return false;
  return true;
}

async function runData() {
  // ---- 加载本批次两个新文件（VM 沙箱，无需 index.html） ----
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  // 确定性时钟：冻结 Date.now()，消除“两个真实 now() 完全相等”的偶发失败。
  // 不改生产代码语义（createDefaultResearchState 在浏览器仍使用真实 Date.now()）。
  const FROZEN_NOW = 1700000000000;
  class FrozenDate extends Date {
    static now() { return FROZEN_NOW; }
  }
  sandbox.Date = FrozenDate;
  sandbox.Math = Math;
  sandbox.JSON = JSON;
  sandbox.Object = Object;
  sandbox.Array = Array;
  sandbox.Set = Set;
  sandbox.Map = Map;
  sandbox.isFinite = isFinite;
  sandbox.document = {
    getElementById: () => null,
    addEventListener: () => {},
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  };
  vm.createContext(sandbox);

  const researchSrc = fs.readFileSync(path.join(root, "js/data/research.js"), "utf8");
  const stateSrc = fs.readFileSync(path.join(root, "js/core/research-state.js"), "utf8");
  vm.runInContext(researchSrc, sandbox, { filename: "js/data/research.js" });
  vm.runInContext(stateSrc, sandbox, { filename: "js/core/research-state.js" });

  const ResearchData = sandbox.ResearchData;
  const ResearchState = sandbox.ResearchState;
  ok(!!ResearchData, "ResearchData 必须被 VM 沙箱加载");
  ok(!!ResearchState, "ResearchState 必须被 VM 沙箱加载");
  if (!ResearchData || !ResearchState) return; // 后续断言无意义

  // ---- 加载冻结源（逐字段比对基准） ----
  let frozen;
  try {
    frozen = await import(pathToFileURL(path.join(root, "tools/research-tree-data.mjs")).href);
  } catch (e) {
    ok(false, "无法动态导入冻结源 tools/research-tree-data.mjs: " + e.message);
    return;
  }
  ok(!!frozen && Array.isArray(frozen.NODES), "冻结源 NODES 必须可用");

  // =========================================================================
  // 1. 数据保真
  // =========================================================================
  ok(ResearchData.NODES.length === 39, `移植 NODES 数量应为 39，实际 ${ResearchData.NODES.length}`);
  ok(frozen.NODES.length === 39, `冻结源 NODES 数量应为 39，实际 ${frozen.NODES.length}`);
  ok(deepEq(ResearchData.WEIGHTS, frozen.WEIGHTS), "WEIGHTS 必须与冻结源逐字段一致");
  ok(deepEq(ResearchData.RANK_MULT, frozen.RANK_MULT), "RANK_MULT 必须与冻结源逐字段一致");
  ok(ResearchData.TARGET_SECONDS === frozen.TARGET_SECONDS, "TARGET_SECONDS 必须与冻结源一致");
  close(ResearchData.UNIT, frozen.UNIT, 1e-9, "UNIT 必须与冻结源一致");
  ok(ResearchData.STEP_COUNT === frozen.STEP_COUNT && ResearchData.STEP_COUNT === 155, `STEP_COUNT 应为 155，实际 ${ResearchData.STEP_COUNT}`);

  const frozenById = new Map();
  for (const n of frozen.NODES) frozenById.set(n.id, n);

  const NODE_FIELDS = [
    "id", "name", "category", "era", "type", "maxLevel", "rank",
    "prerequisites", "effects", "bonus", "description",
  ];
  let fieldFails = 0;
  for (const n of ResearchData.NODES) {
    const f = frozenById.get(n.id);
    if (!f) {
      ok(false, `移植 NODES 含冻结源不存在的 id: ${n.id}`);
      fieldFails += 1;
      continue;
    }
    for (const k of NODE_FIELDS) {
      if (!deepEq(n[k], f[k])) {
        ok(false, `节点 ${n.id} 字段 ${k} 与冻结源不一致：` +
          `移植=${JSON.stringify(n[k])} 冻结=${JSON.stringify(f[k])}`);
        fieldFails += 1;
      }
    }
    // durationByLevel 由公式生成，必须逐元素与冻结源相等（证明未重算/漂移）
    if (!deepEq(n.durationByLevel, f.durationByLevel)) {
      ok(false, `节点 ${n.id} durationByLevel 与冻结源不一致`);
      fieldFails += 1;
    }
  }
  ok(fieldFails === 0, `全部节点字段须与冻结源逐字段一致（失败 ${fieldFails} 处）`);
  ok(ResearchData.NODES.every((n) => frozenById.has(n.id)), "移植 NODES 不得含冻结源之外的 id");

  // =========================================================================
  // 2. 32 组双向集合相等
  // =========================================================================
  const dataGroups = new Set();
  for (const n of ResearchData.NODES) {
    if (n.bonus && n.bonus.group) dataGroups.add(n.bonus.group);
  }
  const frozenGroups = new Set();
  for (const n of frozen.NODES) {
    if (n.bonus && n.bonus.group) frozenGroups.add(n.bonus.group);
  }
  const mappedGroups = new Set(Object.keys(ResearchData.RESEARCH_BONUS_CONSUMERS));

  ok(dataGroups.size === 32, `数据侧唯一 group 应为 32，实际 ${dataGroups.size}`);
  ok(mappedGroups.size === 32, `映射注册表 group 应为 32，实际 ${mappedGroups.size}`);
  ok(setEqual(dataGroups, mappedGroups), "数据 group 与映射 group 必须双向相等（无漏/无多/无拼写漂移）");
  ok(setEqual(dataGroups, frozenGroups), "数据 group 须与冻结源 group 集合一致");
  ok(setEqual(mappedGroups, frozenGroups), "映射 group 须与冻结源 group 集合一致");

  const missing = [...dataGroups].filter((g) => !mappedGroups.has(g));
  const extra = [...mappedGroups].filter((g) => !dataGroups.has(g));
  if (missing.length) ok(false, "映射漏项（数据有、映射无）: " + missing.join(","));
  if (extra.length) ok(false, "映射多项/幽灵键（映射有、数据无）: " + extra.join(","));

  // §6A 要求：合并展示行在机器可读映射中仍逐项列出
  for (const g of ["laserDmg", "missileDmg", "projDmg", "shield", "armor", "structure"]) {
    ok(mappedGroups.has(g), `映射注册表必须单独列出 ${g}（不得合并为幽灵键）`);
  }

  // =========================================================================
  // 2b. 消费点映射真实性 / 契约（防幽灵入口）
  //     每个 descriptor.target 必须是真实文件#函数（或 #段）标识，不得虚构。
  // =========================================================================
  // 已知幽灵入口（项目中不存在的符号）——一旦出现在映射中必须失败
  const GHOST_BAN = new Set([
    "systems.archaeologyBacklashDamage",
    "systems.archaeologyProbeCost",
    "systems.combatXp",
    "selectors.renewCost.fuel",
    "selectors.renewCost.isk",
  ]);
  // 真实消费入口白名单（文件#函数 标识，已逐一在代码中核实）；target 去掉 #段 后缀后比对
  const REAL_TARGET_BASES = new Set([
    "selectors.getProductionEfficiencyState",
    "production.getGasEfficiency",
    "selectors.getSmeltingDisplayState",
    "selectors.getEquipmentEngineeringDisplayState",
    "selectors.getBoosterManufacturingDisplayState",
    "selectors.getShipEngineeringSpeedBreakdown",
    "systems.resolveArchaeologyCycle",
    "systems.getArchaeologyDisplayState",
    "systems.computeArchaeologySuccessChance",
    "station.settleStationMaintenance",
    "selectors.getPlanetDeploymentDisplayState",
    "station.getStationBuildingSpeedMultiplier",
    "station.processAutoLines",
    "selectors.getPlanetOutputIntervalFromState",
    "station.addStationModifiedCombatXp",
    "production.addSkillXpToState",
    "offline.addOfflineSkillXp",
    "selectors.getCombatDamageMultiplierFromState",
    "selectors.getCombatMaxHpFromState",
    "selectors.getCombatRepairMultiplierFromState",
    "selectors.getReclaimRate",
  ]);
  const KIND_SET = new Set(["multiplier", "additivePp", "reduceFraction"]);

  let consumerFails = 0;
  const baseOf = (t) => String(t).split("#")[0];
  for (const [key, descs] of Object.entries(ResearchData.RESEARCH_BONUS_CONSUMERS)) {
    if (!Array.isArray(descs) || descs.length === 0) {
      ok(false, `消费点注册表 ${key} 必须非空数组`);
      consumerFails += 1;
      continue;
    }
    // 注册表 key 必须出现在自己的某个 descriptor.groups 中
    const selfRef = descs.some((d) => Array.isArray(d.groups) && d.groups.includes(key));
    if (!selfRef) {
      ok(false, `注册表 key ${key} 必须出现在自身某个 descriptor.groups 中`);
      consumerFails += 1;
    }
    for (const d of descs) {
      const t = d && d.target;
      if (typeof t !== "string" || t.length === 0) {
        ok(false, `消费点 ${key} 的 target 必须为非空字符串（实际 ${JSON.stringify(t)}）`);
        consumerFails += 1; continue;
      }
      if (GHOST_BAN.has(t)) {
        ok(false, `消费点 ${key} 使用了已知幽灵入口（禁止出现于 mapping）: ${t}`);
        consumerFails += 1; continue;
      }
      const base = baseOf(t);
      if (!REAL_TARGET_BASES.has(base)) {
        ok(false, `消费点 ${key} 的 target 基准不在真实白名单中（疑似幽灵/拼错入口）: ${t}（基准 ${base}）`);
        consumerFails += 1; continue;
      }
      if (!KIND_SET.has(d.kind)) {
        ok(false, `消费点 ${key} 的 kind 必须 ∈ {multiplier,additivePp,reduceFraction}（实际 ${d.kind}）`);
        consumerFails += 1; continue;
      }
      if (!Array.isArray(d.groups) || d.groups.length === 0) {
        ok(false, `消费点 ${key} 的 groups 必须非空数组`);
        consumerFails += 1; continue;
      }
      for (const g of d.groups) {
        if (!dataGroups.has(g)) {
          ok(false, `消费点 ${key} 的 group ${g} 不属于数据侧 group 集合`);
          consumerFails += 1;
        }
      }
    }
  }
  ok(consumerFails === 0, `消费点映射真实性校验（失败 ${consumerFails} 处）`);

  // =========================================================================
  // 2c. 关键消费链精确白名单断言（≥11 条）
  //     映射值被替换成幽灵入口时，本段必须失败；不只验证 31 个 key 集合。
  // =========================================================================
  const findTargets = (group) => {
    const out = [];
    for (const d of (ResearchData.RESEARCH_BONUS_CONSUMERS[group] || [])) out.push(d.target);
    return out;
  };
  const tHas = (group, t) => findTargets(group).includes(t);

  // 1) 在线/离线考古周期
  ok(tHas("archEff", "systems.resolveArchaeologyCycle"), "archEff 必须含在线周期入口 systems.resolveArchaeologyCycle");
  ok(tHas("archEff", "systems.resolveArchaeologyCycle#offline"), "archEff 必须含离线周期入口 systems.resolveArchaeologyCycle#offline");
  ok(tHas("archEff", "systems.getArchaeologyDisplayState"), "archEff 必须含显示态周期入口 systems.getArchaeologyDisplayState");
  // 2) 考古成功率
  ok(tHas("archSuccess", "systems.computeArchaeologySuccessChance"), "archSuccess 必须指向 systems.computeArchaeologySuccessChance");
  // 3) 反噬伤害
  ok(tHas("backlash", "systems.resolveArchaeologyCycle#backlash"), "backlash 必须指向 systems.resolveArchaeologyCycle#backlash");
  // 4) 探针扣除
  ok(tHas("probe", "systems.resolveArchaeologyCycle#probeSpend"), "probe 必须指向 systems.resolveArchaeologyCycle#probeSpend");
  // 5) 在线/离线考古经验
  ok(tHas("archExp", "production.addSkillXpToState"), "archExp 必须含在线经验入口 production.addSkillXpToState");
  ok(tHas("archExp", "offline.addOfflineSkillXp"), "archExp 必须含离线经验入口 offline.addOfflineSkillXp");
  // 6) 空间站维护燃料
  ok(tHas("fuel", "station.settleStationMaintenance"), "fuel 必须指向 station.settleStationMaintenance（空间站维护燃料）");
  // 7) 行星续费 ISK（与燃料严格区分）
  ok(tHas("planCost", "selectors.getPlanetDeploymentDisplayState"), "planCost 必须指向行星维护费 selectors.getPlanetDeploymentDisplayState（ISK）");
  ok(!tHas("planCost", "station.settleStationMaintenance"), "planCost 不得误用燃料入口（须与 station 燃料区分）");
  // 8) 战斗经验
  ok(tHas("combatExp", "station.addStationModifiedCombatXp"), "combatExp 必须指向 station.addStationModifiedCombatXp（真实战斗 XP 写入链）");
  // 9) 三类武器伤害
  for (const g of ["laserDmg", "missileDmg", "projDmg"]) {
    ok(tHas(g, "selectors.getCombatDamageMultiplierFromState"), `${g} 必须指向 selectors.getCombatDamageMultiplierFromState`);
  }
  // 10) 三层生命
  for (const g of ["shield", "armor", "structure"]) {
    ok(tHas(g, "selectors.getCombatMaxHpFromState"), `${g} 必须指向 selectors.getCombatMaxHpFromState`);
  }
  // 11) 主动维修
  ok(tHas("repair", "selectors.getCombatRepairMultiplierFromState"), "repair 必须指向 selectors.getCombatRepairMultiplierFromState");

  // =========================================================================
  // 3. 图结构校验
  // =========================================================================
  const ids = new Set(ResearchData.NODES.map((n) => n.id));
  ok(ids.size === ResearchData.NODES.length, `科技 ID 必须唯一（${ids.size} / ${ResearchData.NODES.length}）`);

  let graphFails = 0;
  const byId = new Map();
  for (const n of ResearchData.NODES) byId.set(n.id, n);

  for (const n of ResearchData.NODES) {
    if (n.maxLevel !== 1 && n.maxLevel !== 5) {
      ok(false, `节点 ${n.id} maxLevel 非法: ${n.maxLevel}（应为 1 或 5）`);
      graphFails += 1;
    }
    if ((n.type === "foundation" || n.type === "protocol") && n.maxLevel !== 1) {
      ok(false, `节点 ${n.id} 类型 ${n.type} 必须 maxLevel=1`);
      graphFails += 1;
    }
    for (const p of n.prerequisites) {
      if (!ids.has(p.id)) {
        ok(false, `节点 ${n.id} 前置 ${p.id} 不存在于 NODES`);
        graphFails += 1;
        continue;
      }
      const pn = byId.get(p.id);
      if (p.level < 1 || p.level > pn.maxLevel) {
        ok(false, `节点 ${n.id} 前置 ${p.id}@${p.level} 越界（须 1..${pn.maxLevel}）`);
        graphFails += 1;
      }
      if ((pn.type === "foundation" || pn.type === "protocol") && p.level !== 1) {
        ok(false, `节点 ${n.id} 前置 ${p.id}@${p.level} 为单级节点，level 必须为 1`);
        graphFails += 1;
      }
    }
  }
  ok(graphFails === 0, `层级/前置合法性校验（失败 ${graphFails} 处）`);

  // 无环（DFS 三色）
  const adj = new Map();
  for (const n of ResearchData.NODES) adj.set(n.id, n.prerequisites.map((p) => p.id));
  const color = new Map();
  let hasCycle = false;
  function dfs(u) {
    color.set(u, 1);
    for (const v of adj.get(u) || []) {
      if (color.get(v) === 1) { hasCycle = true; return; }
      if (!color.get(v)) dfs(v);
      if (hasCycle) return;
    }
    color.set(u, 2);
  }
  for (const n of ResearchData.NODES) {
    if (!color.get(n.id)) dfs(n.id);
    if (hasCycle) break;
  }
  ok(!hasCycle, "前置依赖图必须无环");

  // 全部可达（从无前置的根 BFS）
  const reachable = new Set();
  const queue = [];
  for (const n of ResearchData.NODES) {
    if (n.prerequisites.length === 0) {
      reachable.add(n.id);
      queue.push(n.id);
    }
  }
  while (queue.length) {
    const u = queue.shift();
    for (const n of ResearchData.NODES) {
      if (!reachable.has(n.id) && n.prerequisites.some((p) => p.id === u)) {
        reachable.add(n.id);
        queue.push(n.id);
      }
    }
  }
  ok(reachable.size === ResearchData.NODES.length,
    `全部节点须可达，实际可达 ${reachable.size}/${ResearchData.NODES.length}`);

  // =========================================================================
  // 4. 迁移幂等
  // =========================================================================
  const def = ResearchState.createDefaultResearchState();
  ok(def.schemaVersion === 1, "默认 schemaVersion=1");
  ok(def.completedLevels && typeof def.completedLevels === "object" && !Array.isArray(def.completedLevels), "默认 completedLevels 为对象");
  ok(Array.isArray(def.pendingQueue), "默认 pendingQueue 为数组");
  ok(typeof def.lastProcessedAt === "number" && isFinite(def.lastProcessedAt), "默认 lastProcessedAt 为有效数字");
  ok(def.protocolSettings && def.protocolSettings.intship && def.protocolSettings.intship.enabled === false,
    "默认 protocolSettings.intship 存在且 enabled=false");
  ok(def.protocolSettings.autoenh && def.protocolSettings.autoenh.maxAttempts === 0,
    "默认 protocolSettings.autoenh.maxAttempts=0");
  ok(def.protocolJobs && def.protocolJobs.intship === null, "默认 protocolJobs.intship=null");
  ok(!("lastResearchUpdate" in def), "默认状态不得含 lastResearchUpdate");

  // migrate 空 state
  const s1 = {};
  ResearchState.migrateResearchState(s1);
  ok(s1.research && s1.research.schemaVersion === 1, "migrate 空 state 应创建 research");
  ok(typeof s1.research.lastProcessedAt === "number", "migrate 空 state 应补 lastProcessedAt");
  ok(Array.isArray(s1.research.pendingQueue) && s1.research.protocolJobs.intship === null,
    "migrate 空 state 应补 pendingQueue / protocolJobs");

  // migrate 局部 state（保留既有 completedLevels）
  const s2 = { research: { completedLevels: { mine: 3 } } };
  ResearchState.migrateResearchState(s2);
  ok(s2.research.completedLevels.mine === 3, "migrate 应保留既有 completedLevels");
  ok(s2.research.protocolSettings && s2.research.protocolSettings.intship && s2.research.protocolSettings.intship.enabled === false,
    "migrate 应补 protocolSettings");
  ok(s2.research.protocolJobs && s2.research.protocolJobs.intship === null, "migrate 应补 protocolJobs");
  ok(s2.research.researchHourBank === 0, "migrate 应补 researchHourBank=0");

  // 遗留 lastResearchUpdate 必须被删除
  const s3 = { research: { lastResearchUpdate: 12345, completedLevels: {}, protocolSettings: {} } };
  ResearchState.migrateResearchState(s3);
  ok(!("lastResearchUpdate" in s3.research), "migrate 应删除遗留 lastResearchUpdate（防多锚点重复推进）");

  // 幂等：相同输入两次迁移结果一致
  const base = { research: { completedLevels: { mine: 2 }, protocolSettings: { intship: { enabled: true } } } };
  const a = JSON.parse(JSON.stringify(base));
  const b = JSON.parse(JSON.stringify(base));
  ResearchState.migrateResearchState(a);
  ResearchState.migrateResearchState(b);
  ok(JSON.stringify(a) === JSON.stringify(b), "migrate 幂等：相同输入两次迁移结果一致");

  // 幂等：同对象连续迁移结果一致
  const c = JSON.parse(JSON.stringify(base));
  ResearchState.migrateResearchState(c);
  const after1 = JSON.stringify(c);
  ResearchState.migrateResearchState(c);
  ok(JSON.stringify(c) === after1, "migrate 幂等：同对象连续两次迁移结果一致");

  // 完整合法状态不应被改写
  const s5 = ResearchState.createDefaultResearchState();
  s5.completedLevels = { laser: 5 };
  s5.protocolSettings.intship.enabled = true;
  const before5 = JSON.stringify(s5);
  ResearchState.migrateResearchState({ research: s5 });
  ok(JSON.stringify(s5) === before5, "migrate 完整合法状态不应改变已合法字段");

  // =========================================================================
  // 4b. 迁移契约：遗留字段层级 + techId 合法性（§3.1 第 8 条）
  // =========================================================================
  // 合法 activeResearch 带嵌套 lastResearchUpdate：保留对象，删除嵌套旧字段
  const sa = { research: { activeResearch: { techId: "mine", level: 1, lastResearchUpdate: 999 } } };
  ResearchState.migrateResearchState(sa);
  ok(sa.research.activeResearch !== null, "含合法 techId 的 activeResearch 应保留");
  ok(sa.research.activeResearch && sa.research.activeResearch.techId === "mine", "activeResearch.techId 应保留");
  ok(!("lastResearchUpdate" in sa.research.activeResearch), "activeResearch 嵌套 lastResearchUpdate 应被删除");

  // 非法 techId：清空为 null
  const sb = { research: { activeResearch: { techId: "ghost_tech_xyz", level: 1 } } };
  ResearchState.migrateResearchState(sb);
  ok(sb.research.activeResearch === null, "非法 techId 的 activeResearch 应清空为 null（§3.1 第 8 条）");

  // 顶层 + 嵌套旧锚点同时存在：迁移后均不存在
  const sc = { research: { lastResearchUpdate: 111, activeResearch: { techId: "mine", lastResearchUpdate: 222 } } };
  ResearchState.migrateResearchState(sc);
  ok(!("lastResearchUpdate" in sc.research), "research 顶层 lastResearchUpdate 应被删除（防多锚点）");
  ok(sc.research.activeResearch !== null, "合法 techId 的 activeResearch 应保留");
  ok(!("lastResearchUpdate" in sc.research.activeResearch), "activeResearch 嵌套 lastResearchUpdate 应被删除");

  // 连续迁移两次结果严格一致（activeResearch 路径）
  const sd = { research: { activeResearch: { techId: "mine", level: 3 } } };
  const d1 = JSON.parse(JSON.stringify(sd));
  const d2 = JSON.parse(JSON.stringify(sd));
  ResearchState.migrateResearchState(d1);
  ResearchState.migrateResearchState(d2);
  ok(JSON.stringify(d1) === JSON.stringify(d2), "连续两次迁移相同输入结果严格一致（activeResearch 路径）");

  // =========================================================================
  // 5. 加成函数拒绝复利
  // =========================================================================
  function fullState(map) {
    return { research: { completedLevels: Object.assign({}, map) } };
  }

  // 满级激光伤害：allWeapon + weaponDmg + laserDmg + tactical（纯加法 = 1.125）
  const laserFull = fullState({ dataan: 1, firectrl: 5, laser: 5, tactical: 5 });
  const mLaser = ResearchState.getResearchMultiplier(laserFull, ["allWeapon", "weaponDmg", "laserDmg", "tactical"]);
  close(mLaser, 1.125, 1e-9, "满级激光伤害乘子=1.125（纯加法）");
  const compoundedLaser = (1 + 0.02) * (1 + 0.03) * (1 + 0.06) * (1 + 0.015);
  ok(Math.abs(mLaser - compoundedLaser) > 1e-6,
    `激光乘子不得为复利连乘值 ${compoundedLaser.toFixed(6)}（实际 ${mLaser}）`);

  // 满级采矿：allMining + mining（纯加法 = 1.08）
  const mineFull = fullState({ syseng: 1, mine: 5 });
  const mMine = ResearchState.getResearchMultiplier(mineFull, ["allMining", "mining"]);
  close(mMine, 1.08, 1e-9, "满级采矿乘子=1.08（纯加法）");
  const compoundedMine = (1 + 0.02) * (1 + 0.06);
  ok(Math.abs(mMine - compoundedMine) > 1e-6,
    `采矿乘子不得为复利连乘值 ${compoundedMine.toFixed(6)}（实际 ${mMine}）`);

  // 部分等级抽查：采矿 L3（allMining 0.02 + mining 0.036 = 0.056 → 1.056）
  const mineL3 = fullState({ syseng: 1, mine: 3 });
  const mMine3 = ResearchState.getResearchMultiplier(mineL3, ["allMining", "mining"]);
  close(mMine3, 1.056, 1e-9, "采矿 L3 乘子=1.056（精确）");

  // combined == 各 group 加成之和（纯加法，非连乘）
  const comb = ResearchState.getResearchCombinedBonus(laserFull, ["allWeapon", "weaponDmg", "laserDmg", "tactical"]);
  const sumInd = ["allWeapon", "weaponDmg", "laserDmg", "tactical"].reduce(
    (s, g) => s + ResearchState.getResearchBonusValue(laserFull, g), 0,
  );
  close(comb, sumInd, 1e-12, "getResearchCombinedBonus 等于各 group 加成之和（纯加法）");
  close(comb, 0.125, 1e-12, "激光组合加成=0.125（2%+3%+6%+1.5%）");

  // pp 组返回分数（archSuccess 满级 = 3pp → 0.03）
  const sigFull = fullState({ signal: 5 });
  close(ResearchState.getResearchBonusValue(sigFull, "archSuccess"), 0.03, 1e-12,
    "archSuccess 满级=0.03（百分点/100 分数）");

  // 负号组返回正幅度分数（backlash 满级 = 6% → 0.06）
  const backFull = fullState({ backlash: 5 });
  close(ResearchState.getResearchBonusValue(backFull, "backlash"), 0.06, 1e-12,
    "backlash 满级幅度=0.06（分数，符号由消费方处理）");

  // 空状态乘子=1（无加成）
  const empty = fullState({});
  close(ResearchState.getResearchMultiplier(empty, ["allMining", "mining"]), 1, 1e-12, "空状态乘子=1");
  close(ResearchState.getResearchCombinedBonus(empty, ["allMining", "mining"]), 0, 1e-12, "空状态组合加成=0");

  // 多 group 混合（%、pp、负号共存）仍纯加法、不与任何单组连乘混淆
  const mixed = fullState({ syseng: 1, mine: 5, signal: 5 });
  const mixedComb = ResearchState.getResearchCombinedBonus(mixed, ["allMining", "mining", "archSuccess"]);
  // allMining 0.02 + mining 0.06 + archSuccess 0.03 = 0.11（不同 unit 仅数值相加，消费方各自解释）
  close(mixedComb, 0.11, 1e-12, "混合组（%、pp）组合加成=0.11（数值纯加法）");
}

// ============================================================================
//  轻沙箱：仅加载研究三文件（data/research.js + core/research-state.js +
//  systems/research.js），供 --state 迁移契约项与 --queue 全部行为项使用。
// ============================================================================
function buildResearchSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  class FrozenDate extends Date {
    static now() { return FROZEN_NOW; }
  }
  sandbox.Date = FrozenDate;
  sandbox.Math = Math;
  sandbox.JSON = JSON;
  sandbox.Object = Object;
  sandbox.Array = Array;
  sandbox.Number = Number;
  sandbox.Set = Set;
  sandbox.Map = Map;
  sandbox.isFinite = isFinite;
  vm.createContext(sandbox);
  for (const rel of ["js/data/research.js", "js/core/research-state.js", "js/systems/research.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), sandbox, { filename: rel });
  }
  return sandbox;
}

// ============================================================================
//  全脚本沙箱：按 index.html 真实 <script defer> 顺序加载全部脚本
//  （mock DOM / localStorage / 定时器），并在 persistence.js 执行前对
//  ResearchState.migrateResearchState 安装 spy —— 使 autoLoad / importData
//  的“真实路径调用迁移”成为可观测行为，而非源码字符串检查。
//  saveJson: null=无存档（新游戏路径）；字符串=localStorage 中的存档。
// ============================================================================
function buildFullGameSandbox(saveJson) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
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
    addEventListener: noop, appendChild: noop, classList, click: noop, closest: () => null,
    dataset: {}, focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
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
    window: null,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = noop;
  vm.createContext(sandbox);

  const migrateCalls = [];
  const timeline = []; // 真实调用时间线：{fn, deploymentsReady?, depCount?, autoRenewAfter?}
  let spyInstalled = false;
  for (const source of scriptSources) {
    const rel = source.replace(/^\.\//, "");
    // persistence.js 执行前安装 spy：记录 autoLoad / importData 的真实调用时间线
    // （calculateOfflineGains 由 offline.js 定义，注册顺序早于 persistence.js，可在此 wrap 全局绑定）
    if (!spyInstalled && rel === "js/core/persistence.js") {
      const RS = sandbox.ResearchState;
      let migrateSpied = false;
      if (RS && typeof RS.migrateResearchState === "function") {
        const real = RS.migrateResearchState;
        RS.migrateResearchState = function (state) {
          const deps = state && state.planetary && state.planetary.deployments;
          const evt = {
            fn: "migrateResearchState",
            deploymentsReady: Array.isArray(deps),
            depCount: Array.isArray(deps) ? deps.length : -1,
          };
          timeline.push(evt);
          migrateCalls.push(state);
          const out = real.call(this, state);
          evt.autoRenewAfter = Array.isArray(deps) &&
            deps.every((d) => d && d.autoRenew && typeof d.autoRenew.enabled === "boolean" && typeof d.autoRenew.minIskReserve === "number");
          return out;
        };
        migrateSpied = true;
      }
      let offlineSpied = false;
      if (typeof sandbox.calculateOfflineGains === "function") {
        const realOffline = sandbox.calculateOfflineGains;
        sandbox.calculateOfflineGains = function (...a) {
          timeline.push({ fn: "calculateOfflineGains" });
          return realOffline.apply(this, a);
        };
        offlineSpied = true;
      }
      spyInstalled = migrateSpied && offlineSpied;
    }
    vm.runInContext(fs.readFileSync(path.resolve(root, rel), "utf8"), sandbox, { filename: rel });
  }
  return { sandbox, migrateCalls, timeline, spyInstalled, scriptSources };
}

// ============================================================================
//  --state：迁移契约（含 planetary autoRenew）+ 真实存档路径 + 调用时间线 + 脚本顺序
//  （批次 B 返修：spy 时间线断言 migrateResearchState 严格早于 calculateOfflineGains）
// ============================================================================
async function runState() {
  const sb = buildResearchSandbox();
  const ResearchState = sb.ResearchState;
  ok(!!ResearchState, "[state] ResearchState 必须被 VM 沙箱加载");
  if (!ResearchState) return;

  // -- 1) 默认 schema 完整（逐字段结构断言，不是仅非空） --
  const def = ResearchState.createDefaultResearchState();
  ok(
    def.schemaVersion === 1 &&
    def.activeResearch === null &&
    def.researchHourBank === 0 &&
    Array.isArray(def.pendingQueue) && def.pendingQueue.length === 0 &&
    Array.isArray(def.history) && Array.isArray(def.notifications) &&
    typeof def.lastProcessedAt === "number" && isFinite(def.lastProcessedAt) &&
    def.protocolJobs && def.protocolJobs.intship === null &&
    !("lastResearchUpdate" in def),
    "[state] 默认 schema 逐字段完整（schemaVersion/activeResearch/queue/bank/anchor/jobs，无遗留锚点）",
  );
  const PROTO6 = ["intship", "autoenh", "planauto", "autosell", "autoconv", "autorepair"];
  ok(
    PROTO6.every((k) => def.protocolSettings && def.protocolSettings[k] && def.protocolSettings[k].enabled === false) &&
    def.protocolSettings.autoenh.maxAttempts === 0 &&
    Object.keys(def.protocolSettings).length === 6,
    "[state] 默认 protocolSettings 恰好 6 协议且全部 enabled=false（autoenh 带 maxAttempts=0）",
  );

  // -- 2) 缺 research：迁移创建完整默认子状态 --
  const s2 = { planetary: { deployments: [] } };
  ResearchState.migrateResearchState(s2);
  ok(
    s2.research && s2.research.schemaVersion === 1 && s2.research.activeResearch === null &&
    Array.isArray(s2.research.pendingQueue) && s2.research.protocolJobs.intship === null &&
    typeof s2.research.lastProcessedAt === "number",
    "[state] 缺 research 时迁移应创建完整默认子状态",
  );

  // -- 3) 局部 research：补齐缺失 + 保留既有合法值 --
  const s3 = {
    research: {
      completedLevels: { mine: 4, syseng: 1 },
      pendingQueue: ["mine@5"],
      protocolSettings: { intship: { enabled: true } },
    },
  };
  ResearchState.migrateResearchState(s3);
  ok(
    s3.research.completedLevels.mine === 4 && s3.research.completedLevels.syseng === 1 &&
    s3.research.pendingQueue.length === 1 && s3.research.pendingQueue[0] === "mine@5" &&
    s3.research.protocolSettings.intship.enabled === true,
    "[state] 局部迁移应保留既有 completedLevels / pendingQueue / 协议开关",
  );
  ok(
    PROTO6.every((k) => s3.research.protocolSettings[k] && typeof s3.research.protocolSettings[k].enabled === "boolean") &&
    s3.research.researchHourBank === 0 && s3.research.protocolJobs.intship === null &&
    typeof s3.research.lastProcessedAt === "number" && Array.isArray(s3.research.history),
    "[state] 局部迁移应补齐其余 5 协议 / bank / jobs / anchor / history",
  );

  // -- 4) 非法 activeResearch（幽灵 techId / 非对象）清空为 null --
  const s4a = { research: { activeResearch: { techId: "ghost_tech_xyz", targetLevel: 1 } } };
  const s4b = { research: { activeResearch: "corrupted-string" } };
  ResearchState.migrateResearchState(s4a);
  ResearchState.migrateResearchState(s4b);
  ok(s4a.research.activeResearch === null, "[state] 幽灵 techId 的 activeResearch 应清空为 null");
  ok(s4b.research.activeResearch === null, "[state] 非对象 activeResearch 应清空为 null");

  // -- 5) 顶层 + 嵌套 lastResearchUpdate 同时删除（单锚点契约） --
  const s5 = { research: { lastResearchUpdate: 111, activeResearch: { techId: "mine", targetLevel: 1, lastResearchUpdate: 222 } } };
  ResearchState.migrateResearchState(s5);
  ok(
    !("lastResearchUpdate" in s5.research) &&
    s5.research.activeResearch !== null &&
    !("lastResearchUpdate" in s5.research.activeResearch) &&
    typeof s5.research.lastProcessedAt === "number",
    "[state] 顶层与嵌套 lastResearchUpdate 均应删除，仅保留 lastProcessedAt 单锚点",
  );

  // -- 6) protocolSettings / protocolJobs 补全 + 保留；planauto 全局 minIskReserve 剥离 --
  const s6 = {
    research: {
      protocolSettings: {
        autoenh: { enabled: true, maxAttempts: 7 },
        planauto: { enabled: true, minIskReserve: 5000 },
      },
      protocolJobs: { intship: { blueprintId: "rifter", queued: 2 } },
    },
  };
  ResearchState.migrateResearchState(s6);
  ok(
    s6.research.protocolSettings.autoenh.enabled === true && s6.research.protocolSettings.autoenh.maxAttempts === 7 &&
    s6.research.protocolSettings.planauto.enabled === true &&
    !("minIskReserve" in s6.research.protocolSettings.planauto),
    "[state] 协议设置保留合法值；顶层 planauto 不得存全局 minIskReserve（每基地权威）",
  );
  ok(
    s6.research.protocolJobs.intship && s6.research.protocolJobs.intship.blueprintId === "rifter",
    "[state] 已有 protocolJobs.intship 任务对象应保留",
  );

  // -- 7) planetary autoRenew：缺失补默认 { enabled:false, minIskReserve:0 } --
  const s7 = {
    research: {},
    planetary: { deployments: [{ id: "planet_1", planetType: "barren" }, { id: "planet_2", planetType: "gas" }] },
  };
  ResearchState.migrateResearchState(s7);
  ok(
    s7.planetary.deployments.every((d) =>
      d.autoRenew && d.autoRenew.enabled === false && d.autoRenew.minIskReserve === 0),
    "[state] 每个 deployment 缺失 autoRenew 时应补默认 {enabled:false, minIskReserve:0}",
  );

  // -- 8) 多部署引用隔离：autoRenew 互为独立对象，改 A 不影响 B --
  ok(s7.planetary.deployments[0].autoRenew !== s7.planetary.deployments[1].autoRenew,
    "[state] 不同 deployment 的 autoRenew 必须是不同对象引用");
  s7.planetary.deployments[0].autoRenew.enabled = true;
  s7.planetary.deployments[0].autoRenew.minIskReserve = 999;
  ok(
    s7.planetary.deployments[1].autoRenew.enabled === false &&
    s7.planetary.deployments[1].autoRenew.minIskReserve === 0,
    "[state] 修改部署 A 的 autoRenew 不得影响部署 B（引用隔离）",
  );

  // -- 9) 非法 enabled / minIskReserve 规范化；合法值保留 --
  const s9 = {
    research: {},
    planetary: {
      deployments: [
        { id: "p1", planetType: "barren", autoRenew: { enabled: "yes", minIskReserve: -50 } },
        { id: "p2", planetType: "gas", autoRenew: { enabled: true, minIskReserve: 12345 } },
        { id: "p3", planetType: "ice", autoRenew: { enabled: 1, minIskReserve: NaN } },
      ],
    },
  };
  ResearchState.migrateResearchState(s9);
  ok(
    s9.planetary.deployments[0].autoRenew.enabled === false && s9.planetary.deployments[0].autoRenew.minIskReserve === 0 &&
    s9.planetary.deployments[2].autoRenew.enabled === false && s9.planetary.deployments[2].autoRenew.minIskReserve === 0,
    "[state] 非法 enabled(非布尔)/minIskReserve(负数/NaN) 应规范化为 false / 0",
  );
  ok(
    s9.planetary.deployments[1].autoRenew.enabled === true && s9.planetary.deployments[1].autoRenew.minIskReserve === 12345,
    "[state] 合法 autoRenew 值应逐字段保留",
  );

  // -- 10) 双迁移幂等（research + planetary 全字段 JSON 级一致） --
  const s10 = {
    research: { completedLevels: { mine: 2 }, protocolSettings: { planauto: { enabled: true, minIskReserve: 3 } } },
    planetary: { deployments: [{ id: "p1", planetType: "barren", autoRenew: { enabled: true, minIskReserve: 5 } }] },
  };
  ResearchState.migrateResearchState(s10);
  const once = JSON.stringify(s10);
  ResearchState.migrateResearchState(s10);
  ok(JSON.stringify(s10) === once, "[state] 同对象双迁移结果 JSON 级一致（research+planetary 幂等）");

  // ==========================================================================
  //  真实存档路径（全脚本沙箱）：11) importData  12) autoLoad  13) 新游戏无存档
  // ==========================================================================
  // 13 + 12：无存档 → autoLoad 新游戏路径不抛错，且真实调用了迁移
  let fresh = null;
  try {
    fresh = buildFullGameSandbox(null);
  } catch (e) {
    ok(false, "[state] 无存档加载全部 index.html 脚本抛出异常（新游戏路径必须无错）: " + (e && e.message));
  }
  if (fresh) {
    ok(fresh.spyInstalled, "[state] spy（migrate+offline）必须在 persistence.js 之前装上（脚本顺序保证依赖先加载）");
    ok(fresh.migrateCalls.length >= 1 && fresh.migrateCalls.some((s) => s === fresh.sandbox.gameState),
      "[state] autoLoad 新游戏路径必须真实调用 migrateResearchState(gameState)");
    // 时间线：新游戏 restored=false —— 迁移恰好一次（单一权威调用点），离线结算不被错误触发
    const freshLoadTimeline = fresh.timeline.slice();
    ok(
      freshLoadTimeline.filter((e) => e.fn === "migrateResearchState").length === 1,
      "[state][时间线] 新游戏 autoLoad：migrateResearchState 恰好调用 1 次（单一权威调用点）",
    );
    ok(
      freshLoadTimeline.filter((e) => e.fn === "calculateOfflineGains").length === 0,
      "[state][时间线] 新游戏 restored=false：calculateOfflineGains 不得被触发",
    );
    ok(
      freshLoadTimeline.every((e) => e.fn !== "migrateResearchState" || (e.deploymentsReady === true && e.autoRenewAfter === true)),
      "[state][时间线] 新游戏迁移执行时 planetary.deployments 已存在且迁移后 autoRenew 已补全",
    );
    ok(
      fresh.sandbox.gameState && fresh.sandbox.gameState.research &&
      fresh.sandbox.gameState.research.schemaVersion === 1 &&
      fresh.sandbox.gameState.research.activeResearch === null,
      "[state] 新游戏 gameState.research 初始化完整（state.js 构造 + autoLoad 迁移幂等）",
    );

    // 11) importData 真实路径：导入含遗留字段的存档 → 迁移被调用且生效
    const importSave = {
      skills: { mining: { lvl: 3, xp: 10 } },
      resources: { isk: 50000, fuel: 1000 },
      research: {
        completedLevels: { syseng: 1, mine: 2 },
        lastResearchUpdate: 987654321,
        activeResearch: { techId: "ghost_tech_xyz", targetLevel: 9 },
      },
      planetary: { deployments: [{ id: "planet_7", planetType: "barren", deployedAt: FROZEN_NOW - 1000, duration: 86400, storage: 0, progress: 0, lastTick: FROZEN_NOW - 1000, active: true }], nextId: 8 },
    };
    const callsBefore = fresh.migrateCalls.length;
    // importData 时间线：normalizePlanetaryState 定义于 persistence.js 内部，
    // 全脚本加载完成后 wrap 其全局绑定（importData 通过全局查找调用，wrap 真实生效）。
    if (typeof fresh.sandbox.normalizePlanetaryState === "function") {
      const realNorm = fresh.sandbox.normalizePlanetaryState;
      fresh.sandbox.normalizePlanetaryState = function (state, opts) {
        const out = realNorm.call(this, state, opts);
        fresh.timeline.push({
          fn: "normalizePlanetaryState",
          deploymentsAfter: !!(state && state.planetary && Array.isArray(state.planetary.deployments)),
        });
        return out;
      };
    }
    const tlBefore = fresh.timeline.length;
    let importOk = false;
    try {
      importOk = fresh.sandbox.SaveManager.importData(JSON.stringify(importSave));
    } catch (e) {
      ok(false, "[state] SaveManager.importData 抛出异常: " + (e && e.message));
    }
    ok(importOk === true, "[state] SaveManager.importData 必须返回 true（真实导入路径成功）");
    ok(fresh.migrateCalls.length > callsBefore, "[state] importData 真实路径必须调用 migrateResearchState");
    // 时间线：importData 内部顺序 normalizePlanetaryState → migrateResearchState → calculateOfflineGains
    const itl = fresh.timeline.slice(tlBefore);
    const iNorm = itl.findIndex((e) => e.fn === "normalizePlanetaryState");
    const iMig = itl.findIndex((e) => e.fn === "migrateResearchState");
    const iOff = itl.findIndex((e) => e.fn === "calculateOfflineGains");
    ok(iNorm >= 0 && iMig >= 0 && iOff >= 0 && iNorm < iMig && iMig < iOff,
      `[state][时间线] importData 顺序必须 normalize(${iNorm}) < migrate(${iMig}) < offline(${iOff})（真实调用观测）`);
    ok(iNorm >= 0 && itl[iNorm].deploymentsAfter === true,
      "[state][时间线] importData：normalizePlanetaryState 完成时 deployments 已生成");
    ok(iMig >= 0 && itl[iMig].deploymentsReady === true && itl[iMig].depCount >= 1 && itl[iMig].autoRenewAfter === true,
      "[state][时间线] importData：迁移执行时每个 deployment 已存在并被补上 autoRenew");
    const g = fresh.sandbox.gameState;
    ok(
      g.research && g.research.completedLevels && g.research.completedLevels.mine === 2 &&
      !("lastResearchUpdate" in g.research) && g.research.activeResearch === null,
      "[state] importData 后：completedLevels 保留、遗留锚点已删、幽灵 activeResearch 已清空（迁移生效证据）",
    );
    ok(
      Array.isArray(g.planetary.deployments) && g.planetary.deployments.length >= 1 &&
      g.planetary.deployments.every((d) => d.autoRenew && typeof d.autoRenew.enabled === "boolean" && typeof d.autoRenew.minIskReserve === "number"),
      "[state] importData 后：每个 planetary deployment 均已补 autoRenew（顺序保证 deployments 先于迁移存在）",
    );
  }

  // 12（存档恢复路径）：localStorage 有旧档 → autoLoad restored 分支调用迁移且生效
  const legacySave = {
    skills: { mining: { lvl: 2, xp: 5 } },
    resources: { isk: 20000, fuel: 500 },
    research: { completedLevels: { syseng: 1 }, lastResearchUpdate: 42 },
    planetary: { deployments: [{ id: "planet_3", planetType: "gas", deployedAt: FROZEN_NOW - 5000, duration: 86400, storage: 1, progress: 0, lastTick: FROZEN_NOW - 5000, active: true }], nextId: 4 },
  };
  let restoredRun = null;
  try {
    restoredRun = buildFullGameSandbox(JSON.stringify(legacySave));
  } catch (e) {
    ok(false, "[state] 携带旧存档加载全部脚本抛出异常（autoLoad 恢复路径必须无错）: " + (e && e.message));
  }
  if (restoredRun) {
    ok(restoredRun.migrateCalls.length >= 1 && restoredRun.migrateCalls.some((s) => s === restoredRun.sandbox.gameState),
      "[state] autoLoad 存档恢复路径必须真实调用 migrateResearchState(gameState)");
    // 时间线：restored autoLoad —— 第一次 migrateResearchState 严格早于第一次 calculateOfflineGains
    const rtl = restoredRun.timeline;
    const rMig = rtl.findIndex((e) => e.fn === "migrateResearchState");
    const rOff = rtl.findIndex((e) => e.fn === "calculateOfflineGains");
    ok(rMig >= 0 && rOff >= 0 && rMig < rOff,
      `[state][时间线] restored autoLoad：首次 migrateResearchState(idx=${rMig}) 必须严格早于首次 calculateOfflineGains(idx=${rOff})`);
    ok(rtl.filter((e) => e.fn === "migrateResearchState").length === 1,
      "[state][时间线] restored autoLoad：migrateResearchState 恰好 1 次（单一权威调用点，无重复迁移）");
    ok(rMig >= 0 && rtl[rMig].deploymentsReady === true && rtl[rMig].depCount >= 1 && rtl[rMig].autoRenewAfter === true,
      "[state][时间线] restored autoLoad：迁移执行时旧档 deployments 已由 normalizePlanetaryState 生成，autoRenew 补全");
    const rg = restoredRun.sandbox.gameState;
    ok(
      rg.research && rg.research.completedLevels && rg.research.completedLevels.syseng === 1 &&
      !("lastResearchUpdate" in rg.research) && rg.research.protocolJobs && rg.research.protocolJobs.intship === null,
      "[state] autoLoad 恢复后：旧档 research 已迁移（保留 completedLevels、删遗留锚点、补 jobs）",
    );
    ok(
      rg.planetary.deployments.every((d) => d.autoRenew && d.autoRenew.enabled === false && d.autoRenew.minIskReserve === 0),
      "[state] autoLoad 恢复后：旧档 deployment 已补默认 autoRenew",
    );
  }

  // -- 14) index.html 脚本注册顺序（真实结构断言） --
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const order = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)]
    .map((m) => m[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
  const iData = order.indexOf("js/data/research.js");
  const iRState = order.indexOf("js/core/research-state.js");
  const iState = order.indexOf("js/core/state.js");
  const iSystem = order.indexOf("js/systems/research.js");
  const iPersist = order.indexOf("js/core/persistence.js");
  ok(iData >= 0 && iRState >= 0 && iSystem >= 0, "[state] index.html 必须注册研究三文件");
  ok(iData >= 0 && iRState > iData && iState > iRState,
    `[state] 顺序必须 data/research.js(${iData}) < core/research-state.js(${iRState}) < core/state.js(${iState})`);
  ok(iSystem > iState && iPersist > iSystem,
    `[state] 顺序必须 core/state.js(${iState}) < systems/research.js(${iSystem}) < core/persistence.js(${iPersist})`);
}

// ============================================================================
//  --queue：单槽科研队列行为（18 项）
// ============================================================================
async function runQueue() {
  const sb = buildResearchSandbox();
  const RSys = sb.ResearchSystem;
  const RState = sb.ResearchState;
  const RData = sb.ResearchData;
  ok(!!RSys && !!RState && !!RData, "[queue] ResearchSystem/ResearchState/ResearchData 必须被 VM 沙箱加载");
  if (!RSys || !RState || !RData) return;

  function freshState(completed) {
    const st = { research: RState.createDefaultResearchState() };
    if (completed) st.research.completedLevels = Object.assign({}, completed);
    return st;
  }

  // -- 1) 同科技连续入队 I→II→III（前置已满足） --
  const q1 = freshState({ syseng: 1 });
  const r1a = RSys.enqueueResearch(q1, "mine", 1);
  const r1b = RSys.enqueueResearch(q1, "mine", 2);
  const r1c = RSys.enqueueResearch(q1, "mine", 3);
  ok(r1a.ok && r1b.ok && r1c.ok &&
    JSON.stringify(q1.research.pendingQueue) === JSON.stringify(["mine@1", "mine@2", "mine@3"]),
    "[queue] I→II→III 连续入队成功且 key 格式为 techId@targetLevel");

  // -- 2) 队列可满足跨科技前置（syseng@1 在队列中 → mine@1 可入队） --
  const q2 = freshState({});
  const r2a = RSys.enqueueResearch(q2, "syseng", 1);
  const r2b = RSys.enqueueResearch(q2, "mine", 1);
  ok(r2a.ok && r2b.ok, "[queue] 排队中的 syseng@1 应满足 mine@1 的前置（投影校验）");

  // -- 3) 倒序（先 III）拒绝且队列不变 --
  const q3 = freshState({ syseng: 1, mine: 1 });
  const before3 = JSON.stringify(q3.research.pendingQueue);
  const r3 = RSys.enqueueResearch(q3, "mine", 1); // 已完成等级
  ok(!r3.ok && r3.reason === "ALREADY_COMPLETED" && JSON.stringify(q3.research.pendingQueue) === before3,
    "[queue] 重复已完成等级拒绝 ALREADY_COMPLETED 且队列不变");

  // -- 4) 跳级拒绝且队列不变 --
  const q4 = freshState({ syseng: 1 });
  const r4 = RSys.enqueueResearch(q4, "mine", 3); // 当前 0，跳到 3
  ok(!r4.ok && r4.reason === "SKIP_LEVEL" && q4.research.pendingQueue.length === 0,
    "[queue] 跳级入队拒绝 SKIP_LEVEL 且队列不变");

  // -- 5) 与 activeResearch / 已排队重复的拒绝 --
  const q5 = freshState({ syseng: 1 });
  q5.research.activeResearch = { techId: "mine", targetLevel: 1, startedAt: FROZEN_NOW, baseDuration: 100, remainingSeconds: 100, appliedAchievementSeconds: 0 };
  const r5a = RSys.enqueueResearch(q5, "mine", 1);
  ok(!r5a.ok && r5a.reason === "ALREADY_ACTIVE", "[queue] 与 activeResearch 相同步骤拒绝 ALREADY_ACTIVE");
  const r5b = RSys.enqueueResearch(q5, "mine", 2);
  const r5c = RSys.enqueueResearch(q5, "mine", 2);
  ok(r5b.ok && !r5c.ok && r5c.reason === "ALREADY_QUEUED" && q5.research.pendingQueue.length === 1,
    "[queue] 已排队步骤重复入队拒绝 ALREADY_QUEUED 且不重复追加");

  // -- 6) 缺前置拒绝 --
  const q6 = freshState({});
  const r6 = RSys.enqueueResearch(q6, "mine", 1); // syseng 未完成也未排队
  ok(!r6.ok && r6.reason === "PREREQ_UNMET" && q6.research.pendingQueue.length === 0,
    "[queue] 缺前置拒绝 PREREQ_UNMET 且队列不变");

  // -- 7) 第 20 项可入队，第 21 项拒绝 QUEUE_FULL --
  const q7 = freshState({});
  const plan20 = [
    ["syseng", 1], ["matsci", 1], ["dataan", 1], ["autocon", 1],
    ["mine", 1], ["mine", 2], ["mine", 3], ["mine", 4], ["mine", 5],
    ["gas", 1], ["gas", 2], ["gas", 3], ["gas", 4], ["gas", 5],
    ["smelt", 1], ["smelt", 2], ["smelt", 3], ["smelt", 4], ["smelt", 5],
    ["arch", 1],
  ];
  let all20 = true;
  for (const [tid, lvl] of plan20) {
    const r = RSys.enqueueResearch(q7, tid, lvl);
    if (!r.ok) { all20 = false; ok(false, `[queue] 第 ${q7.research.pendingQueue.length + 1} 项 ${tid}@${lvl} 入队失败: ${r.reason}`); break; }
  }
  ok(all20 && q7.research.pendingQueue.length === 20, "[queue] 合法链前 20 项全部入队成功（容量恰好 20）");
  const r7 = RSys.enqueueResearch(q7, "signal", 1); // dataan 已在队列（投影满足），仅容量拒绝
  ok(!r7.ok && r7.reason === "QUEUE_FULL" && q7.research.pendingQueue.length === 20,
    "[queue] 第 21 项拒绝 QUEUE_FULL 且队列长度保持 20");

  // -- 8) 投影不修改输入 --
  const q8 = freshState({ syseng: 1 });
  q8.research.activeResearch = { techId: "mine", targetLevel: 2, startedAt: FROZEN_NOW, baseDuration: 100, remainingSeconds: 100, appliedAchievementSeconds: 0 };
  q8.research.completedLevels = { syseng: 1, mine: 1 };
  q8.research.pendingQueue = ["mine@3", "bad-key", "mine@5"];
  const snap8 = JSON.stringify(q8);
  const proj8 = RSys.buildProjectedResearchLevels(q8);
  ok(JSON.stringify(q8) === snap8, "[queue] buildProjectedResearchLevels 不得修改输入 state");
  ok(proj8 !== q8.research.completedLevels && proj8.mine === 3 && proj8.syseng === 1,
    "[queue] 投影返回新对象：active(mine@2)+队列(mine@3) 生效，坏 key 与跳级项(mine@5)被跳过");

  // -- 9) 旧档非法队列项不污染投影（后续项不得借非法项获得前置） --
  const q9 = freshState({});
  q9.research.pendingQueue = ["mine@1", "gas@1"]; // mine 缺 syseng；gas 缺 matsci
  const proj9 = RSys.buildProjectedResearchLevels(q9);
  ok(proj9.mine === undefined && proj9.gas === undefined,
    "[queue] 全部非法旧档项不得写入投影（防前置泄漏）");
  const r9 = RSys.enqueueResearch(q9, "smelt", 1);
  ok(!r9.ok && r9.reason === "PREREQ_UNMET", "[queue] 非法旧档项在场时 smelt@1 仍因缺 matsci 被拒绝");

  // -- 10) startNextFromQueue：队首非法移除后启动下一合法项 --
  const q10 = freshState({ syseng: 1 });
  q10.research.pendingQueue = ["mine@3", "mine@1"]; // 队首跳级非法（真实等级 0）
  const r10 = RSys.startNextFromQueue(q10, FROZEN_NOW);
  ok(r10.ok === true && r10.started === "mine@1" &&
    q10.research.activeResearch && q10.research.activeResearch.techId === "mine" && q10.research.activeResearch.targetLevel === 1 &&
    q10.research.pendingQueue.length === 0,
    "[queue] 队首非法项被移除，第二项合法启动并移出队列");

  // -- 11) 全部非法时安全停止：activeResearch 保持 null，队列被清理 --
  const q11 = freshState({});
  q11.research.pendingQueue = ["mine@1", "not-a-key", "gas@2", "mine@0", "ghost@1"];
  const r11 = RSys.startNextFromQueue(q11, FROZEN_NOW);
  ok(!r11.ok && r11.reason === "NO_LEGAL_STEP" && q11.research.activeResearch === null,
    "[queue] 全部非法时返回 NO_LEGAL_STEP 且不设置 activeResearch");
  ok(q11.research.pendingQueue.length === 0, "[queue] 非法项被移除（不留幽灵队列项）");

  // -- 12) guard：处理条数不超过初始队列长度（构造 shift 后仍非法的长队列） --
  const q12 = freshState({});
  q12.research.pendingQueue = Array.from({ length: 25 }, () => "mine@1"); // 全部缺前置
  const r12 = RSys.startNextFromQueue(q12, FROZEN_NOW);
  ok(!r12.ok && r12.reason === "NO_LEGAL_STEP" && q12.research.pendingQueue.length === 0,
    "[queue] guard 场景：25 项全非法被有限步清理后安全停止（无死循环/无递归）");

  // -- 13) startResearch 只认真实 completedLevels（队列满足的前置不算） --
  const q13 = freshState({});
  RSys.enqueueResearch(q13, "syseng", 1);
  const r13enq = RSys.enqueueResearch(q13, "mine", 1); // 投影允许入队
  const r13start = RSys.startResearch(q13, "mine", 1, FROZEN_NOW); // 真实等级 0 → 拒绝
  ok(r13enq.ok && !r13start.ok && r13start.reason === "PREREQ_UNMET" && q13.research.activeResearch === null,
    "[queue] startResearch 用真实 completedLevels 二次校验：投影可入队但不可直接开始");

  // -- 14) activeResearch 非空时 startResearch / startNextFromQueue 均拒绝且不覆盖 --
  const q14 = freshState({ syseng: 1, mine: 1 });
  const active14 = { techId: "mine", targetLevel: 2, startedAt: FROZEN_NOW, baseDuration: 100, remainingSeconds: 42, appliedAchievementSeconds: 0 };
  q14.research.activeResearch = active14;
  q14.research.pendingQueue = ["mine@3"];
  const r14a = RSys.startResearch(q14, "mine", 2, FROZEN_NOW);
  const r14b = RSys.startNextFromQueue(q14, FROZEN_NOW);
  ok(!r14a.ok && r14a.reason === "ALREADY_ACTIVE" && !r14b.ok && r14b.reason === "ALREADY_ACTIVE" &&
    q14.research.activeResearch === active14 && q14.research.activeResearch.remainingSeconds === 42 &&
    q14.research.pendingQueue.length === 1,
    "[queue] 单槽约束：activeResearch 非空时开始/队列启动均拒绝且对象与队列原样保留");

  // -- 15) baseDuration / remainingSeconds 与冻结源逐值一致 --
  let frozenQ;
  try {
    frozenQ = await import(pathToFileURL(path.join(root, "tools/research-tree-data.mjs")).href);
  } catch (e) {
    ok(false, "[queue] 无法导入冻结源比对时长: " + e.message);
  }
  if (frozenQ) {
    const q15 = freshState({ syseng: 1, mine: 2 });
    const r15 = RSys.startResearch(q15, "mine", 3, FROZEN_NOW);
    const frozenMine = frozenQ.NODES.find((n) => n.id === "mine");
    ok(r15.ok && q15.research.activeResearch.baseDuration === frozenMine.durationByLevel[2] &&
      q15.research.activeResearch.remainingSeconds === frozenMine.durationByLevel[2],
      "[queue] startResearch 的 baseDuration/remainingSeconds 必须等于冻结源 durationByLevel[L-1]");
    ok(RSys.getResearchDuration("mine", 3) === frozenMine.durationByLevel[2] &&
      RSys.getResearchDuration("mine", 0) === null && RSys.getResearchDuration("mine", 6) === null &&
      RSys.getResearchDuration("ghost", 1) === null,
      "[queue] getResearchDuration 边界：合法取冻结值，越界/幽灵返回 null");
  }

  // -- 16) activeResearch 结构严格：无 lastResearchUpdate，字段恰为 6 个 --
  const q16 = freshState({ syseng: 1 });
  const r16 = RSys.startResearch(q16, "mine", 1, FROZEN_NOW);
  const ar16 = q16.research.activeResearch;
  ok(r16.ok && ar16 && !("lastResearchUpdate" in ar16) && !("level" in ar16) &&
    JSON.stringify(Object.keys(ar16).sort()) === JSON.stringify(
      ["appliedAchievementSeconds", "baseDuration", "remainingSeconds", "startedAt", "targetLevel", "techId"]),
    "[queue] activeResearch 结构恰为 6 字段（targetLevel 而非 level；无 lastResearchUpdate）");
  ok(ar16.startedAt === FROZEN_NOW && ar16.appliedAchievementSeconds === 0,
    "[queue] startedAt=传入 now；appliedAchievementSeconds 初始为 0");

  // -- 17) 研究独立于 currentAction / 现有 queue --
  const q17 = freshState({ syseng: 1 });
  q17.currentAction = { active: true, skill: "mining", progress: 55 };
  q17.queue = { items: [{ type: "legacy" }], status: { isRunning: true, activeIndex: 0 } };
  const snapAction = JSON.stringify(q17.currentAction);
  const snapQueue = JSON.stringify(q17.queue);
  RSys.enqueueResearch(q17, "mine", 1);
  RSys.startNextFromQueue(q17, FROZEN_NOW);
  ok(JSON.stringify(q17.currentAction) === snapAction && JSON.stringify(q17.queue) === snapQueue &&
    q17.research.activeResearch && q17.research.activeResearch.techId === "mine",
    "[queue] 入队+启动全程不触碰 currentAction / gameState.queue（完全独立）");

  // -- 18) parseResearchStepKey 坏格式矩阵全拒绝 + 合法样本通过 --
  const badKeys = [
    null, undefined, 123, {}, [], "", "mine", "@", "mine@", "@1", "mine@1@2",
    "mine@1.5", "mine@NaN", "mine@Infinity", "mine@-1", "mine@0", "mine@6",
    "ghost@1", "MINE@1", " mine@1", "mine@ 1",
  ];
  let badPass = 0;
  for (const k of badKeys) {
    if (RSys.parseResearchStepKey(k) !== null) {
      badPass += 1;
      ok(false, `[queue] 坏格式 key 未被拒绝: ${JSON.stringify(k)}`);
    }
  }
  ok(badPass === 0, `[queue] 坏格式矩阵 ${badKeys.length} 项全部拒绝`);
  const good = RSys.parseResearchStepKey("mine@5");
  ok(good && good.techId === "mine" && good.targetLevel === 5,
    "[queue] 合法 key mine@5 解析为 {techId, targetLevel}");
  const goodMax1 = RSys.parseResearchStepKey("syseng@1");
  ok(goodMax1 && goodMax1.targetLevel === 1 && RSys.parseResearchStepKey("syseng@2") === null,
    "[queue] 单级节点 syseng@1 合法、syseng@2 越界拒绝");
}

// ---- 入口 ----
const KNOWN_FLAGS = new Set(["--data", "--state", "--queue", "--settle"]);
// ============================================================================
//  --settle：在线/离线统一时间结算（批次 C）
//   纯逻辑（轻沙箱：研究三文件）+ 真实路径（全脚本沙箱 spy gameTick /
//   calculateOfflineGains）。全部为真实行为断言，禁用弱断言。
//  覆盖：整步完成 / 幂等 / 时钟倒退 / 24h 唯一封顶 / 超额永久丢弃 / 虚拟游标
//   多步链式 / exact boundary / 空闲锚点推进 / 坏锚点 / 单锚点契约 / 协议不执行业务
//   / completedLevels 只增不降 / 浮点精度 / getResearchProgress 只读+夹紧 /
//   防递归 startResearch+startNextFromQueue / 真实 gameTick+离线路径 spy。
// ============================================================================
async function runSettle() {
  // ---------- 轻沙箱：研究三文件 ----------
  const sb = buildResearchSandbox();
  const ResearchSystem = sb.ResearchSystem;
  const ResearchState = sb.ResearchState;
  ok(!!ResearchSystem, "[settle] ResearchSystem 必须被加载");
  ok(!!ResearchState, "[settle] ResearchState 必须被加载");
  if (!ResearchSystem || !ResearchState) return;

  // 事件 spy：注入 GameEvents，观测每步 emit 次数与 payload 契约
  const emitCalls = [];
  sb.GameEvents = { emit: (evt, payload, meta) => { emitCalls.push({ evt, payload, meta }); } };

  const NOW = FROZEN_NOW; // 1700000000000（确定性）

  // 构造一个干净 research 子状态（不污染全局默认）
  function freshResearch(anchorMs) {
    const r = ResearchState.createDefaultResearchState();
    r.lastProcessedAt = (typeof anchorMs === "number") ? anchorMs : 0;
    r.completedLevels = {};
    r.history = [];
    r.pendingQueue = [];
    r.activeResearch = null;
    return r;
  }
  function setActive(r, techId, targetLevel, remaining, base, startedAt) {
    r.activeResearch = {
      techId, targetLevel,
      startedAt: (typeof startedAt === "number") ? startedAt : 0,
      baseDuration: (typeof base === "number") ? base : remaining,
      remainingSeconds: remaining,
      appliedAchievementSeconds: 0,
    };
  }

  // 1) 整步完成 + completedLevels 写入 + history + 事件每步一次
  {
    const r = freshResearch(0);
    setActive(r, "syseng", 1, 1365, 1365, 0); // foundation 节点，无前置，maxLevel=1，时长 1365
    const before = emitCalls.length;
    const res = ResearchSystem.processResearchUntil({ research: r }, NOW + 1365 * 1000);
    ok(res.ok && res.completedSteps === 1, "[settle] 整步完成后 completedSteps 应为 1");
    ok(r.completedLevels.syseng === 1, "[settle] 完成后 completedLevels.syseng 应为 1");
    ok(Array.isArray(r.history) && r.history.length === 1, "[settle] history 应追加 1 项");
    ok(r.history[0] && r.history[0].techId === "syseng" && r.history[0].level === 1,
       "[settle] history 项应含 techId/level");
    ok(r.activeResearch === null, "[settle] 完成后无队列时 activeResearch 应为 null");
    ok(emitCalls.length === before + 1, "[settle] 每步应恰好 emit 一次 stepCompleted 事件");
    ok(emitCalls[emitCalls.length - 1].evt === "research:stepCompleted" &&
       emitCalls[emitCalls.length - 1].payload.techId === "syseng" &&
       emitCalls[emitCalls.length - 1].payload.level === 1,
       "[settle] 事件 payload 契约应严格为 {techId,level}");
  }

  // 2) 相同 now 幂等（不重复推进）
  {
    const r = freshResearch(0);
    setActive(r, "syseng", 1, 2000, 2000, 0);
    const a = ResearchSystem.processResearchUntil({ research: r }, 1000);
    ok(a.completedSteps === 0 && Math.abs(r.activeResearch.remainingSeconds - 1999) < 1e-9,
       "[settle] 首次半步：completedSteps=0 且 remaining=1999");
    const b = ResearchSystem.processResearchUntil({ research: r }, 1000); // 相同 now
    ok(b.completedSteps === 0 && Math.abs(r.activeResearch.remainingSeconds - 1999) < 1e-9,
       "[settle] 相同 now 重复调用应幂等（remaining 不变、completedSteps=0）");
  }

  // 3) 时钟倒退：elapsed=0，锚点单调不倒退
  {
    const r = freshResearch(100000);
    setActive(r, "syseng", 1, 2000, 2000, 0);
    const res = ResearchSystem.processResearchUntil({ research: r }, 50000); // now < anchor
    ok(res.ok && r.lastProcessedAt === 100000,
       "[settle] 时钟倒退时 lastProcessedAt 应保持=100000（单调）");
    ok(Math.abs(r.activeResearch.remainingSeconds - 2000) < 1e-9, "[settle] 时钟倒退时 remaining 不变");
  }

  // 4) 24h 唯一封顶：超长 elapsed 只消耗 86400s，锚点推到 now（丢弃其余）
  {
    const r = freshResearch(0);
    setActive(r, "syseng", 1, 200000, 200000, 0); // 远大于 24h
    const HUGE = 1e15;
    const res = ResearchSystem.processResearchUntil({ research: r }, HUGE);
    ok(Math.abs(r.activeResearch.remainingSeconds - (200000 - 86400)) < 1e-6,
       "[settle] 超额时间只消耗 86400s（remaining=113600）");
    ok(r.lastProcessedAt === HUGE,
       "[settle] 锚点应推进到 now（丢弃计算值，非 oldAnchor+86400）");
  }

  // 5) 超额时间永久丢弃：后续调用不再补回被丢弃部分
  {
    const r = freshResearch(0);
    setActive(r, "syseng", 1, 172800, 172800, 0); // 恰好 2 天
    const HUGE = 3e15;
    ResearchSystem.processResearchUntil({ research: r }, HUGE); // 吃掉 1 天，剩 1 天，锚点=HUGE
    ok(Math.abs(r.activeResearch.remainingSeconds - 86400) < 1e-6, "[settle] 首次超额后 remaining=86400");
    const res2 = ResearchSystem.processResearchUntil({ research: r }, HUGE + 1000); // 仅过 1 秒
    ok(res2.completedSteps === 0 && Math.abs(r.activeResearch.remainingSeconds - (86400 - 1)) < 1e-6,
       "[settle] 丢弃部分永久消失：再过 1 秒只减 1s（remaining≈86399）");
  }

  // 6) 虚拟游标 cursorAt：多步离线连续完成，history.completedAt 用游标非登录 now
  {
    const mine1 = ResearchSystem.getResearchDuration("mine", 1);
    const mine2 = ResearchSystem.getResearchDuration("mine", 2);
    const r = freshResearch(0);
    setActive(r, "mine", 1, mine1, mine1, 0);
    r.completedLevels = { syseng: 1 }; // mine@1 前置 syseng@1 已满足
    r.pendingQueue = ["mine@2"];       // mine@2 前置 mine@1（刚完成）
    const before6 = emitCalls.length;
    const total = (mine1 + mine2) * 1000;
    const res = ResearchSystem.processResearchUntil({ research: r }, total);
    ok(res.completedSteps === 2, "[settle] 虚拟游标应连续完成 2 步（completedSteps=2）");
    ok(r.completedLevels.mine === 2, "[settle] 链式完成后 completedLevels.mine=2");
    ok(r.activeResearch === null, "[settle] 队列排空后 activeResearch=null");
    ok(r.history.length === 2, "[settle] history 应有 2 项");
    ok(Math.abs(r.history[0].completedAt - mine1 * 1000) < 1e-6,
       "[settle] 第1步 completedAt 应为虚拟游标 mine1*1000");
    ok(Math.abs(r.history[1].completedAt - (mine1 + mine2) * 1000) < 1e-6,
       "[settle] 第2步 completedAt 应为虚拟游标 (mine1+mine2)*1000");
    // A. 多步事件精确性：进入用例前记录 beforeCount，完成后精确 == before+2，
    //    并精确校验两个新事件的 techId/level 与 metadata.timestamp（== 各自 history.completedAt）
    ok(emitCalls.length === before6 + 2,
       "[settle][A] 多步用例应精确产生 2 个新事件（before+2），禁止用 >=2 蒙混");
    const e1 = emitCalls[emitCalls.length - 2];
    const e2 = emitCalls[emitCalls.length - 1];
    ok(e1.evt === "research:stepCompleted" && e1.payload.techId === "mine" && e1.payload.level === 1,
       "[settle][A] 第1个新事件 payload 应为 mine@1");
    ok(e2.evt === "research:stepCompleted" && e2.payload.techId === "mine" && e2.payload.level === 2,
       "[settle][A] 第2个新事件 payload 应为 mine@2");
    ok(e1.meta && typeof e1.meta === "object" && Number.isFinite(Number(e1.meta.timestamp)) &&
       Math.abs(Number(e1.meta.timestamp) - r.history[0].completedAt) < 1e-6,
       "[settle][A] 第1事件 timestamp 应 == history[0].completedAt（虚拟游标 mine1*1000）");
    ok(e2.meta && typeof e2.meta === "object" && Number.isFinite(Number(e2.meta.timestamp)) &&
       Math.abs(Number(e2.meta.timestamp) - r.history[1].completedAt) < 1e-6,
       "[settle][A] 第2事件 timestamp 应 == history[1].completedAt（虚拟游标 (mine1+mine2)*1000）");
  }

  // 7) exact boundary：elapsed === remaining 立即完成该步
  {
    const r = freshResearch(0);
    setActive(r, "syseng", 1, 1000, 1000, 0);
    const res = ResearchSystem.processResearchUntil({ research: r }, 1000 * 1000); // 1000s 恰好
    ok(res.completedSteps === 1 && r.activeResearch === null,
       "[settle] exact boundary：elapsed==remaining 应完成该步");
  }

  // 8) activeResearch=null 也推进锚点（不积攒空闲时间）
  {
    const r = freshResearch(100);
    const res = ResearchSystem.processResearchUntil({ research: r }, 500);
    ok(res.completedSteps === 0 && r.lastProcessedAt === 500,
       "[settle] 无 active 时仍推进锚点到 now（lastProcessedAt=500）");
  }

  // 9) 坏锚点防御：非数字锚点 → 直接推进到 now，不白给 elapsed
  {
    const r = freshResearch(NaN);
    const res = ResearchSystem.processResearchUntil({ research: r }, 777);
    ok(res.ok && res.completedSteps === 0 && r.lastProcessedAt === 777,
       "[settle] 坏锚点应安全推进到 now 且不结算");
  }

  // 10) 单锚点契约：结算全程不引入 lastResearchUpdate
  {
    const r = freshResearch(0);
    setActive(r, "syseng", 1, 1365, 1365, 0);
    ResearchSystem.processResearchUntil({ research: r }, 1365 * 1000);
    ok(!("lastResearchUpdate" in r), "[settle] 结算后不得出现 lastResearchUpdate（单锚点契约）");
  }

  // 11) 协议节点完成仅写 completedLevels，不执行业务（不自动 enabled）
  {
    const r = freshResearch(0);
    setActive(r, "intship", 1, 1, 1, 0); // 协议节点，直接构造 active；completeResearchStep 不校验前置
    const res = ResearchSystem.processResearchUntil({ research: r }, 1000);
    ok(res.completedSteps === 1 && r.completedLevels.intship === 1,
       "[settle] 协议完成应写 completedLevels.intship=1");
    ok(r.activeResearch === null, "[settle] 协议完成后 activeResearch=null");
    ok(r.protocolSettings && r.protocolSettings.intship && r.protocolSettings.intship.enabled === false,
       "[settle] 协议完成不得自动 enabled（不执行业务）");
  }

  // 12) completedLevels 只增不降
  {
    const r = freshResearch(0);
    r.completedLevels = { mine: 3 };
    setActive(r, "mine", 1, 1365, 1365, 0); // 低等级完成不得覆盖高等级
    ResearchSystem.processResearchUntil({ research: r }, 1365 * 1000);
    ok(r.completedLevels.mine === 3, "[settle] completedLevels 只增不降（保留 3）");
  }

  // 13) 浮点精度保留（不整数化 remaining）
  {
    const r = freshResearch(0);
    setActive(r, "syseng", 1, 1000.5, 1000.5, 0);
    ResearchSystem.processResearchUntil({ research: r }, 1000); // 仅推进 1 秒，remaining=999.5，不取整
    ok(r.activeResearch.remainingSeconds === 999.5,
       "[settle] remaining 应保留浮点精度（1000.5→999.5，不取整）");
  }

  // 14) getResearchProgress：无 active 稳定形态
  {
    const r = freshResearch(0);
    const p = ResearchSystem.getResearchProgress({ research: r });
    ok(p.active === false && p.ratio === 1,
       "[settle] getResearchProgress 无 active 应返回 {active:false,ratio:1}");
  }

  // 15) getResearchProgress：有 active 且只读（不修改 state）
  {
    const r = freshResearch(0);
    setActive(r, "syseng", 1, 1000, 2000, 0); // remaining=1000, base=2000 → ratio 0.5
    const p = ResearchSystem.getResearchProgress({ research: r });
    ok(p.active === true && Math.abs(p.ratio - 0.5) < 1e-9,
       "[settle] 有 active 时 ratio=1-remaining/base=0.5");
    ok(p.techId === "syseng" && p.targetLevel === 1 && p.baseDuration === 2000 &&
       p.remainingSeconds === 1000 && p.appliedAchievementSeconds === 0,
       "[settle] 进度字段应完整");
    ok(r.activeResearch.remainingSeconds === 1000,
       "[settle] getResearchProgress 不得修改 state（remaining 不变）");
  }

  // 16) getResearchProgress：ratio 夹紧 [0,1]
  {
    const r = freshResearch(0);
    setActive(r, "syseng", 1, -500, 2000, 0); // remaining 负 → ratio>1 → 夹 1
    const p1 = ResearchSystem.getResearchProgress({ research: r });
    ok(p1.ratio === 1, "[settle] ratio 超过 1 应夹紧为 1");
    setActive(r, "syseng", 1, 3000, 2000, 0); // remaining>base → ratio<0 → 夹 0
    const p2 = ResearchSystem.getResearchProgress({ research: r });
    ok(p2.ratio === 0, "[settle] ratio 低于 0 应夹紧为 0");
  }

  // 17) 防递归：公共 startResearch 先结算再启动，内部不得无限递归
  {
    const r = freshResearch(0);
    const res = ResearchSystem.startResearch({ research: r }, "syseng", 1, NOW);
    ok(res.ok && res.activeResearch && res.activeResearch.techId === "syseng",
       "[settle] startResearch 应先结算后启动（无递归崩溃）并返回 ok");
    ok(r.lastProcessedAt === NOW, "[settle] startResearch 内部结算应将锚点推进到 now");
    ok(r.activeResearch !== null && r.activeResearch.techId === "syseng",
       "[settle] 启动后应占用槽位");
  }

  // 18) 防递归：startNextFromQueue 使用私有原语，不回调公共入口
  {
    const r = freshResearch(0);
    r.pendingQueue = ["syseng@1"];
    const res = ResearchSystem.startNextFromQueue({ research: r }, NOW);
    ok(res.ok && r.activeResearch && r.activeResearch.techId === "syseng",
       "[settle] startNextFromQueue 应启动队首（无递归）");
  }

  // 19) 队列合法项自动衔接：完成后从队列接下一项（startedAt=游标）
  {
    const mine1 = ResearchSystem.getResearchDuration("mine", 1);
    const r = freshResearch(0);
    setActive(r, "mine", 1, mine1, mine1, 0);
    r.completedLevels = { syseng: 1 };
    r.pendingQueue = ["mine@2"];
    ResearchSystem.processResearchUntil({ research: r }, mine1 * 1000 + 1); // 完成 mine@1 并衔接
    ok(r.activeResearch && r.activeResearch.techId === "mine" && r.activeResearch.targetLevel === 2,
       "[settle] 完成后应自动衔接队列下一项 mine@2");
    ok(r.activeResearch.startedAt === mine1 * 1000,
       "[settle] 衔接项 startedAt 应为虚拟游标 mine1*1000");
  }

  // ============ 新增审计：脏标记（二）+ B/C/D/H/I（轻沙箱） ============
  // 辅助：构造带 _dirty 标记的 state 包装（markResearchDirty 写 state._dirty）
  function makeState(research) { return { research, _dirty: false }; }
  const mineD1 = ResearchSystem.getResearchDuration("mine", 1);
  const mineD2 = ResearchSystem.getResearchDuration("mine", 2);

  // --- 二、脏标记：所有成功状态变更必须置 _dirty=true ---
  // D1: 初始 false
  {
    const st = makeState(freshResearch(0));
    ok(st._dirty === false, "[settle][dirty] state._dirty 初始应为 false");
  }
  // D2: 在线推进 1 秒（实际减少 remainingSeconds）→ true
  {
    const r = freshResearch(NOW - 1000);
    setActive(r, "syseng", 1, 2000, 2000, NOW - 1000);
    const st = makeState(r);
    ResearchSystem.processResearchUntil(st, NOW); // 推进 1s
    ok(st._dirty === true, "[settle][dirty] 在线推进 1 秒（实际减少 remaining）后 _dirty 应为 true");
    ok(Math.abs(r.activeResearch.remainingSeconds - 1999) < 1e-6,
       "[settle][dirty] 推进后 remaining 应为 1999");
  }
  // D3: 完成步骤 → true
  {
    const r = freshResearch(NOW);
    setActive(r, "syseng", 1, 10, 1365, NOW);
    const st = makeState(r);
    ResearchSystem.processResearchUntil(st, NOW + 100000); // 远超步长 → 完成
    ok(st._dirty === true, "[settle][dirty] 完成步骤后 _dirty 应为 true");
    ok(r.completedLevels.syseng === 1, "[settle][dirty] 步骤应已完成");
  }
  // D4: 入队成功 → true
  {
    const r = freshResearch(0);
    const st = makeState(r);
    const res = ResearchSystem.enqueueResearch(st, "syseng", 1);
    ok(res.ok === true && st._dirty === true,
       "[settle][dirty] 入队成功后 _dirty 应为 true");
  }
  // D5: 启动成功 → true
  {
    const r = freshResearch(0);
    const st = makeState(r);
    const res = ResearchSystem.startResearch(st, "syseng", 1, NOW);
    ok(res.ok === true && st._dirty === true,
       "[settle][dirty] 启动成功后 _dirty 应为 true");
  }
  // D6: 失败且无 mutation → 保持 false
  {
    const r = freshResearch(0);
    const st = makeState(r);
    const res = ResearchSystem.enqueueResearch(st, "mine", 2); // 缺前置 → 失败
    ok(res.ok === false && st._dirty === false,
       "[settle][dirty] 失败且无 mutation 时 _dirty 应保持 false");
  }
  // D7: getResearchProgress 后保持 false（只读）
  {
    const r = freshResearch(0);
    setActive(r, "syseng", 1, 1000, 2000, 0);
    const st = makeState(r);
    ResearchSystem.getResearchProgress(st);
    ok(st._dirty === false, "[settle][dirty] getResearchProgress 不得置 _dirty");
  }
  // D8: 无 active 仅推进空闲锚点 → 不强制 dirty
  {
    const r = freshResearch(NOW - 1000);
    const st = makeState(r);
    ResearchSystem.processResearchUntil(st, NOW); // activeResearch=null → 仅推进锚点
    ok(st._dirty === false,
       "[settle][dirty] 无 active 仅推进空闲锚点时不强制 _dirty（避免每 tick 自动保存）");
    ok(r.lastProcessedAt === NOW, "[settle][dirty] 空闲锚点仍应推进到 now");
  }

  // --- B. 空槽但队列非空：普通时间推进不得擅自启动队列 ---
  {
    const r = freshResearch(NOW - 1000);
    r.activeResearch = null;
    r.pendingQueue = ["syseng@1"];
    const before = emitCalls.filter((e) => e.evt === "research:stepCompleted").length;
    const beforeHist = r.history.length;
    const beforeQ = r.pendingQueue.slice();
    const res = ResearchSystem.processResearchUntil({ research: r }, NOW);
    ok(res.completedSteps === 0, "[settle][B] 空槽+非空队列：不得完成任何步骤");
    ok(r.activeResearch === null, "[settle][B] 空槽+非空队列：activeResearch 应仍为 null（不擅自启动）");
    ok(JSON.stringify(r.pendingQueue) === JSON.stringify(beforeQ),
       "[settle][B] 空槽+非空队列：pendingQueue 应原样不变");
    ok(r.lastProcessedAt === NOW, "[settle][B] 空槽+非空队列：lastProcessedAt 应推进到 now");
    ok(emitCalls.filter((e) => e.evt === "research:stepCompleted").length === before,
       "[settle][B] 空槽+非空队列：不得产生完成事件");
    ok(r.history.length === beforeHist, "[settle][B] 空槽+非空队列：不得追加 history");
  }

  // --- C. 队列为空、最后一步提前完成且仍有剩余 elapsed ---
  {
    const r = freshResearch(NOW);
    setActive(r, "syseng", 1, 10, 10, NOW); // 10s 步，队列空
    r.pendingQueue = [];
    const before = emitCalls.filter((e) => e.evt === "research:stepCompleted").length;
    const res = ResearchSystem.processResearchUntil({ research: r }, NOW + 100 * 1000); // 100s 远超
    ok(res.completedSteps === 1, "[settle][C] 最后一步应只完成一次");
    ok(r.activeResearch === null, "[settle][C] 完成后 activeResearch 应为 null");
    ok(r.lastProcessedAt === NOW + 100 * 1000,
       "[settle][C] 剩余 elapsed 不存任何字段：lastProcessedAt 直接等于 now");
    ok(emitCalls.filter((e) => e.evt === "research:stepCompleted").length === before + 1,
       "[settle][C] 仅产生 1 个完成事件");
    // 重复相同 now：不再产生事件/history
    const histLen = r.history.length;
    const res2 = ResearchSystem.processResearchUntil({ research: r }, NOW + 100 * 1000);
    ok(res2.completedSteps === 0 && r.history.length === histLen,
       "[settle][C] 重复相同 now 不再产生事件/history");
    // 后续新开步骤不得获得此前剩余 elapsed（C 用例里 100s elapsed 用完 10s 步后剩 90s，应永久丢弃）
    const r2 = freshResearch(NOW + 100 * 1000); // 锚点=过量 now，模拟时间已推进到当时
    r2.completedLevels = { syseng: 1 };
    r2.pendingQueue = [];
    r2.activeResearch = null;
    const st2 = makeState(r2);
    // 在 NOW+100000+1 启动全新步骤：processResearchUntil 仅把锚点推 1ms，不消费任何"历史剩余"，
    // 新步骤拿到满时长（若 90s 余量被错误继承，remaining 会 < mineD1）。
    const res3 = ResearchSystem.startResearch(st2, "mine", 1, NOW + 100 * 1000 + 1);
    ok(res3.ok === true && r2.activeResearch && Math.abs(r2.activeResearch.remainingSeconds - mineD1) < 1e-6,
       "[settle][C] 新开步骤 remaining 应为满时长（不吃此前剩余 elapsed，90s 余量已丢弃）");
  }

  // --- D. public startResearch 先结算旧步骤（D-a 队列空 / D-b 队列有合法下一项） ---
  // D-a: 队列为空
  {
    const r = freshResearch(NOW);
    r.completedLevels = { syseng: 1 };
    setActive(r, "mine", 1, 10, mineD1, NOW); // 旧步骤即将在 now 前自然完成
    r.pendingQueue = [];
    const before = emitCalls.filter((e) => e.evt === "research:stepCompleted").length;
    const st = makeState(r);
    const res = ResearchSystem.startResearch(st, "mine", 2, NOW + 100 * 1000);
    ok(res.ok === true, "[settle][D-a] 队列空：旧步骤先完成，新合法步骤才可启动");
    ok(r.completedLevels.mine === 1, "[settle][D-a] 旧步骤 mine@1 应先完成");
    ok(r.activeResearch && r.activeResearch.techId === "mine" && r.activeResearch.targetLevel === 2,
       "[settle][D-a] 新启动应为请求的步骤 mine@2");
    ok(emitCalls.filter((e) => e.evt === "research:stepCompleted").length === before + 1,
       "[settle][D-a] 事件只对应旧步骤，不对应刚启动步骤");
    const ev = emitCalls[emitCalls.length - 1];
    ok(ev.payload.techId === "mine" && ev.payload.level === 1,
       "[settle][D-a] 产生事件应为旧步骤 mine@1");
    ok(r.lastProcessedAt === NOW + 100 * 1000, "[settle][D-a] lastProcessedAt 应=now");
  }
  // D-b: 队列有合法下一项
  {
    const r = freshResearch(NOW);
    r.completedLevels = { syseng: 1 };
    setActive(r, "mine", 1, 10, mineD1, NOW); // 旧步骤
    r.pendingQueue = ["mine@2"];              // 合法下一项
    const before = emitCalls.filter((e) => e.evt === "research:stepCompleted").length;
    const st = makeState(r);
    const res = ResearchSystem.startResearch(st, "mine", 3, NOW + 100 * 1000);
    ok(res.ok === false && res.reason === "ALREADY_ACTIVE",
       "[settle][D-b] 队列有下一项：旧步骤完成后队列项先被自动启动，公共入口返回 ALREADY_ACTIVE");
    ok(r.completedLevels.mine === 1, "[settle][D-b] 旧步骤 mine@1 应先完成");
    ok(r.activeResearch && r.activeResearch.techId === "mine" && r.activeResearch.targetLevel === 2,
       "[settle][D-b] 占用槽位的应为队列项 mine@2，而非请求的 mine@3");
    ok(r.pendingQueue.length === 0, "[settle][D-b] 队列项 mine@2 应已移出队列");
    ok(emitCalls.filter((e) => e.evt === "research:stepCompleted").length === before + 1,
       "[settle][D-a/D-b] 事件只对应旧步骤 mine@1");
    ok(r.lastProcessedAt === NOW + 100 * 1000, "[settle][D-b] lastProcessedAt 应=now");
  }

  // --- H. 极端坏档 / guard ---
  for (const badRemaining of [0, NaN, Infinity]) {
    const r = freshResearch(NOW);
    r.completedLevels = { syseng: 1 }; // 使 syseng@1 视为已完成 → 队列项均非法
    const q = [];
    for (let i = 0; i < 500; i++) q.push("syseng@1"); // 已完成 → 非法
    q.push("garbage");      // 坏格式 → 非法
    q.push("mine@99");      // 超范围 → 非法
    q.push("mine@2");       // 缺前置 mine@1 → 非法
    r.pendingQueue = q;
    setActive(r, "mine", 1, badRemaining, 100, NOW); // 非法 remaining
    const beforeH = emitCalls.filter((e) => e.evt === "research:stepCompleted").length;
    const st = makeState(r);
    let threw = null, resH;
    try { resH = ResearchSystem.processResearchUntil(st, NOW + 100000); } catch (e) { threw = e; }
    ok(threw === null,
       `[settle][H] remaining=${badRemaining} 不得抛异常/栈溢出/死循环（有限时间内返回）`);
    ok(resH && resH.ok === true,
       `[settle][H] remaining=${badRemaining} 应有限返回 ok=true`);
    ok(r.lastProcessedAt === NOW + 100000,
       `[settle][H] remaining=${badRemaining} 锚点应推进到 now`);
    ok(r.pendingQueue.length === 0,
       `[settle][H] remaining=${badRemaining} 非法队列项应被有限处理清空`);
    if (r.activeResearch !== null) {
      ok(isFinite(r.activeResearch.remainingSeconds),
         `[settle][H] remaining=${badRemaining} 不得产生 NaN/Infinity remaining`);
    }
    ok(emitCalls.filter((e) => e.evt === "research:stepCompleted").length === beforeH + 1,
       `[settle][H] remaining=${badRemaining} 同一坏步骤最多完成/emit 一次`);
  }

  // --- I. getResearchProgress 深度只读 ---
  {
    const r = freshResearch(0);
    setActive(r, "syseng", 1, 1000, 2000, 0); // ratio=0.5
    const before = JSON.stringify(r);
    const p = ResearchSystem.getResearchProgress({ research: r });
    const after = JSON.stringify(r);
    ok(before === after, "[settle][I] getResearchProgress 应深度只读（state 前后完全一致）");
    ok(p.active === true && Math.abs(p.ratio - 0.5) < 1e-9,
       "[settle][I] 进度查询仍正确（ratio=0.5）");
  }

  // ---------- 真实路径：全脚本沙箱 spy gameTick / calculateOfflineGains ----------
  {
    const full = buildFullGameSandbox(null); // 新游戏路径
    const sb2 = full.sandbox;
    ok(!!sb2.ResearchSystem, "[settle] 全脚本沙箱应加载 ResearchSystem");
    ok(!!sb2.gameState && !!sb2.gameState.research, "[settle] 全脚本沙箱应暴露 gameState.research");

    // G. 单一 spy：tick 与 offline 共用同一个 ResearchSystem.processResearchUntil 入口。
    //    settleCalls 累计（不重置），便于 G 汇总断言"两处都命中同一 spy"。
    const settleCalls = [];
    const realSettle = sb2.ResearchSystem.processResearchUntil;
    sb2.ResearchSystem.processResearchUntil = function (state, now) {
      settleCalls.push({ state, now });
      return realSettle.call(this, state, now);
    };

    // E. 真实 gameTick 进入业务提前 return：currentAction=mining 但无有效区域 →
    //    tick.js L46 `if (!area) return;` 提前返回（非 stopOrSkip 路径）。结算调用必须在 return
    //    之前发生一次；gameTick 不得抛异常（异常=FAIL，绝不靠 catch 记 PASS）。
    sb2.gameState.research.activeResearch = {
      techId: "syseng", targetLevel: 1,
      startedAt: NOW - 1000, baseDuration: 1365, remainingSeconds: 2000, appliedAchievementSeconds: 0,
    };
    sb2.gameState.research.lastProcessedAt = NOW - 1000;
    sb2.gameState.currentAction = {
      active: true, skill: "mining",
      startedArea: null, smeltingArea: null,
      lastProgressUpdate: NOW - 1000, progress: 0, batchRemaining: 0, refDuration: 0,
    };
    const nE = settleCalls.length;
    let tickThrew = null;
    try { sb2.gameTick(); } catch (e) { tickThrew = e; }
    ok(tickThrew === null, "[settle][E] 真实 gameTick 不得抛异常（异常=FAIL，不靠 catch 记 PASS）");
    ok(settleCalls.length - nE === 1,
       "[settle][E] 真实 gameTick 应恰好调用一次 processResearchUntil（早于任何提前 return）");
    ok(settleCalls[nE] && settleCalls[nE].state === sb2.gameState,
       "[settle][E] gameTick 应将 gameState 作为首个实参传入");
    ok(settleCalls[nE] && typeof settleCalls[nE].now === "number" && settleCalls[nE].now === FROZEN_NOW,
       "[settle][E] gameTick 传入的 now 应为冻结绝对时刻（非 elapsed 秒数，未预截 86400）");
    ok(Math.abs(sb2.gameState.research.activeResearch.remainingSeconds - 1999) < 1e-6,
       "[settle][E] 真实 gameTick 路径应实际推进科研（remaining 2000→1999）");
    // 证明走到目标提前返回分支：该分支直接 return，不调 stopOrSkip，故 active 仍为 true。
    ok(sb2.gameState.currentAction.active === true,
       "[settle][E] gameTick 应走 L46 `if(!area) return;` 分支（active 仍为 true，未被 stopOrSkip 置 false）");

    // F. calculateOfflineGains 两条真实路径（各自独立；异常=FAIL）
    // F-1: elapsed > 5（真实离线 60s）
    sb2.gameState.research.activeResearch = {
      techId: "syseng", targetLevel: 1,
      startedAt: NOW - 60000, baseDuration: 1365, remainingSeconds: 2000, appliedAchievementSeconds: 0,
    };
    sb2.gameState.research.lastProcessedAt = NOW - 60000;
    sb2.gameState.lastActiveTime = NOW - 60000; // 离线 60s
    const nF1 = settleCalls.length;
    let off1Threw = null;
    try { sb2.calculateOfflineGains(); } catch (e) { off1Threw = e; }
    ok(off1Threw === null, "[settle][F] calculateOfflineGains(elapsed>5) 不得抛异常（异常=FAIL）");
    ok(settleCalls.length - nF1 === 1,
       "[settle][F] elapsed>5 路径应恰好调用一次 processResearchUntil");
    ok(settleCalls[nF1] && settleCalls[nF1].state === sb2.gameState,
       "[settle][F] elapsed>5 应将 gameState 作为首个实参传入");
    ok(settleCalls[nF1] && typeof settleCalls[nF1].now === "number" && settleCalls[nF1].now === FROZEN_NOW,
       "[settle][F] elapsed>5 传入的 now 应为冻结绝对时刻（非 elapsed 秒数）");
    ok(Math.abs(sb2.gameState.research.activeResearch.remainingSeconds - 1940) < 1e-6,
       "[settle][F] elapsed>5 路径应真实推进 60s（remaining 2000→1940）");

    // F-2: elapsed <= 5（legacy 离线收益提前 return，但科研结算仍发生）
    sb2.gameState.research.activeResearch = {
      techId: "syseng", targetLevel: 1,
      startedAt: NOW - 1000, baseDuration: 1365, remainingSeconds: 2000, appliedAchievementSeconds: 0,
    };
    sb2.gameState.research.lastProcessedAt = NOW - 1000;
    sb2.gameState.lastActiveTime = NOW - 3000; // 离线 3s <= 5
    const nF2 = settleCalls.length;
    let off2Threw = null;
    try { sb2.calculateOfflineGains(); } catch (e) { off2Threw = e; }
    ok(off2Threw === null, "[settle][F] calculateOfflineGains(elapsed<=5) 不得抛异常（异常=FAIL）");
    ok(settleCalls.length - nF2 === 1,
       "[settle][F] elapsed<=5 路径仍应恰好调用一次 processResearchUntil（位于提前 return 之前）");
    ok(settleCalls[nF2] && settleCalls[nF2].state === sb2.gameState,
       "[settle][F] elapsed<=5 实参应为 gameState");
    ok(settleCalls[nF2] && typeof settleCalls[nF2].now === "number" && settleCalls[nF2].now === FROZEN_NOW,
       "[settle][F] elapsed<=5 传入的 now 应为冻结绝对时刻");
    ok(Math.abs(sb2.gameState.research.activeResearch.remainingSeconds - 1999) < 1e-6,
       "[settle][F] elapsed<=5 路径科研仍完成调用并推进 1s（remaining 2000→1999）");

    // G. tick / offline 共用同一入口（汇总断言）
    ok(settleCalls.length === 3,
       "[settle][G] tick+offline 合计恰好 3 次调用（gameTick×1 + offline>5×1 + offline<=5×1），共用同一 spy");
    ok(settleCalls.every((c) => c.state === sb2.gameState),
       "[settle][G] 三次调用 state 均为同一 gameState（tick/offline 无复制第二套结算公式）");
    ok(settleCalls.every((c) => typeof c.now === "number" && c.now === FROZEN_NOW),
       "[settle][G] 三次 now 均为冻结绝对时刻（不传 elapsed、不预先把 now 截成 86400）");
    ok(settleCalls.every((c) => Object.keys(c).length === 2),
       "[settle][G] 调用方仅传 (state, now) 两个参数，未多传 elapsed");
  }
}

const args = process.argv.slice(2);
const unknown = args.filter((a) => !KNOWN_FLAGS.has(a));
if (unknown.length) {
  console.error(`[audit-research] 未知参数：${unknown.join(" ")}（可用：--data --state --queue --settle，或无参数运行全部）`);
  process.exit(2);
}
const wantData = args.includes("--data");
const wantState = args.includes("--state");
const wantQueue = args.includes("--queue");
const wantSettle = args.includes("--settle");
const runAll = args.length === 0;

const sections = [];
async function runSection(name, fn) {
  const p0 = passCount;
  const f0 = failCount;
  try {
    await fn();
  } catch (e) {
    failCount += 1;
    failures.push(`运行 ${name} 时抛出异常: ` + (e && e.stack ? e.stack : e));
  }
  sections.push({ name, pass: passCount - p0, fail: failCount - f0 });
}

if (wantData || runAll) await runSection("--data", runData);
if (wantState || runAll) await runSection("--state", runState);
if (wantQueue || runAll) await runSection("--queue", runQueue);
if (wantSettle || runAll) await runSection("--settle", runSettle);

// ---- 收尾：全部断言执行后打印，按 AGENTS.md 报告标准 ----
console.log("");
console.log(`=== audit-research.mjs ${runAll ? "(all: data+state+queue+settle)" : args.join(" ")} ===`);
for (const s of sections) {
  console.log(`  区域 ${s.name}: PASS=${s.pass}  FAIL=${s.fail}`);
}
console.log(`PASS=${passCount}  FAIL=${failCount}`);
if (failures.length) {
  console.log("失败项（共 " + failures.length + "）：");
  for (const f of failures) console.log("  ✗ " + f);
}
process.exit(failCount === 0 ? 0 : 1);
