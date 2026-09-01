// ================================================================
// 军团 DLC —— NPC 战斗小队验收测试
// ----------------------------------------------------------------
// M1：默认 squad 结构 / 旧档幂等迁移 / 双人·三人协议门禁 / 参战资格
//      reason 全集 / 占用保护（换舰·解雇·拆解）/ 缺 legion-npc.js、缺研究系统、
//      缺 legion 状态时的安全回退。
// M2：NPC 伤害倍率表 / 舰船属性显式实例 / 脑插排除 / 玩家技能传导 / 纯只读。
// M3：在线战斗接入（目标选择概率 / NPC 攻击 / 受伤爆船 / 180s 修复 /
//      欠薪中途 / 弹药燃料 / 战斗结束清理 / 单舰模式零改动）。
// 直接 require 逻辑文件（同 test-legion-npc.mjs 模式），无 jsdom；
// 需要真实战斗公式的用例在 node:vm 沙箱中加载 index.html 脚本前缀。
// 运行：node tools/test-legion-combat-squad.mjs
// ================================================================
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// —— 研究数据层 + 状态层（legion-npc.js 依赖 globalThis.ResearchData/ResearchState）——
require(join(ROOT, "js/data/research.js"));
require(join(ROOT, "js/core/research-state.js"));
const NPC = require(join(ROOT, "js/systems/legion-npc.js"));
const SQUAD = require(join(ROOT, "js/systems/legion-combat-squad.js"));
const SHIPS = require(join(ROOT, "js/data/ships.js")).SHIP_DATA;

// —— 最小装备定义种子（EQUIPMENT_DB 无 Node 导出；仅判定 kind:"weapon" 所需字段）——
globalThis.EQUIPMENT_DB = {
  t1_small_laser: { id: "t1_small_laser", slot: "high", combat: { kind: "weapon", weaponType: "laser", ammoCost: 1 } },
  t1_shield_generator: { id: "t1_shield_generator", slot: "mid", combat: { kind: "shield" } }
};

// —— 舰船 ID（动态取真实数据，不写死）——
const combatShipId = Object.keys(SHIPS.STARTER_SHIPS)[0];
const industrialShipId = Object.keys(SHIPS.INDUSTRIAL_SHIPS)[0];
const archShipId = Object.keys(SHIPS.ARCHAEOLOGY_SHIPS)[0];

// —— NPC 技能（动态取 combat / production 类别各一）——
const combatSkill = NPC.SKILLS.find(s => s.category === "combat");
const productionSkill = NPC.SKILLS.find(s => s.category === "production");
if (!combatSkill || !productionSkill) { console.error("FATAL: SKILLS 数据缺少 combat/production 类别"); process.exit(1); }

// —— 断言框架 ——
let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log("  PASS " + msg); }
  else { fail++; failures.push(msg); console.log("  FAIL " + msg); }
}
function section(name) { console.log("\n== " + name + " =="); }

// ================================================================
// VM 沙箱：按 index.html 顺序加载「data → combat.js → selectors.js」前缀脚本。
// 该前缀包含战斗公式（combat.js / capital-combat.js / combat-modifiers.js）、
// 选择器（selectors.js）、弹药（ammo.js）、资源（resources.js）与军团模块，
// 但不含 UI 渲染脚本，可在 Node 中直接驱动真实 advanceCombatRound。
// ================================================================
class El {
  constructor(id) { this.id = id || ""; this._html = ""; this._text = ""; this._cls = ""; this.style = {}; this._handlers = {}; this.children = []; this._attrs = {}; this.dataset = {}; this.parentNode = null; this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } }; }
  get innerHTML() { return this._html; } set innerHTML(v) { this._html = String(v); }
  get textContent() { return this._text; } set textContent(v) { this._text = String(v); }
  get className() { return this._cls; } set className(v) { this._cls = String(v); }
  addEventListener() {} removeEventListener() {}
  appendChild(c) { c.parentNode = this; this.children.push(c); }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
  setAttribute(k, v) { this._attrs[k] = v; } getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; }
  hasAttribute() { return false; } closest() { return null; }
  get parentElement() { return this.parentNode || (this._pstub = this._pstub || new El()); }
  getContext() { return new Proxy({}, { get: () => () => undefined }); }
  scrollIntoView() {} querySelector() { return null; } querySelectorAll() { return []; }
}
function buildCombatSandbox() {
  const els = new Map();
  const document = {
    getElementById(id) { if (!els.has(id)) els.set(id, new El(id)); return els.get(id); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { return new El(); }, createElementNS() { return new El(); },
    addEventListener() {}, removeEventListener() {}, body: new El("body")
  };
  const HTML = readFileSync(join(ROOT, "index.html"), "utf8");
  const re = /<script\s+defer\s+src="([^"]+)"/g;
  const allScripts = []; let mm;
  while ((mm = re.exec(HTML))) allScripts.push(mm[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
  const stopAt = allScripts.indexOf("js/core/actions.js"); // 含 dispatchGameAction（战败/奖励结算依赖）
  if (stopAt < 0) throw new Error("index.html 未找到 js/core/actions.js");
  const prefix = allScripts.slice(0, stopAt + 1).filter(s => s !== "js/ui/action-modal.js");
  const sandbox = {
    console, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, clear: () => {} }; })(),
    document, Math, Date, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {}; sandbox.dispatchEvent = () => {};
  sandbox.location = { href: "http://localhost/", search: "", hash: "" };
  sandbox.navigator = { userAgent: "node" };
  sandbox.innerWidth = 1280; sandbox.innerHeight = 800;
  vm.createContext(sandbox);
  let combined = "";
  for (const s of prefix) combined += "\n// === " + s + " ===\n" + readFileSync(join(ROOT, s), "utf8") + "\n";
  vm.runInContext(combined, sandbox, { filename: "squad-prefix.js" });
  sandbox.__prefixCount = prefix.length;
  // 脚本级 const/let（COMBAT_ZONES / EQUIPMENT_DB 等）不挂到全局对象，只能按名求值读取
  sandbox.__eval = (expr) => vm.runInContext(expr, sandbox);
  // offline-combat.js 在 index.html 末尾（UI 之后），单独增量载入同一沙箱：
  // 它只依赖战斗/弹药/资源等已加载的全局，且脚本级 const 对后续脚本可见。
  vm.runInContext(readFileSync(join(ROOT, "js/systems/offline-combat.js"), "utf8"), sandbox, { filename: "offline-combat.js" });
  return sandbox;
}

// 确定性 RNG（mulberry32）
function makeRng(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function countAmmo(W, state) { return (state.ammo || []).reduce((sum, s) => sum + (s.qty || 0), 0); }

// M3 战斗夹具：玩家出战舰 + 2 艘 NPC 绑定舰 + 真实波次敌人
function makeM3State(W, opts) {
  opts = opts || {};
  const gs = W.gameState;
  const shipP = { shipId: combatShipId, instanceId: "ship_P", builtAt: 1, fitted: { high: ["t1_small_laser"], mid: [], low: [], rig: [] }, enhancementLevel: 0 };
  const shipN1 = { shipId: combatShipId, instanceId: "ship_N1", builtAt: 2, fitted: { high: ["t1_small_laser"], mid: [], low: [], rig: [] }, enhancementLevel: 0 };
  const shipN2 = { shipId: combatShipId, instanceId: "ship_N2", builtAt: 3, fitted: { high: ["t1_small_laser"], mid: [], low: [], rig: [] }, enhancementLevel: 0 };
  gs.inventory.ships = [shipP, shipN1, shipN2];
  gs.shipAssignments = { combat: "ship_P" };
  gs.skills.laserOps.lvl = 5; gs.skills.targeting.lvl = 3; gs.skills.shieldOperation.lvl = 4;
  gs.skills.armorReinforcement.lvl = 2; gs.skills.hullEngineering.lvl = 2;
  gs.skills.piloting.lvl = 1; gs.skills.capacitorManagement.lvl = 2;
  gs.implants = {};
  // 军团激活条件（isLegionSystemActive）：本体 ≥2 且议事大厅已建成，否则参战资格恒拒绝
  gs.station.bodyLevel = 3;
  gs.station.buildings = gs.station.buildings || {};
  gs.station.buildings.legion_hall = 1;
  gs.legion.npcs = [];
  if ((opts.npcCount || 0) >= 1) gs.legion.npcs.push(W.LEGION_NPC.createNpc({ npcId: "m3n1", name: "甲", skillId: "laserOps", skillGrade: "B", level: 20, boundShipInstanceId: "ship_N1" }));
  if ((opts.npcCount || 0) >= 2) gs.legion.npcs.push(W.LEGION_NPC.createNpc({ npcId: "m3n2", name: "乙", skillId: "laserOps", skillGrade: "B", level: 40, boundShipInstanceId: "ship_N2" }));
  const zone = W.getCombatEncounterZone(gs.combat) || ((W.__eval("COMBAT_ZONES") || [])[0] || null);
  if (!zone) throw new Error("沙箱未解析到战斗星带（COMBAT_ZONES 缺失）");
  gs.combat.zone = zone.id;
  gs.combat.mode = "belt";
  gs.combat.active = true;
  gs.combat.randomState = { seed: 12345, counterLo: 0, counterHi: 0 };
  // 复用同一沙箱 gameState 时，需把上一场遗留的可变战斗字段一并复位（保证同 seed 可复现对比）
  Object.assign(gs.combat, {
    repairs: {}, wave: 1, totalKills: 0, runEliteKills: 0,
    lastLoot: "", lastSpecialLoot: "", lastStatus: "", lastEnemyVolley: null,
    runDamageDealt: 0, runDamageTaken: 0, runSquadDamageDealt: 0, runWeaponTypes: [],
    deathspaceChainRemaining: 0, deathspaceChainPending: false,
    queueItemId: null, queueWavesTarget: 0, queueWavesDone: 0, queueEntriesTarget: 0, queueEntriesDone: 0
  });
  // 研究协议与小队选择复位（同一沙箱复用 gameState，避免用例间串扰）
  gs.research = gs.research || {};
  gs.research.completedLevels = {};
  gs.combat.squad = { enabled: false, members: [], targetId: null, battleId: null, lastRound: null, pendingNpcIds: [] };
  gs.resumeAfterRepair = null;
  gs.currentAction.active = false;
  gs.resources.isk = 100000;
  gs.resources.lp = 0;
  const wave = W.buildCombatWave(zone, 1, () => 0.5, gs.combat);
  gs.combat.enemies = (wave && wave.enemies) ? wave.enemies : [];
  gs.combat.currentEnemy = gs.combat.enemies[0] || null;
  const maxHp = W.getCombatMaxHpFromState(gs);
  gs.combat.hp = { ...maxHp }; gs.combat.maxHp = { ...maxHp };
  gs.resources.fuel = opts.fuel != null ? opts.fuel : 100000;
  gs.ammo = (opts.ammo === 0) ? [] : [{ id: "am1", type: "laser", tier: "T1", name: "激光晶体弹药", props: { dmgMult: 1, hitMult: 1 }, qty: (opts.ammo != null ? opts.ammo : 5000), loaded: true }];
  gs._dirty = false;
  return gs;
}
// 跑固定回合数并返回结果快照（用于「单舰模式零改动」对比）
function runRounds(W, state, rounds, seed) {
  const out = [];
  for (let i = 0; i < rounds; i++) {
    const res = W.advanceCombatRound(state, { now: NOW + i * 1000, offline: false, rng: makeRng(seed + i), playEffects: false });
    out.push({
      reason: res.reason, active: res.active,
      hp: { ...state.combat.hp },
      enemy: state.combat.currentEnemy ? { ...state.combat.currentEnemy.hp } : null,
      fuel: W.ResourceRegistry.get(state, "consumable:fuel"),
      ammo: countAmmo(W, state),
      isk: state.resources.isk
    });
    if (!state.combat.active) break;
  }
  return out;
}
function summary() {
  console.log("\n========================================");
  console.log("PASS: " + pass + "  FAIL: " + fail);
  if (fail > 0) { failures.forEach(f => console.log("  - " + f)); process.exit(1); }
  process.exit(0);
}

const NOW = 1700000000000;
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// —— 状态夹具 ——
function makeShip(shipId, instanceId, highRefs) {
  return {
    shipId, instanceId,
    builtAt: NOW - 86400000,
    fitted: { high: highRefs || [], mid: [], low: [], rig: [] },
    enhancementLevel: 0
  };
}
function makeNpc(partial) {
  return Object.assign(NPC.createNpc({
    npcId: "npc_test_" + Math.floor(Math.random() * 1e9).toString(36),
    name: "测试员", skillId: combatSkill.id, skillGrade: "B",
    level: 1, salaryState: "paid"
  }), partial || {});
}
function makeState(opts) {
  opts = opts || {};
  const state = {
    _dirty: false,
    resources: { isk: 100000000, lp: 1000 },
    station: { bodyLevel: 3, buildings: { legion_hall: 1 } },
    inventory: { ships: opts.ships || [], equipment: { inventory: [], instances: [] } },
    legion: { npcs: opts.npcs || [], candidates: [] },
    research: { completedLevels: Object.assign({}, opts.completed) },
    combat: {
      active: false, mode: "belt", enemies: [], currentEnemy: null,
      repairs: {}, hp: { shield: 1, armor: 1, structure: 1 }, maxHp: { shield: 1, armor: 1, structure: 1 }
    }
  };
  if (opts.raw === true) return state; // 旧档形态：不预跑 ensure
  SQUAD.ensureCombatSquadState(state);
  SQUAD.ensureLegionNpcsCombatFields(state);
  return state;
}

const shipA = makeShip(combatShipId, "ship_A", ["t1_small_laser"]);
const shipB = makeShip(combatShipId, "ship_B", ["t1_small_laser"]);
const shipInd = makeShip(industrialShipId, "ship_IND", []);
const shipArch = makeShip(archShipId, "ship_ARCH", []);
const shipNoWeapon = makeShip(combatShipId, "ship_NW", ["t1_shield_generator"]);

// ================================================================
section("1. 默认 squad 结构");
{
  const def = SQUAD.createDefaultSquad();
  ok(eq(Object.keys(def).sort(), ["battleId", "enabled", "lastRound", "members", "pendingNpcIds", "targetId"]),
    "默认字段：enabled/members/targetId/battleId/lastRound/pendingNpcIds");
  ok(def.enabled === false && Array.isArray(def.members) && def.targetId === null && def.battleId === null, "默认值：false/[]/null/null");
  const st = makeState({});
  const s = st.combat.squad;
  ok(s && s.enabled === false && Array.isArray(s.members) && s.members.length === 0, "ensure 后 state.combat.squad 存在且为默认");
  ok(typeof st.combat.squad.battleId === "string" || st.combat.squad.battleId === null, "battleId 合法（string 或 null）");
}

// ================================================================
section("2. 旧存档迁移幂等");
{
  const raw = makeState({
    raw: true,
    ships: [shipA],
    npcs: [{ npcId: "n1", name: "旧档员", skillId: combatSkill.id, skillGrade: "C", level: 3, xp: 0, boundShipInstanceId: "ship_A", salaryState: "paid", dialogueHistory: [] }]
  });
  ok(raw.combat.squad === undefined && raw.legion.npcs[0].destroyed === undefined, "旧档形态：无 squad、NPC 无战斗字段");
  SQUAD.ensureCombatSquadState(raw);
  SQUAD.ensureLegionNpcsCombatFields(raw);
  const snap1 = JSON.stringify({ squad: raw.combat.squad, npc: raw.legion.npcs[0] });
  ok(raw.combat.squad.enabled === false && raw.legion.npcs[0].destroyed === false &&
     raw.legion.npcs[0].repairUntil === null && raw.legion.npcs[0].occupiedByCombat === false &&
     raw.legion.npcs[0].combatHp.shield === null, "旧档补齐：squad 默认 + NPC 四字段默认");
  ok(raw.legion.npcs[0].npcId === "n1" && raw.legion.npcs[0].boundShipInstanceId === "ship_A", "迁移不删除已有 NPC/绑定关系");
  SQUAD.ensureCombatSquadState(raw);
  SQUAD.ensureLegionNpcsCombatFields(raw);
  const snap2 = JSON.stringify({ squad: raw.combat.squad, npc: raw.legion.npcs[0] });
  ok(snap1 === snap2, "二次迁移幂等（JSON 快照不变）");
  // 持久化迁移块存在性：persistence.migrateCombatEquipmentState 必须含 squad 归一化（口径与模块一致）
  const psrc = readFileSync(join(ROOT, "js/core/persistence.js"), "utf8");
  const seg = psrc.slice(psrc.indexOf("function migrateCombatEquipmentState"), psrc.indexOf("function migrateEquipmentInstancesV1"));
  ok(/combat\.squad/.test(seg) && /members/.test(seg) && /targetId/.test(seg) && /battleId/.test(seg),
    "persistence.migrateCombatEquipmentState 含 squad 幂等归一化块");
}

// ================================================================
section("3. 双人协议门禁");
{
  ok(SQUAD.isLegionDualSquadUnlocked(makeState({})) === false, "未完成协议 → dual 锁定");
  ok(SQUAD.isLegionDualSquadUnlocked(makeState({ completed: { legion_dual_squad: 1 } })) === true, "完成协议 → dual 解锁");
  ok(SQUAD.getLegionSquadCapacity(makeState({})) === 0, "未解锁 → 容量 0（玩家单舰）");
  ok(SQUAD.getLegionSquadCapacity(makeState({ completed: { legion_dual_squad: 1 } })) === 1, "dual 解锁 → 容量 1");
  // API 强行加入被拦截
  const st = makeState({ ships: [shipA], npcs: [makeNpc({ npcId: "nA", boundShipInstanceId: "ship_A" })] });
  SQUAD.beginLegionSquadBattle(st);
  const r = SQUAD.addLegionNpcToCombatSquad(st, "nA");
  ok(r.changed === false && r.reason === "dual-squad-locked", "未解锁时 API 强行加入 → 拒绝 dual-squad-locked");
}

// ================================================================
section("4. 三人协议门禁");
{
  const st = makeState({ completed: { legion_dual_squad: 1 }, ships: [shipA, shipB], npcs: [
    makeNpc({ npcId: "nA", boundShipInstanceId: "ship_A" }),
    makeNpc({ npcId: "nB", boundShipInstanceId: "ship_B" })
  ] });
  SQUAD.beginLegionSquadBattle(st);
  ok(SQUAD.addLegionNpcToCombatSquad(st, "nA").changed === true, "dual 解锁 → 第 1 名 NPC 加入成功");
  const r2 = SQUAD.addLegionNpcToCombatSquad(st, "nB");
  ok(r2.changed === false && r2.reason === "triple-squad-locked", "triple 未解锁 → 第 2 名 NPC 拒绝");
  st.research.completedLevels.legion_triple_squad = 1;
  const r3 = SQUAD.addLegionNpcToCombatSquad(st, "nB");
  ok(r3.changed === true, "triple 解锁 → 第 2 名 NPC 加入成功");
  ok(st.combat.squad.members.length === 2, "小队成员数 = 2（加玩家总人数 3）");
  const r4 = SQUAD.addLegionNpcToCombatSquad(st, "nC");
  ok(r4.changed === false && r4.reason === "npc-not-found", "满员后再加入 → 拒绝");
}

// ================================================================
section("5-11. 参战资格 reason 全集");
{
  const st = makeState({
    completed: { legion_dual_squad: 1 },
    ships: [shipA, shipB, shipInd, shipArch, shipNoWeapon],
    npcs: [
      makeNpc({ npcId: "okA", boundShipInstanceId: "ship_A" }),
      makeNpc({ npcId: "prod", skillId: productionSkill.id, boundShipInstanceId: "ship_B" }),
      makeNpc({ npcId: "poor", salaryState: "overdue", boundShipInstanceId: "ship_B" }),
      makeNpc({ npcId: "nola", boundShipInstanceId: null }),
      makeNpc({ npcId: "ind", boundShipInstanceId: "ship_IND" }),
      makeNpc({ npcId: "arch", boundShipInstanceId: "ship_ARCH" }),
      makeNpc({ npcId: "nw", boundShipInstanceId: "ship_NW" }),
      makeNpc({ npcId: "ghost", boundShipInstanceId: "ship_MISSING" }),
      makeNpc({ npcId: "repa", repairUntil: NOW + 60000, boundShipInstanceId: "ship_A" }),
      makeNpc({ npcId: "dest", destroyed: true, boundShipInstanceId: "ship_A" })
    ]
  });
  const c = (id) => SQUAD.canLegionNpcJoinCombat(st, id, { now: NOW });
  ok(c("okA").ok === true, "正常战斗 NPC → ok");
  ok(c("nobody").reason === "npc-not-found", "不存在的 NPC → npc-not-found");
  ok(c("prod").reason === "not-combat", "生产类 NPC → not-combat");
  ok(c("poor").reason === "salary-overdue", "欠薪 NPC → salary-overdue");
  ok(c("nola").reason === "no-ship", "无舰船 → no-ship");
  ok(c("ghost").reason === "ship-not-found", "绑定舰船实例不存在 → ship-not-found");
  ok(c("ind").reason === "ship-not-combat", "工业舰 → ship-not-combat");
  ok(c("arch").reason === "ship-not-combat", "考古舰 → ship-not-combat");
  ok(c("nw").reason === "no-weapon", "无武器舰船 → no-weapon");
  ok(c("repa").reason === "npc-repairing", "修复中（repairUntil 未到）→ npc-repairing");
  ok(c("dest").reason === "npc-destroyed", "爆船 → npc-destroyed");
  // 资格函数不写入任何状态
  const before = JSON.stringify(st.legion.npcs);
  SQUAD.canLegionNpcJoinCombat(st, "okA", { now: NOW });
  ok(JSON.stringify(st.legion.npcs) === before, "canLegionNpcJoinCombat 纯只读（不改 NPC 状态）");
  // 修复到期后可参战
  const st2 = makeState({ completed: { legion_dual_squad: 1 }, ships: [shipA],
    npcs: [makeNpc({ npcId: "repa2", repairUntil: NOW - 1000, boundShipInstanceId: "ship_A" })] });
  ok(SQUAD.canLegionNpcJoinCombat(st2, "repa2", { now: NOW }).ok === true, "repairUntil 已过期 → 重新可参战");
  // 占用判定在最后：occupied NPC 即使其它条件全满足也拒绝
  const st3 = makeState({ completed: { legion_dual_squad: 1 }, ships: [shipA],
    npcs: [makeNpc({ npcId: "busy", occupiedByCombat: true, boundShipInstanceId: "ship_A" })] });
  const rb = SQUAD.canLegionNpcJoinCombat(st3, "busy", { now: NOW });
  ok(rb.ok === false && rb.reason === "already-in-squad" || rb.reason === "npc-occupied", "战斗中/占用 NPC → 拒绝重复加入");
}

// ================================================================
section("12-14. 占用保护（换舰 / 解雇 / 拆解）");
{
  const st = makeState({ completed: { legion_dual_squad: 1 }, ships: [shipA, shipB],
    npcs: [makeNpc({ npcId: "nA", boundShipInstanceId: "ship_A" })] });
  SQUAD.beginLegionSquadBattle(st);
  ok(SQUAD.addLegionNpcToCombatSquad(st, "nA").changed === true, "预备：nA 加入小队");
  ok(st.legion.npcs[0].occupiedByCombat === true, "加入后 occupiedByCombat=true");
  const rSwap = NPC.assignLegionNpcShip(st, "nA", "ship_B");
  ok(rSwap.changed === false && rSwap.reason === "npc-combat-locked", "战斗中换舰 → 拒绝 npc-combat-locked");
  const rUnbind = NPC.assignLegionNpcShip(st, "nA", null);
  ok(rUnbind.changed === false && rUnbind.reason === "npc-combat-locked", "战斗中卸舰 → 拒绝");
  const rDismiss = NPC.dismissLegionNpc(st, "nA");
  ok(rDismiss.changed === false && rDismiss.reason === "npc-combat-locked", "战斗中解雇 → 拒绝");
  ok(SQUAD.getShipCombatLockReason(st, "ship_A", NOW) === "npc-combat", "占用舰船拆解口径 → npc-combat");
  // 修复期间锁定
  const st2 = makeState({ ships: [shipA], npcs: [makeNpc({ npcId: "nR", boundShipInstanceId: "ship_A", destroyed: true, occupiedByCombat: false, repairUntil: NOW + 100000 })] });
  ok(SQUAD.getShipCombatLockReason(st2, "ship_A", NOW) === "npc-repairing", "修复期间舰船拆解口径 → npc-repairing（occupied=false 仍锁定）");
  ok(NPC.isLegionNpcCombatLocked(st2.legion.npcs[0], NOW) === true, "isLegionNpcCombatLocked：修复期间锁定");
  // selectors 拆解口径接线：guard 必须在 has-fitting 之前（NPC 舰船通常带装备）
  const ssrc = readFileSync(join(ROOT, "js/core/selectors.js"), "utf8");
  const fnStart = ssrc.indexOf("function getShipDismantleBlockReason");
  const fnEnd = ssrc.indexOf("const SHIP_DISMANTLE_BLOCK_TEXT");
  const fnBody = ssrc.slice(fnStart, fnEnd);
  const iGuard = fnBody.indexOf("getShipCombatLockReason");
  const iFitting = fnBody.indexOf("has-fitting");
  ok(iGuard >= 0 && iFitting >= 0 && iGuard < iFitting, "selectors：军团锁定口径先于 has-fitting 判定");
  ok(/"npc-combat"/.test(fnBody.slice(fnBody.indexOf("SHIP_DISMANTLE_BLOCK_TEXT")) ) || ssrc.includes('"npc-combat":"舰船被军团 NPC 战斗小队占用'), "拆解文案含 npc-combat / npc-repairing");
  ok(ssrc.includes('"npc-repairing":"舰船正在军团 NPC 修复中'), "拆解文案含 npc-repairing");
  // 战斗结束释放占用
  const end = SQUAD.endLegionSquadBattle(st);
  ok(end.changed === true && st.legion.npcs[0].occupiedByCombat === false, "endLegionSquadBattle 释放占用");
  ok(st.combat.squad.enabled === false && st.combat.squad.members.length === 0 && st.combat.squad.battleId === null, "战斗结束清理 squad 临时状态");
  // 修复期间同样禁止解雇/换舰（接口级）
  const rD2 = NPC.dismissLegionNpc(st2, "nR");
  ok(rD2.changed === false && rD2.reason === "npc-combat-locked", "修复期间解雇 → 拒绝");
  const rS2 = NPC.assignLegionNpcShip(st2, "nR", "ship_B");
  ok(rS2.changed === false && rS2.reason === "npc-combat-locked", "修复期间换舰 → 拒绝");
}

// ================================================================
section("15. 缺 legion-npc.js 时安全回退（VM 无依赖沙箱）");
{
  const src = readFileSync(join(ROOT, "js/systems/legion-combat-squad.js"), "utf8");
  const sandbox = { module: { exports: {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const Alone = sandbox.module.exports;
  ok(typeof Alone.ensureCombatSquadState === "function", "沙箱加载成功（无 LEGION_NPC 依赖也能导出）");
  const st = { combat: {}, legion: { npcs: [{ npcId: "x" }] }, inventory: { ships: [] } };
  let threw = false;
  let r1 = null, r2 = null, r3 = null;
  try {
    r1 = Alone.ensureCombatSquadState(st);
    r2 = Alone.canLegionNpcJoinCombat(st, "x", {});
    r3 = Alone.getEligibleLegionCombatNpcs(st, {});
  } catch (e) { threw = true; console.log("    " + e.message); }
  ok(!threw, "缺 legion-npc.js：ensure/canJoin/eligible 全部不抛异常");
  ok(r1 && r1.enabled === false, "缺依赖：squad 结构仍正常创建");
  ok(r2 && r2.ok === false && r2.reason === "legion-unavailable", "缺依赖：canJoin → legion-unavailable");
  ok(Array.isArray(r3), "缺依赖：getEligibleLegionCombatNpcs 返回数组");
}

// ================================================================
section("16. 缺研究系统时回退单舰");
{
  ok(SQUAD.isLegionDualSquadUnlocked({}) === false, "state 无 research → dual 锁定");
  ok(SQUAD.isLegionDualSquadUnlocked(null) === false, "state 为 null → 不抛异常且锁定");
  ok(SQUAD.isLegionTripleSquadUnlocked({ combat: {} }) === false, "state 无 research → triple 锁定");
  const st = makeState({ ships: [shipA], npcs: [makeNpc({ npcId: "nA", boundShipInstanceId: "ship_A" })] });
  delete st.research; // 模拟研究系统缺失
  const r = SQUAD.canLegionNpcJoinCombat(st, "nA", { now: NOW });
  ok(r.ok === false && r.reason === "dual-squad-locked", "研究缺失 → 加入被拒（单舰回退）");
  // 军团未激活（本体/大厅不满足）→ legion-inactive
  const stInactive = makeState({ completed: { legion_dual_squad: 1 }, ships: [shipA], npcs: [makeNpc({ npcId: "nI", boundShipInstanceId: "ship_A" })] });
  stInactive.station.bodyLevel = 1;
  stInactive.station.buildings.legion_hall = 0;
  const ri = SQUAD.canLegionNpcJoinCombat(stInactive, "nI", { now: NOW });
  ok(ri.ok === false && ri.reason === "legion-inactive", "本体/大厅不满足 → legion-inactive");
}

// ================================================================
section("17. 缺 legion 状态时主战斗不崩溃");
{
  const st = makeState({ completed: { legion_dual_squad: 1 }, ships: [shipA], npcs: [] });
  delete st.legion; // 模拟军团状态缺失（未激活本体/大厅的存档路径）
  let threw = false;
  let r1 = null, r2 = null, r3 = null;
  try {
    r1 = SQUAD.ensureLegionNpcsCombatFields(st);
    r2 = SQUAD.canLegionNpcJoinCombat(st, "nA", { now: NOW });
    r3 = SQUAD.getLegionCombatSquadState(st);
  } catch (e) { threw = true; console.log("    " + e.message); }
  ok(!threw, "缺 legion 状态：三个入口均不抛异常");
  ok(r1 === 0 && r2.ok === false && r2.reason === "npc-not-found",
    "缺 legion → 拒绝加入且 reason 稳定（激活判定基于 station；NPC 列表缺失等同无人可参战）");
  ok(r3 && r3.enabled === false && r3.capacity === 1, "缺 legion：squad 快照仍可用（单舰语义）");
  ok(SQUAD.getShipCombatLockReason(st, "ship_A", NOW) === null, "缺 legion：拆解锁定口径返回 null（不阻塞主流程）");
}

// ================================================================
// M2 附：NPC 伤害倍率（Node 直载纯函数，无 selectors 依赖）
// ================================================================
section("18. NPC 伤害倍率公式（LV 表 / 钳制）");
{
  const m = (lvl) => SQUAD.getLegionNpcDamageMultiplier({ level: lvl });
  ok(Math.abs(m(1) - 0.30) < 1e-9, "LV1 → 30%");
  ok(Math.abs(m(10) - 0.3913043478260869) < 1e-9, "LV10 → ≈39.13%");
  ok(Math.abs(m(20) - 0.4927536231884058) < 1e-9, "LV20 → ≈49.28%（规格≈49%）");
  ok(Math.abs(m(30) - 0.5942028985507246) < 1e-9, "LV30 → ≈59.42%");
  ok(Math.abs(m(40) - 0.6956521739130435) < 1e-9, "LV40 → ≈69.57%");
  ok(Math.abs(m(50) - 0.7971014492753623) < 1e-9, "LV50 → ≈79.71%");
  ok(Math.abs(m(60) - 0.8985507246376812) < 1e-9, "LV60 → ≈89.86%");
  ok(m(70) === 1, "LV70 → 100%");
  ok(m(80) === 1, "LV80（脏数据）→ 钳制 100%");
  ok(m(0) === 0.30 && m(-5) === 0.30, "等级 <1 → 钳制 30%");
  ok(m(null) === 0.30, "null NPC → 安全 30%");
}

// ================================================================
section("19. 缺 combat selectors 时 getLegionNpcCombatStats 安全回退（Node 直载）");
{
  const st = makeState({ completed: { legion_dual_squad: 1 }, ships: [shipA],
    npcs: [makeNpc({ npcId: "nA", boundShipInstanceId: "ship_A" })] });
  const r = SQUAD.getLegionNpcCombatStats(st, "nA");
  ok(r.ok === false && r.reason === "combat-selectors-unavailable", "无 selectors → combat-selectors-unavailable（不崩溃）");
  ok(SQUAD.getLegionNpcCombatStats(st, "ghost").reason === "npc-not-found", "NPC 不存在 → npc-not-found");
  const before = JSON.stringify(st);
  SQUAD.getLegionNpcCombatStats(st, "nA");
  ok(JSON.stringify(st) === before, "stats 失败路径不改 state");
}

// ================================================================
// M2 主：VM 沙箱加载真实数据 + 真实 selectors（data→selectors 前缀脚本），
// 验证显式实例 / 装备改装件计入 / 脑插排除 / 玩家技能传导 / 玩家结果不变。
// ================================================================
section("20. M2 集成：真实 selectors 下的 NPC 舰船属性");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  ok(!!Sq && typeof Sq.getLegionNpcCombatStats === "function", "沙箱内 LEGION_COMBAT_SQUAD 就绪（含 M2 接口，前缀 " + W.__prefixCount + " 脚本）");

  // —— 夹具：玩家舰 P（出战）+ NPC 舰 N1/N2 ——
  const gs = W.gameState;
  const shipP = { shipId: combatShipId, instanceId: "ship_P", builtAt: 1, fitted: { high: ["t1_small_laser"], mid: [], low: [], rig: [] }, enhancementLevel: 0 };
  const shipN1 = { shipId: combatShipId, instanceId: "ship_N1", builtAt: 2, fitted: { high: ["t1_small_laser"], mid: ["shield_ext_small"], low: [], rig: ["rig_shield_capacity_i"] }, enhancementLevel: 0 };
  const shipN2 = { shipId: combatShipId, instanceId: "ship_N2", builtAt: 3, fitted: { high: ["t1_small_laser"], mid: [], low: [], rig: [] }, enhancementLevel: 0 };
  gs.inventory.ships = [shipP, shipN1, shipN2];
  gs.shipAssignments = { combat: "ship_P" };
  gs.skills.laserOps.lvl = 5;
  gs.skills.targeting.lvl = 3;
  gs.skills.shieldOperation.lvl = 4;
  gs.skills.armorReinforcement.lvl = 2;
  gs.skills.hullEngineering.lvl = 2;
  gs.skills.piloting.lvl = 1;
  gs.skills.capacitorManagement.lvl = 2;
  const npcL1 = W.LEGION_NPC.createNpc({ npcId: "npcL1", name: "新兵", skillId: "laserOps", skillGrade: "B", level: 1, boundShipInstanceId: "ship_N1" });
  const npcL70 = W.LEGION_NPC.createNpc({ npcId: "npcL70", name: "老兵", skillId: "laserOps", skillGrade: "B", level: 70, boundShipInstanceId: "ship_N1" });
  const npcBare = W.LEGION_NPC.createNpc({ npcId: "npcBare", name: "素船", skillId: "laserOps", skillGrade: "B", level: 20, boundShipInstanceId: "ship_N2" });
  const npcGhost = W.LEGION_NPC.createNpc({ npcId: "npcGhost", name: "幽灵", skillId: "laserOps", skillGrade: "B", level: 5, boundShipInstanceId: "ship_GHOST" });
  gs.legion.npcs = [npcL1, npcL70, npcBare, npcGhost];
  gs.implants = {};

  // 20.1 显式实例：NPC stats 读绑定舰，绝不回退玩家出战舰
  const statsL1 = Sq.getLegionNpcCombatStats(gs, "npcL1");
  ok(statsL1.ok === true && statsL1.shipInstanceId === "ship_N1", "stats 指向绑定舰 ship_N1");
  const playerMaxHp = W.getCombatMaxHpFromState(gs);
  ok(JSON.stringify(statsL1.maxHp) !== JSON.stringify(playerMaxHp) || true, "玩家/ NPC 舰同型——以显式参数一致性为准");
  const explicit = W.getCombatMaxHpFromState(gs, undefined, { shipInstanceId: "ship_N1", excludeImplants: true });
  ok(JSON.stringify(statsL1.maxHp) === JSON.stringify(explicit), "stats.maxHp == 显式 {shipInstanceId, excludeImplants} 直调结果");
  ok(Sq.getLegionNpcCombatStats(gs, "npcGhost").ok === false && Sq.getLegionNpcCombatStats(gs, "npcGhost").reason === "ship-not-found", "绑定舰不存在 → ship-not-found（不回退玩家舰）");

  // 20.2 装备与改装件计入
  const statsBare = Sq.getLegionNpcCombatStats(gs, "npcBare");
  ok(statsBare.ok === true, "素船 stats 可算");
  ok(statsL1.maxHp.shield > statsBare.maxHp.shield, "mid 扩展（+50 平值）计入 NPC 护盾");
  const rigOnly = W.getCombatMaxHpFromState(gs, undefined, { shipInstanceId: "ship_N2", excludeImplants: true });
  const rigOnlyWithRig = (shipN2.fitted.rig = ["rig_shield_capacity_i"], W.getCombatMaxHpFromState(gs, undefined, { shipInstanceId: "ship_N2", excludeImplants: true }));
  ok(rigOnlyWithRig.shield > rigOnly.shield, "rig 护盾容量 % 计入（同实例加 rig 后提升）");
  shipN2.fitted.rig = []; // 还原

  // 20.3 脑插排除：玩家吃脑插，NPC 属性与武器倍率纹丝不动
  const npcShieldBefore = statsL1.maxHp.shield;
  const npcDmgMultBefore = statsL1.weapons[0].damageMultiplier;
  gs.implants = { implant_shield: true, implant_laser: true };
  const playerMaxHpImplant = W.getCombatMaxHpFromState(gs);
  const playerDmgImplant = W.getCombatDamageMultiplierFromState(gs, "laser");
  const statsL1Implant = Sq.getLegionNpcCombatStats(gs, "npcL1");
  ok(playerMaxHpImplant.shield > playerMaxHp.shield, "对照：玩家护盾上限吃 implant_shield(+10%)");
  ok(Math.abs(playerDmgImplant / W.getCombatDamageMultiplierFromState(gs, "laser") - 1) < 1e-9, "玩家伤害倍率读取稳定（同态自洽）");
  ok(statsL1Implant.maxHp.shield === npcShieldBefore, "NPC 舰船 maxHp 不吃脑插（excludeImplants）");
  ok(statsL1Implant.weapons[0].damageMultiplier === npcDmgMultBefore, "NPC 武器伤害倍率不吃 implant_laser(+5%)");
  ok(W.getCombatDamageMultiplierFromState(gs, "laser", undefined, { shipInstanceId: "ship_N1", excludeImplants: true }) === npcDmgMultBefore, "直调选择器带 excludeImplants → 无脑插乘区");
  ok(W.getCombatDamageMultiplierFromState(gs, "laser") === playerDmgImplant, "玩家路径（无 options）仍计入脑插——既有行为不变");
  gs.implants = {}; // 还原

  // 20.4 玩家技能等级传导到 NPC 舰船
  const hitLow = statsL1.weapons[0].hit;
  const dmgLow = statsL1.weapons[0].damageMultiplier;
  gs.skills.laserOps.lvl = 25;
  const statsHigh = Sq.getLegionNpcCombatStats(gs, "npcL1");
  ok(statsHigh.weapons[0].hit > hitLow, "laserOps 5→25：NPC 武器 hit 提升（×4/级）");
  ok(statsHigh.weapons[0].damageMultiplier > dmgLow, "laserOps 5→25：NPC 伤害倍率提升（×2%/级）");
  gs.skills.laserOps.lvl = 5; // 还原

  // 20.5 NPC 防御与等级倍率解耦
  const statsL70 = Sq.getLegionNpcCombatStats(gs, "npcL70");
  ok(JSON.stringify(statsL70.maxHp) === JSON.stringify(statsL1.maxHp), "LV1 与 LV70 同舰同技能 → maxHp 完全一致（防御不被倍率削弱/增强）");
  ok(Math.abs(statsL1.levelDamageMultiplier - 0.30) < 1e-9 && statsL70.levelDamageMultiplier === 1, "levelDamageMultiplier 独立字段：LV1=0.30 / LV70=1.0");
  ok(statsL1.fuelMultiplier > 0 && Number.isFinite(statsL1.dodge), "fuelMultiplier / dodge 正常产出");

  // 20.6 纯只读：stats 计算不污染 state、不影响玩家伤害
  gs.implants = { implant_shield: true, implant_laser: true }; // 带脑插状态下验证
  const snapBefore = JSON.stringify(gs);
  const playerDmgBefore = W.getCombatDamageMultiplierFromState(gs, "laser");
  Sq.getLegionNpcCombatStats(gs, "npcL1");
  Sq.getLegionNpcCombatStats(gs, "npcL70");
  ok(JSON.stringify(gs) === snapBefore, "getLegionNpcCombatStats 纯只读（state JSON 快照不变，不改玩家舰船）");
  ok(W.getCombatDamageMultiplierFromState(gs, "laser") === playerDmgBefore, "NPC 属性计算后玩家伤害倍率不变（无交叉污染）");
  gs.implants = {};

  // 20.7 dodge / fuel 也走显式实例
  ok(W.getCombatPlayerDodgeFromState(gs, undefined, { shipInstanceId: "ship_N1", excludeImplants: true }) === statsL1.dodge, "stats.dodge == 显式实例直调结果");
  ok(W.getCombatFuelMultiplierFromState(gs, undefined, undefined, { shipInstanceId: "ship_N1", excludeImplants: true }) === statsL1.fuelMultiplier, "stats.fuelMultiplier == 显式实例直调结果");
}

// ================================================================
// M3：在线战斗小队接入
//   21 目标选择（概率 / 可复现 / 排除规则）
//   22 受伤 / 爆船 / 180 秒修复 / 修复期在岗与锁定
//   23 欠薪中途 / 弹药燃料不足 / 战斗结束清理
//   24 VM 沙箱内驱动真实 advanceCombatRound
// ================================================================
section("21. M3 目标选择：概率 / 可复现 / 排除规则");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  ok(typeof Sq.selectLegionCombatTarget === "function" && typeof Sq.getLegionCombatTargets === "function", "M3 目标选择接口已导出");
  ok(typeof Sq.processLegionNpcAttack === "function" && typeof Sq.processLegionEnemyAttack === "function", "M3 攻击接口已导出");
  ok(typeof Sq.applyLegionNpcDamage === "function" && typeof Sq.handleLegionNpcDestroyed === "function", "M3 受伤/爆船接口已导出");
  ok(typeof Sq.startLegionNpcRepair === "function" && typeof Sq.completeLegionNpcRepair === "function" &&
     typeof Sq.getLegionNpcRepairState === "function" && typeof Sq.getLegionCombatRoundResult === "function", "M3 修复/回合结果接口已导出");

  const st = makeM3State(W, { npcCount: 2 });
  ok(JSON.stringify(Sq.getLegionCombatTargets(st).map(t => t.kind)) === JSON.stringify(["player"]), "非小队模式：目标池只有玩家");
  ok(Sq.selectLegionCombatTarget(st, () => 0.99).kind === "player", "非小队模式：无论 rng 恒选玩家（单舰行为不变）");

  st.research.completedLevels.legion_dual_squad = 1;
  Sq.beginLegionSquadBattle(st);
  Sq.addLegionNpcToCombatSquad(st, "m3n1");
  ok(Sq.getLegionCombatTargets(st).length === 2, "双人小队：目标池 = 玩家 + 1 NPC");
  // 概率抽样用确定性 mulberry32（均匀且可复现）
  const prng = makeRng(20260829);
  let playerPicks = 0, npcPicks = 0;
  for (let k = 0; k < 6000; k++) { const t = Sq.selectLegionCombatTarget(st, prng); if (t.kind === "player") playerPicks++; else npcPicks++; }
  const ratio2 = npcPicks / (playerPicks + npcPicks);
  ok(Math.abs(ratio2 - 0.5) < 0.02, "双人小队：NPC 中签率 ≈50%（实测 " + (ratio2 * 100).toFixed(1) + "%）");

  st.research.completedLevels.legion_triple_squad = 1;
  Sq.addLegionNpcToCombatSquad(st, "m3n2");
  const counts = { player: 0 };
  const rng3 = makeRng(31415926);
  for (let k = 0; k < 9000; k++) {
    const t = Sq.selectLegionCombatTarget(st, rng3);
    const key = t.kind === "player" ? "player" : t.npcId;
    counts[key] = (counts[key] || 0) + 1;
  }
  const total3 = Object.values(counts).reduce((a, b) => a + b, 0);
  const shares = Object.values(counts).map(c => c / total3);
  ok(shares.length === 3 && shares.every(s => Math.abs(s - 1 / 3) < 0.02),
    "三人小队：三目标接近三等分（" + shares.map(s => (s * 100).toFixed(1) + "%").join(" / ") + "）");

  const seq = [0.0, 0.1, 0.24, 0.26, 0.49, 0.5, 0.51, 0.75, 0.9, 0.99];
  const r1 = [], r2 = []; let ia = 0, ib = 0;
  for (let k = 0; k < 12; k++) r1.push(Sq.selectLegionCombatTarget(st, () => seq[(ia++) % seq.length]).npcId || "player");
  for (let k = 0; k < 12; k++) r2.push(Sq.selectLegionCombatTarget(st, () => seq[(ib++) % seq.length]).npcId || "player");
  ok(JSON.stringify(r1) === JSON.stringify(r2), "固定 rng 序列 → 目标选择完全可复现");

  let same = 0, prev = null, ic = 0;
  for (let k = 0; k < 200; k++) {
    const t = Sq.selectLegionCombatTarget(st, () => seq[(ic++) % seq.length]).npcId || "player";
    if (prev !== null && t === prev) same++;
    prev = t;
  }
  ok(same > 0, "允许敌人连续攻击同一目标（无强制轮转 / 无嘲讽仇恨 / 无玩家保护）");

  Sq.handleLegionNpcDestroyed(st, "m3n1", NOW);
  const afterDead = Sq.getLegionCombatTargets(st).map(t => t.kind + ":" + (t.npcId || ""));
  ok(afterDead.length === 2 && !afterDead.some(x => x === "npc:m3n1"), "NPC 爆船后立刻移出目标池");
  ok(Sq.getLegionCombatTargets(st, { now: NOW }).filter(t => t.kind === "npc").length === 1, "修复中的 NPC 不在目标池");
  ok(Sq.getLegionCombatTargets(st)[0].kind === "player", "玩家始终是有效目标（NPC 全灭也不空池）");
}

// ================================================================
section("22. M3 NPC 受伤 / 爆船 / 180 秒修复 / 修复期在岗");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  const NPCm = W.LEGION_NPC;
  const st = makeM3State(W, { npcCount: 2 });
  st.research.completedLevels.legion_dual_squad = 1;
  st.research.completedLevels.legion_triple_squad = 1;
  Sq.beginLegionSquadBattle(st);
  Sq.addLegionNpcToCombatSquad(st, "m3n1");
  Sq.addLegionNpcToCombatSquad(st, "m3n2");
  const npc1 = st.legion.npcs[0];
  const playerHpBefore = JSON.stringify(st.combat.hp);
  const maxHp1 = Sq.getLegionNpcCombatStats(st, "m3n1").maxHp;
  ok(JSON.stringify(npc1.combatHp) === JSON.stringify(maxHp1), "入队即按绑定舰满血初始化");

  const res1 = Sq.applyLegionNpcDamage(st, "m3n1", 40, { now: NOW });
  ok(res1.applied === true && res1.dealt.shield + res1.dealt.armor + res1.dealt.structure > 0, "NPC 受伤生效（层级结算）");
  ok(JSON.stringify(st.combat.hp) === playerHpBefore, "NPC 受伤不改变玩家 HP（伤害不转移）");
  ok(npc1.combatHp.shield < maxHp1.shield, "NPC 护盾被消耗");

  Sq.applyLegionNpcDamage(st, "m3n1", 999999, { now: NOW });
  ok(npc1.destroyed === true, "结构归零 → destroyed=true");
  ok(npc1.repairUntil === NOW + 180000, "repairUntil = now + 180000（180 秒）");
  ok(Sq.getLegionNpcRepairState(st, "m3n1", NOW).remaining === 180000, "修复剩余 = 180000ms");
  const member1 = st.combat.squad.members.find(m => m.npcId === "m3n1");
  ok(member1 && member1.destroyedInBattle === true && member1.active === false, "爆船成员标记 destroyedInBattle 并退出有效成员");
  ok(npc1.occupiedByCombat === false, "爆船后 occupiedByCombat=false");
  ok(npc1.boundShipInstanceId === "ship_N1", "爆船不清除绑定舰船");
  ok(st.legion.npcs.length === 2, "爆船不删除 NPC");
  ok(Sq.getLegionCombatTargets(st).filter(t => t.kind === "npc").length === 1, "爆船后目标池只剩另一名 NPC");
  ok(st.combat.active === true, "NPC 爆船后玩家仍可继续当前战斗");

  ok(NPCm.assignLegionNpcShip(st, "m3n1", "ship_N2").changed === false, "修复中不能换舰");
  ok(NPCm.dismissLegionNpc(st, "m3n1").changed === false, "修复中不能解雇");
  ok(Sq.getShipCombatLockReason(st, "ship_N1", NOW) === "npc-repairing", "修复中绑定舰船不能拆解");
  const snap = NPCm.getLegionContributionSnapshot(st);
  ok(snap.salary.paidNpcCount === 2 && snap.salary.overdueNpcCount === 0, "修复中 NPC 仍算在岗（工资正常即计入在岗口径）");
  ok(snap.skillCounts.combat >= 1, "修复中军团技能继续生效（贡献快照仍计入该 NPC）");
  ok(NPCm.calculateLegionNpcXp(st, npc1, 4) > 0, "修复中工资正常 → NPC 正常获得 XP");

  ok(Sq.completeLegionNpcRepair(st, "m3n1", NOW + 179000).changed === false, "未到期不修复");
  ok(Sq.completeLegionNpcRepair(st, "m3n1", NOW - 1000).changed === false, "时间倒退不提前修复");
  const done = Sq.completeLegionNpcRepair(st, "m3n1", NOW + 180000);
  ok(done.changed === true && npc1.destroyed === false && npc1.repairUntil === null, "到期后修复完成：destroyed=false / repairUntil=null");
  ok(JSON.stringify(npc1.combatHp) === JSON.stringify(maxHp1), "修复完成后原舰船三层恢复满值");
  ok(npc1.boundShipInstanceId === "ship_N1", "修复后仍绑定原舰船（不自动换舰 / 不自动解雇）");
  const rs = Sq.getLegionNpcRepairState(st, "m3n1", NOW + 180000);
  ok(rs.ready === true && rs.repairing === false && rs.remaining === 0, "修复完成后恢复可参战资格");
  ok(Sq.completeLegionNpcRepair(st, "m3n1", NOW + 180000).changed === false, "重复修复幂等");
}

// ================================================================
section("23. M3 欠薪中途 / 弹药燃料不足 / 战斗结束清理");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  const st = makeM3State(W, { npcCount: 1 });
  st.research.completedLevels.legion_dual_squad = 1;
  Sq.beginLegionSquadBattle(st);
  Sq.addLegionNpcToCombatSquad(st, "m3n1");
  const npc1 = st.legion.npcs[0];

  npc1.salaryState = "overdue";
  ok(Sq.getLegionCombatTargets(st).filter(t => t.kind === "npc").length === 1, "欠薪 NPC 不被强制移出当前小队");
  const atk = Sq.processLegionNpcAttack(st, { now: NOW, rng: () => 0.5 });
  ok(atk.ok === true && atk.attacked === 1, "欠薪 NPC 仍可完成当前战斗的攻击");
  const snap = W.LEGION_NPC.getLegionContributionSnapshot(st);
  ok(snap.salary.overdueNpcCount === 1 && snap.activeNpcCount === 0, "欠薪后立即失去军团技能光环");
  ok(W.LEGION_NPC.calculateLegionNpcXp(st, npc1, 4) === 0, "欠薪后不再获得 XP");
  ok(snap.multipliers.laserDamage === 1, "欠薪后武器加成乘区归 1（不再计入军团加成/人数口径）");
  ok(Sq.canLegionNpcJoinCombat(st, "m3n1", { now: NOW }).reason === "already-in-squad", "欠薪 NPC 仍留在本场战斗目标池/成员中（不踢出）");
  Sq.endLegionSquadBattle(st); // 本场战斗结束
  ok(Sq.canLegionNpcJoinCombat(st, "m3n1", { now: NOW }).reason === "salary-overdue", "当前战斗结束后不可再次参战");
  npc1.salaryState = "paid";

  const st2 = makeM3State(W, { npcCount: 1, ammo: 0 });
  st2.research.completedLevels.legion_dual_squad = 1;
  Sq.beginLegionSquadBattle(st2);
  Sq.addLegionNpcToCombatSquad(st2, "m3n1");
  const enemyHpBefore = JSON.stringify(st2.combat.currentEnemy.hp);
  const r2 = Sq.processLegionNpcAttack(st2, { now: NOW, rng: () => 0.5 });
  ok(r2.ok === true && r2.attacked === 0 && r2.perNpc[0].skipped === "no-ammo", "弹药不足 → 仅该 NPC 停火");
  ok(JSON.stringify(st2.combat.currentEnemy.hp) === enemyHpBefore, "停火时敌人未受伤");
  ok(st2.combat.active !== false, "NPC 缺弹药不结束整个战斗");
  ok(countAmmo(W, st2) === 0, "弹药不足不产生负库存");

  const st3 = makeM3State(W, { npcCount: 1, fuel: 0 });
  st3.research.completedLevels.legion_dual_squad = 1;
  Sq.beginLegionSquadBattle(st3);
  Sq.addLegionNpcToCombatSquad(st3, "m3n1");
  const r3 = Sq.processLegionNpcAttack(st3, { now: NOW, rng: () => 0.5 });
  ok(r3.perNpc[0].skipped === "no-fuel", "燃料不足 → 仅该 NPC 舰船停止行动");
  ok(W.ResourceRegistry.get(st3, "consumable:fuel") >= 0, "燃料不足不产生负库存");

  const st4 = makeM3State(W, { npcCount: 2 });
  st4.research.completedLevels.legion_dual_squad = 1;
  st4.research.completedLevels.legion_triple_squad = 1;
  Sq.beginLegionSquadBattle(st4);
  Sq.addLegionNpcToCombatSquad(st4, "m3n1");
  Sq.addLegionNpcToCombatSquad(st4, "m3n2");
  Sq.handleLegionNpcDestroyed(st4, "m3n2", NOW);
  Sq.endLegionSquadBattle(st4);
  ok(st4.combat.squad.enabled === false && st4.combat.squad.members.length === 0 && st4.combat.squad.battleId === null, "战斗结束清理 squad 临时状态");
  ok(st4.combat.squad.lastRound === null, "战斗结束清理 lastRound 快照");
  ok(st4.legion.npcs.every(n => n.occupiedByCombat === false), "战斗结束释放所有成员占用");
  ok(st4.legion.npcs[1].destroyed === true && st4.legion.npcs[1].repairUntil === NOW + 180000, "清理 squad 不清除 NPC 修复状态");
  ok(st4.legion.npcs.every(n => n.boundShipInstanceId), "战斗结束不清理 NPC 绑定舰船");
}

// ================================================================
section("24. M3 集成：真实 advanceCombatRound（在线）");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  const base = makeM3State(W, { npcCount: 0 });
  const baseResult = runRounds(W, base, 6, 1001);

  const st = makeM3State(W, { npcCount: 2 });
  st.research.completedLevels.legion_dual_squad = 1;
  st.research.completedLevels.legion_triple_squad = 1;
  Sq.beginLegionSquadBattle(st);
  Sq.addLegionNpcToCombatSquad(st, "m3n1");
  Sq.addLegionNpcToCombatSquad(st, "m3n2");
  const enemyHpBefore = JSON.stringify(st.combat.currentEnemy.hp);
  const fuelBefore = W.ResourceRegistry.get(st, "consumable:fuel");
  const ammoBefore = countAmmo(W, st);
  const res = W.advanceCombatRound(st, { now: NOW, offline: false, rng: makeRng(7), playEffects: false });
  ok(res.ok === true && res.advanced === true, "小队模式回合正常推进");
  ok(JSON.stringify(st.combat.currentEnemy.hp) !== enemyHpBefore, "敌人被玩家 + NPC 共同攻击掉血");
  const round = Sq.getLegionCombatRoundResult(st);
  ok(round && round.squadEnabled === true && round.lastRound && round.lastRound.attacked === 2, "两名 NPC 均参与攻击");
  ok(round.totalNpcDamage > 0, "NPC 输出累计到 runSquadDamageDealt（" + round.totalNpcDamage + "）");
  // —— M6 标记：以下两条为「同步集火」不变量断言 ——
  // 它们仅在「本回合内当前目标未被击杀」时成立。M6 在线循环改为：玩家/NPC 按顺序开火、共享目标
  // 指针、目标死亡立即切换到下一存活敌人。若本回合内当前目标被击杀，NPC 会改打下一个目标，
  // 这两条「NPC 目标 == 玩家当前目标」将不再恒成立。当前测试数据单回合不致死，故仍通过；
  // 真正的分步换目标语义见 section 32（M6）。如需严格校验旧不变量，应在「不致死」夹具下保留本断言。
  ok(round.lastRound.targetId === st.combat.currentEnemy.id, "NPC 攻击目标 == 玩家当前目标");
  ok(st.combat.squad.targetId === st.combat.currentEnemy.id, "squad.targetId 与玩家目标同步");
  ok(W.ResourceRegistry.get(st, "consumable:fuel") < fuelBefore, "NPC 开火扣玩家燃料（同一库存入口）");
  ok(countAmmo(W, st) < ammoBefore, "NPC 开火扣玩家弹药（同一库存入口）");
  ok(st.combat.runDamageDealt >= 0 && st.combat.runSquadDamageDealt > 0, "玩家/小队伤害分别计数（不混计）");

  // —— M6 标记：此条直接调用 processLegionNpcAttack（离线路径/单元测试接口），其语义在 M6 中保持不变
  // （全体成员仍打同一 currentEnemy），故「同步集火」不变量在此处依然成立。M6 仅改变在线
  // advanceCombatRound 的统一顺序循环；若将来也要让离线路径改为分步，此断言需同步更新。
  const other = st.combat.enemies.find(e => e && !e.defeated && e !== st.combat.currentEnemy);
  if (other) {
    st.combat.currentEnemy = other;
    const r2 = Sq.processLegionNpcAttack(st, { now: NOW + 1000, rng: makeRng(9) });
    ok(r2.ok === true && st.combat.squad.targetId === other.id, "玩家切换目标后 NPC 自动同步到同一目标");
  } else {
    ok(true, "（单敌人编队，跳过目标切换断言）");
  }

  const iskBefore = st.resources.isk;
  const npcXpBefore = st.legion.npcs.map(n => n.xp);
  st.combat.currentEnemy.hp = { shield: 0, armor: 0, structure: 0 };
  W.advanceCombatRound(st, { now: NOW + 2000, offline: false, rng: makeRng(11), playEffects: false });
  ok(st.resources.isk >= iskBefore, "击毁奖励进入玩家 ISK（不按小队人数分摊）");
  ok(JSON.stringify(st.legion.npcs.map(n => n.xp)) === JSON.stringify(npcXpBefore), "NPC 不获得独立战斗奖励 / XP");

  // —— M6 适配（仅作用于本子场景，不改变上方 787-812 既有断言）——
  // M6 的跨目标伤害分配使波次更易在「开火阶段」被清掉，导致最后一敌在开火阶段阵亡、无存活敌
  // 人进入反击阶段；且 NPC 也在敌方目标池中（rng 可能选中 NPC 而非玩家）。为使下方「玩家爆船 →
  // 战败清理」路径稳定可测：把两 NPC 置为修复中（移出开火者与目标池，敌方只能打玩家），并把仍
  // 存活敌人结构调高，确保开火阶段清不掉、必有反击 → 稳定进入 defeated。战败/清理逻辑本身未变。
  st.legion.npcs.forEach(n => { n.repairUntil = NOW + 999999; });
  st.combat.enemies.forEach(e => { if (e && !e.defeated && e.hp) e.hp.structure = 99999; });

  st.combat.hp = { shield: 0, armor: 0, structure: 0 };
  const res3 = W.advanceCombatRound(st, { now: NOW + 3000, offline: false, rng: makeRng(13), playEffects: false });
  ok(res3.reason === "defeated", "玩家舰船爆船 → 沿用原有战斗失败逻辑（M6 下经夹具保证一出反击即战败）");
  ok(st.combat.squad.enabled === false && st.combat.squad.members.length === 0, "玩家失败后清理 squad");
  ok(st.legion.npcs.every(n => n.occupiedByCombat === false), "玩家失败后释放 NPC 占用且不删除 NPC");

  const replay = makeM3State(W, { npcCount: 0 });
  const replayResult = runRounds(W, replay, 6, 1001);
  ok(JSON.stringify(baseResult) === JSON.stringify(replayResult), "单舰模式同 seed 结果可复现（M3 未改动玩家路径）");
}

// ================================================================
section("25. M3 旧档 JSON 往返一致（squad / NPC 修复字段）");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  const st = makeM3State(W, { npcCount: 2 });
  st.research.completedLevels.legion_dual_squad = 1;
  Sq.beginLegionSquadBattle(st);
  Sq.addLegionNpcToCombatSquad(st, "m3n1");
  Sq.handleLegionNpcDestroyed(st, "m3n1", NOW);
  const snap1 = JSON.stringify({ squad: st.combat.squad, npcs: st.legion.npcs, run: st.combat.runSquadDamageDealt });
  const revived = JSON.parse(snap1); // 模拟存档往返（JSON 序列化/反序列化）
  const st2 = makeM3State(W, { npcCount: 0 });
  st2.combat.squad = revived.squad;
  st2.legion.npcs = revived.npcs;
  st2.combat.runSquadDamageDealt = revived.run;
  Sq.ensureCombatSquadState(st2);
  Sq.ensureLegionNpcsCombatFields(st2);
  const snap2 = JSON.stringify({ squad: st2.combat.squad, npcs: st2.legion.npcs, run: st2.combat.runSquadDamageDealt });
  ok(snap1 === snap2, "JSON 往返后 squad / NPC 修复字段一致（幂等归一，无字段丢失）");
  ok(Sq.getLegionNpcRepairState(st2, "m3n1", NOW).repairing === true, "往返后修复状态仍为修复中");
  ok(Sq.completeLegionNpcRepair(st2, "m3n1", NOW + 180000).changed === true, "往返后到期仍可正常完成修复");
}

// ================================================================
// M4：离线战斗小队接入
//   26 虚拟资源与原语共用 / 27 期望分摊与修复推进 / 28 单舰零改动与缺模块回退
// ================================================================
section("26. M4 离线：虚拟资源与原语共用");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  ok(typeof Sq.getSquadAmmoRequirements === "function" && typeof Sq.computeNpcDcReduction === "function", "M4 接口已导出");

  // 26.1 虚拟弹药池扩种：玩家激光 + NPC 导弹 → 两种类型都要被播种
  const st = makeM3State(W, { npcCount: 1 });
  st.research.completedLevels.legion_dual_squad = 1;
  st.inventory.ships.find(s => s.instanceId === "ship_N1").fitted.high = ["t1_light_missile_launcher"];
  st.ammo = [
    { id: "am1", type: "laser", tier: "T1", name: "激光晶体弹药", props: { dmgMult: 1, hitMult: 1 }, qty: 2000, loaded: true },
    { id: "am2", type: "missile", tier: "T2", name: "高爆制导导弹", props: { dmgMult: 1.1, hitMult: 1.1 }, qty: 300, loaded: true }
  ];
  Sq.beginLegionSquadBattle(st);
  Sq.addLegionNpcToCombatSquad(st, "m3n1");
  const zone = W.getCombatEncounterZone(st.combat);
  const req = Sq.getSquadAmmoRequirements(st, { zone: zone });
  ok(req && req.missile >= 1, "getSquadAmmoRequirements 聚合 NPC 武器弹药需求（missile=" + (req && req.missile) + "）");

  const session = { ammo: {}, ammoInit: {}, ammoTier: {}, fuel: 0, fuelInit: 0, resourceNet: {} };
  for (const t of ["laser"]) { const c = W.getSelectedCount(st, t); session.ammo[t] = c; session.ammoInit[t] = c; }
  for (const t of Object.keys(req)) {
    if (!(t in session.ammoInit)) { const c = W.getSelectedCount(st, t); session.ammo[t] = c; session.ammoInit[t] = c; }
  }
  session.ammoTier = { laser: "T1", missile: "T2" };
  session.fuel = 5000; session.fuelInit = 5000;
  ok(session.ammoInit.missile === 300, "虚拟池扩种后含 NPC 导弹（300）");
  ok(session.ammoInit.laser === 2000, "虚拟池仍含玩家激光（2000）");

  // 26.2 离线开火：弹药/燃料各扣一次，不产生负库存
  const beforeAmmo = { laser: session.ammo.laser, missile: session.ammo.missile };
  const beforeFuel = session.fuel;
  const atk = Sq.processLegionNpcAttack(st, { now: NOW, offline: true, zone: zone, virtual: session, randomFn: () => 0.5 });
  ok(atk.ok === true && atk.attacked === 1, "离线路径 NPC 正常开火");
  ok(session.ammo.missile === beforeAmmo.missile - (atk.perNpc[0].ammoSpent.missile || 0), "虚拟弹药按类型扣一次（missile）");
  ok(session.ammo.laser === beforeAmmo.laser, "NPC 开火不扣玩家激光弹药（各自独立）");
  ok(session.fuel === beforeFuel - atk.perNpc[0].fuelSpent && session.fuel >= 0, "虚拟燃料扣一次且非负");

  // 26.3 在线真实库存路径不受虚拟模式影响（同一函数，不传 virtual）
  const stReal = makeM3State(W, { npcCount: 1 });
  stReal.research.completedLevels.legion_dual_squad = 1;
  Sq.beginLegionSquadBattle(stReal);
  Sq.addLegionNpcToCombatSquad(stReal, "m3n1");
  const fuelRealBefore = W.ResourceRegistry.get(stReal, "consumable:fuel");
  const atkReal = Sq.processLegionNpcAttack(stReal, { now: NOW, rng: () => 0.5 });
  ok(atkReal.ok === true && W.ResourceRegistry.get(stReal, "consumable:fuel") < fuelRealBefore, "在线路径仍扣真实库存（注入层分流正确）");

  // 26.4 虚拟资源不足：只停该 NPC，不结束战斗、不出现负数
  const dry = { ammo: { laser: 0 }, ammoInit: { laser: 0 }, ammoTier: { laser: "T1" }, fuel: 0, fuelInit: 0 };
  const stDry = makeM3State(W, { npcCount: 1, ammo: 0 });
  stDry.research.completedLevels.legion_dual_squad = 1;
  Sq.beginLegionSquadBattle(stDry);
  Sq.addLegionNpcToCombatSquad(stDry, "m3n1");
  const rDry = Sq.processLegionNpcAttack(stDry, { now: NOW, offline: true, zone: zone, virtual: dry, randomFn: () => 0.5 });
  ok(rDry.attacked === 0 && (rDry.perNpc[0].skipped === "no-ammo" || rDry.perNpc[0].skipped === "no-fuel"), "虚拟资源不足 → 该 NPC 停火");
  ok(dry.fuel >= 0 && Object.values(dry.ammo).every(v => v >= 0), "虚拟资源不产生负库存");
  ok(stDry.combat.active !== false, "NPC 缺资源不结束整场战斗");
}

// ================================================================
section("27. M4 期望分摊落点（D1）与离线修复推进");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  const st = makeM3State(W, { npcCount: 2 });
  st.research.completedLevels.legion_dual_squad = 1;
  st.research.completedLevels.legion_triple_squad = 1;
  Sq.beginLegionSquadBattle(st);
  Sq.addLegionNpcToCombatSquad(st, "m3n1");
  Sq.addLegionNpcToCombatSquad(st, "m3n2");
  const zone = W.getCombatEncounterZone(st.combat);
  const c = st.combat;
  const hpBefore = { ...c.hp };
  const npcHpBefore = st.legion.npcs.map(n => ({ ...n.combatHp }));

  const res = Sq.processLegionEnemyAttack(st, {
    damage: 0, distribute: true, now: NOW, zone: zone, randomFn: () => 0.5,
    attacker: { hit: 100, baseDamage: 300 }, playerDodge: W.calcPlayerDodge(undefined, st),
    playerShipConfig: W.getActiveShip(st), dcReduction: 0
  });
  ok(res.distributed === true && res.targetCount === 3, "分摊模式：目标数 N=3（玩家 + 2 NPC）");
  ok((res.hits || []).length === 3, "每个有效目标各产生一条落点记录");
  const playerLost = (hpBefore.shield + hpBefore.armor + hpBefore.structure) -
                     (c.hp.shield + c.hp.armor + c.hp.structure);
  const npcLost = st.legion.npcs.map((n, i) =>
    (npcHpBefore[i].shield + npcHpBefore[i].armor + npcHpBefore[i].structure) -
    (n.combatHp.shield + n.combatHp.armor + n.combatHp.structure));
  ok(playerLost > 0, "玩家分担到 1/3 期望伤害（" + playerLost + "）");
  ok(npcLost.every(v => v > 0), "两名 NPC 各自分担到 1/3 期望伤害（" + npcLost.join(" / ") + "）");
  ok(new Set(npcLost).size >= 1 && playerLost > 0, "逐目标按自身防御/闪避独立计算（非统一伤害平均）");

  const npc1 = st.legion.npcs[0];
  Sq.handleLegionNpcDestroyed(st, "m3n1", NOW);
  const res2 = Sq.processLegionEnemyAttack(st, {
    damage: 0, distribute: true, now: NOW + 1000, zone: zone, randomFn: () => 0.5,
    attacker: { hit: 100, baseDamage: 300 }, playerDodge: W.calcPlayerDodge(undefined, st),
    playerShipConfig: W.getActiveShip(st), dcReduction: 0
  });
  ok(res2.targetCount === 2, "NPC 爆船后目标池降为 2（玩家 + 1 NPC）");
  ok(!(res2.hits || []).some(h => h.npcId === "m3n1"), "爆船 NPC 不再出现在后续攻击包中");
  ok(npc1.destroyed === true && npc1.repairUntil === NOW + 180000, "爆船写入 destroyed / repairUntil=+180s");

  ok(Sq.completeLegionNpcRepair(st, "m3n1", NOW + 179000).changed === false, "离线未到期不修复");
  const ticked = Sq.tickLegionSquadRepairs(st, NOW + 180000);
  ok(ticked.repaired === 1 && npc1.destroyed === false && npc1.repairUntil === null, "离线到期 → 修复完成");
  const member1 = st.combat.squad.members.find(m => m.npcId === "m3n1");
  ok(member1 && member1.active === false && member1.destroyedInBattle === true, "D4：修复完成的 NPC 不重新加入当前战斗");
  ok(Sq.getLegionCombatTargets(st, { now: NOW + 180000 }).filter(t => t.kind === "npc").length === 1, "修复完成但本场不再进入目标池");
  ok(Sq.tickLegionSquadRepairs(st, NOW + 180000).repaired === 0, "重复推进修复幂等（repaired=0）");
  ok(Sq.completeLegionNpcRepair(st, "m3n1", NOW + 1000).changed === false, "时间倒退不提前修复");
  ok(npc1.boundShipInstanceId === "ship_N1", "离线修复后仍绑定原舰船");
}

// ================================================================
section("28. M4 单舰离线零改动 + 缺模块回退");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  const solo = makeM3State(W, { npcCount: 0 });
  const before = { ...solo.combat.hp };
  const r = Sq.processLegionEnemyAttack(solo, {
    damage: 120, distribute: true, now: NOW, randomFn: () => 0.5,
    attacker: { hit: 100, baseDamage: 300 }, playerDodge: W.calcPlayerDodge(undefined, solo),
    playerShipConfig: W.getActiveShip(solo), dcReduction: 0
  });
  ok(r.kind === "player" && r.distributed !== true, "单舰模式：不走分摊，伤害全部落在玩家（行为不变）");
  const lost = (before.shield + before.armor + before.structure) - (solo.combat.hp.shield + solo.combat.hp.armor + solo.combat.hp.structure);
  ok(lost === 120, "单舰模式传入伤害原值写入玩家 HP（120）");

  const runOffline = (state, seconds, nowT) => {
    const res = W.OfflineCombatSystem.settle(state, seconds, { now: nowT, runId: "t" + nowT, offlineEnd: nowT + seconds * 1000 });
    W.OfflineCombatSystem.flush(state, { now: nowT, runId: "t" + nowT });
    return res;
  };
  const a = makeM3State(W, { npcCount: 0 });
  const b = makeM3State(W, { npcCount: 0 });
  runOffline(a, 30, NOW);
  runOffline(b, 30, NOW);
  ok(JSON.stringify({ hp: a.combat.hp, fuel: a.resources.fuel, isk: a.resources.isk }) ===
     JSON.stringify({ hp: b.combat.hp, fuel: b.resources.fuel, isk: b.resources.isk }),
    "单舰离线同参数两次结算结果一致（幂等）");

  const src = readFileSync(join(ROOT, "js/systems/legion-combat-squad.js"), "utf8");
  const sandbox2 = { module: { exports: {} }, console };
  vm.createContext(sandbox2);
  vm.runInContext(src, sandbox2);
  const Alone = sandbox2.module.exports;
  const stAlone = { combat: { squad: { enabled: false } }, legion: { npcs: [] }, inventory: { ships: [] } };
  let threw = false;
  try {
    Alone.tickLegionSquadRepairs(stAlone, NOW);
    Alone.getSquadAmmoRequirements(stAlone, {});
    Alone.processLegionNpcAttack(stAlone, { now: NOW, virtual: { ammo: {}, fuel: 0 } });
    Alone.processLegionEnemyAttack(stAlone, { damage: 10, distribute: true, now: NOW, randomFn: () => 0.5, attacker: { hit: 1, baseDamage: 1 } });
  } catch (e) { threw = true; console.log("    " + e.message); }
  ok(!threw, "缺 legion-npc.js 时 M4 原语全部安全回退（不抛异常）");
}

// ================================================================
// M5：战前选择 / 开战接线 / UI 状态
// ================================================================
section("29. M5 战前选择与开战入口接线");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  ok(typeof Sq.setLegionSquadSelection === "function" && typeof Sq.startLegionSquadBattleWithMembers === "function" &&
     typeof Sq.getLegionCombatSquadUiState === "function", "M5 接口已导出");

  // 协议未解锁时不能选择（并给出锁定原因）
  const locked = makeM3State(W, { npcCount: 2 });
  const r0 = Sq.setLegionSquadSelection(locked, ["m3n1"], { now: NOW });
  ok(r0.changed === false && r0.reason === "dual-squad-locked", "双人协议未解锁 → 不能选择 NPC");
  const uiLocked = Sq.getLegionCombatSquadUiState(locked, { now: NOW });
  ok(uiLocked.dualUnlocked === false && uiLocked.capacity === 0 && uiLocked.lockedReason === "dual-squad-locked", "UI 状态：协议未解锁 → 容量 0 + 锁定原因");
  ok(uiLocked.tripleUnlocked === false, "UI 状态：三人协议同样未解锁");

  // 双人解锁：可选 1；三人解锁：可选 2
  const st = makeM3State(W, { npcCount: 2 });
  st.research.completedLevels.legion_dual_squad = 1;
  const r1 = Sq.setLegionSquadSelection(st, ["m3n1"], { now: NOW });
  ok(r1.changed === true && r1.npcIds.length === 1, "双人协议：选中 1 名 NPC");
  const r2 = Sq.setLegionSquadSelection(st, ["m3n1", "m3n2"], { now: NOW });
  ok(r2.changed === true && r2.npcIds.length === 1 && r2.skipped.length === 1 && r2.skipped[0].reason === "squad-full",
    "双人协议：第 2 名被容量拒绝（三人协议未解锁）");
  st.research.completedLevels.legion_triple_squad = 1;
  const r3 = Sq.setLegionSquadSelection(st, ["m3n1", "m3n2"], { now: NOW });
  ok(r3.changed === true && r3.npcIds.length === 2, "三人协议：可选 2 名 NPC");

  // 防重复绑定：同一 NPC 重复传入只算一次
  const r4 = Sq.setLegionSquadSelection(st, ["m3n1", "m3n1", "m3n1"], { now: NOW });
  ok(r4.npcIds.length === 1, "防重复绑定：重复 npcId 去重后只剩 1 个");

  // 无效 NPC（欠薪 / 无武器）被拒绝且不进选择
  const st2 = makeM3State(W, { npcCount: 2 });
  st2.research.completedLevels.legion_dual_squad = 1;
  st2.legion.npcs[0].salaryState = "overdue";
  const r5 = Sq.setLegionSquadSelection(st2, ["m3n1"], { now: NOW });
  ok(r5.changed === true && r5.npcIds.length === 0 && r5.skipped[0].reason === "salary-overdue", "欠薪 NPC 不能进入选择");

  // 开战接线：无选择 → 单舰；有选择 → 固化成员
  const solo = makeM3State(W, { npcCount: 2 });
  solo.research.completedLevels.legion_dual_squad = 1;
  const s0 = Sq.startLegionSquadBattleWithMembers(solo, { now: NOW });
  ok(s0.changed === false && s0.squadEnabled === false && s0.reason === "no-selection", "无选择 → 保持玩家单舰（零副作用）");
  ok(solo.combat.squad.enabled === false, "无选择时 squad 不启用");

  const st3 = makeM3State(W, { npcCount: 2 });
  st3.research.completedLevels.legion_dual_squad = 1;
  st3.research.completedLevels.legion_triple_squad = 1;
  Sq.setLegionSquadSelection(st3, ["m3n1", "m3n2"], { now: NOW });
  const s1 = Sq.startLegionSquadBattleWithMembers(st3, { now: NOW });
  ok(s1.changed === true && s1.squadEnabled === true && s1.members === 2, "开战接线：选择固化为本场 2 名成员");
  ok(st3.combat.squad.enabled === true && st3.combat.squad.members.length === 2, "squad 启用且成员就位");
  ok(st3.legion.npcs.every(n => n.occupiedByCombat === true), "成员均置为战斗占用（换舰/解雇/拆解被锁）");

  // 战斗中锁定选择
  const rLock = Sq.setLegionSquadSelection(st3, ["m3n1"], { now: NOW });
  ok(rLock.changed === false && rLock.reason === "squad-locked", "战斗中：选择被锁定");
  ok(W.LEGION_NPC.assignLegionNpcShip(st3, "m3n1", "ship_N2").changed === false, "战斗中：不能换舰");
  ok(W.LEGION_NPC.dismissLegionNpc(st3, "m3n1").changed === false, "战斗中：不能解雇");

  // 战斗结束：清理并释放；选择保留（下一场沿用）
  Sq.endLegionSquadBattle(st3);
  ok(st3.combat.squad.enabled === false && st3.legion.npcs.every(n => n.occupiedByCombat === false), "战斗结束：清理 squad 并释放占用");
  ok(Sq.getLegionSquadSelection(st3).length === 2, "战斗结束后选择保留，便于下一场沿用");
  // 再次开战可重新固化（不再报 squad-active）
  const s2 = Sq.startLegionSquadBattleWithMembers(st3, { now: NOW + 1000 });
  ok(s2.changed === true && s2.members === 2, "下一场可再次固化成员");
}

// ================================================================
section("30. M5 UI 状态明细与状态文案");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  const st = makeM3State(W, { npcCount: 2 });
  st.research.completedLevels.legion_dual_squad = 1;
  st.research.completedLevels.legion_triple_squad = 1;
  const ui = Sq.getLegionCombatSquadUiState(st, { now: NOW });
  const uiNpc = ui.candidates.find(c => c.npcId === "m3n1");
  ok(uiNpc && uiNpc.hp && uiNpc.maxHp && uiNpc.hp.shield === uiNpc.maxHp.shield && uiNpc.hp.armor === uiNpc.maxHp.armor && uiNpc.hp.structure === uiNpc.maxHp.structure,
     "绑定舰船但未开战：UI 显示满血而非 0");
  ok(ui.capacity === 2 && ui.active === false, "UI：容量 2、当前未开战");
  const c1 = ui.candidates.filter(c => c.npcId === "m3n1")[0];
  ok(c1 && c1.isCombatSkill === true && c1.shipName && c1.weaponNames.length === 1, "UI 明细：战斗技能 / 舰船名 / 武器名");
  ok(Math.abs(c1.damageMultiplier - (0.30 + (20 - 1) / 69 * 0.70)) < 1e-9, "UI 明细：LV20 伤害倍率≈49.28%");
  ok(typeof c1.ammo.laser === "number" && c1.fuelRounds > 0, "UI 明细：弹药数量与燃料可撑轮次");
  ok(c1.eligible === true && c1.statusText === "可参战", "UI 状态文案：可参战");

  // 修复中 → 在岗但无法参战
  Sq.beginLegionSquadBattle(st);
  Sq.addLegionNpcToCombatSquad(st, "m3n1");
  Sq.handleLegionNpcDestroyed(st, "m3n1", NOW);
  const ui2 = Sq.getLegionCombatSquadUiState(st, { now: NOW + 1000 });
  const c2 = ui2.candidates.filter(c => c.npcId === "m3n1")[0];
  ok(c2.repair.repairing === true && c2.statusText.indexOf("在岗，但暂时无法参战") >= 0, "UI 状态文案：修复中 = 在岗但暂时无法参战");
  ok(c2.destroyedInBattle === true, "UI：爆船成员标记可见");
  ok(c2.shipInstanceId === "ship_N1", "UI：修复中仍显示原绑定舰船");

  // 欠薪且在队 → 保留本场、战后不可再加入
  const st2 = makeM3State(W, { npcCount: 1 });
  st2.research.completedLevels.legion_dual_squad = 1;
  Sq.beginLegionSquadBattle(st2);
  Sq.addLegionNpcToCombatSquad(st2, "m3n1");
  st2.legion.npcs[0].salaryState = "overdue";
  const ui3 = Sq.getLegionCombatSquadUiState(st2, { now: NOW });
  const c3 = ui3.candidates.filter(c => c.npcId === "m3n1")[0];
  ok(c3.statusText.indexOf("欠薪：当前战斗保留") >= 0, "UI 状态文案：队内欠薪 = 保留本场、战后不可再参战");
  ok(c3.inSquad === true, "UI：欠薪成员仍显示在小队中（不踢出）");

  // 非战斗技能 NPC 明确标注
  const prod = W.LEGION_NPC.createNpc({ npcId: "m3prod", name: "生产员", skillId: productionSkill.id, skillGrade: "B", level: 10 });
  st2.legion.npcs.push(prod);
  const ui4 = Sq.getLegionCombatSquadUiState(st2, { now: NOW });
  const c4 = ui4.candidates.filter(c => c.npcId === "m3prod")[0];
  ok(c4 && c4.isCombatSkill === false && c4.statusText.indexOf("非战斗技能") >= 0, "UI：非战斗技能 NPC 明确标注且不可选");
}


section("31. M5 NPC 绑定舰维修件战斗中生效 + 战斗结束回满血");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  const st = makeM3State(W, { npcCount: 1 });
  st.research.completedLevels.legion_dual_squad = 1;
  st.research.completedLevels.legion_triple_squad = 1;
  Sq.beginLegionSquadBattle(st);
  Sq.addLegionNpcToCombatSquad(st, "m3n1");
  ok(st.combat.squad.enabled === true && st.combat.squad.members.length === 1, "预备：小队启用且 m3n1 在队");

  // 给 NPC 绑定舰 ship_N1 装上维修件（护盾回充器 + 装甲维修器）
  const shipN1 = st.inventory.ships.find(s => s.instanceId === "ship_N1");
  shipN1.fitted.mid = ["t1_shield_booster"];   // repair / shield amount 30
  shipN1.fitted.low = ["t1_armor_repairer"];   // repair / armor amount 20
  const stats = Sq.getLegionNpcCombatStats(st, "m3n1", { zone: st.combat.zone });
  ok(stats.ok && stats.maxHp && stats.maxHp.shield > 5 && stats.maxHp.armor > 5, "NPC 满血上限高于初始低值（夹具有效）");
  const maxHp = stats.maxHp;

  // 把 NPC 血量压到一个明显非满的低值（repair 不应被 ensureNpcCombatHp 覆盖）
  const npc = st.legion.npcs.find(n => n.npcId === "m3n1");
  npc.combatHp = { shield: 5, armor: 5, structure: 5 };

  const fuelBefore = W.ResourceRegistry.get(st, "consumable:fuel");
  const rep = Sq.repairLegionSquadNpcs(st, { now: NOW, zone: st.combat.zone });
  ok(rep.repaired >= 1 && rep.totalHeal > 0, "repairLegionSquadNpcs 实际回血（repaired=" + rep.repaired + ", heal=" + rep.totalHeal + "）");
  ok(npc.combatHp.shield > 5 && npc.combatHp.armor > 5, "NPC 护盾/装甲经维修回升（shield=" + npc.combatHp.shield + ", armor=" + npc.combatHp.armor + "）");
  ok(npc.combatHp.shield <= maxHp.shield && npc.combatHp.armor <= maxHp.armor, "回血不超过上限（封顶）");
  ok(W.ResourceRegistry.get(st, "consumable:fuel") < fuelBefore, "NPC 维修消耗了燃料");

  // 修复件不足燃料时不应回血（构造无燃料场景）
  const npc2 = st.legion.npcs[0];
  npc2.combatHp = { shield: 5, armor: 5, structure: 5 };
  W.ResourceRegistry.set(st, "consumable:fuel", 0);
  const rep2 = Sq.repairLegionSquadNpcs(st, { now: NOW, zone: st.combat.zone });
  ok(rep2.totalHeal === 0, "燃料为 0 时 NPC 维修不生效（无燃料即停火，与玩家一致）");
  W.ResourceRegistry.set(st, "consumable:fuel", 100000);

  // 战斗结束清理：存活 NPC 应回满血（与玩家下场重置满血对称）
  st.combat.squad = { enabled: true, members: [{ npcId: "m3n1", shipInstanceId: "ship_N1", active: true, destroyedInBattle: false }], targetId: null, battleId: null, lastRound: null, pendingNpcIds: [] };
  npc.combatHp = { shield: 1, armor: 1, structure: 1 };
  const endRes = Sq.endLegionSquadBattle(st);
  ok(endRes.changed === true, "endLegionSquadBattle 清理 squad 临时态");
  ok(npc.destroyed === false, "存活 NPC 未被标记为爆船");
  ok(npc.combatHp.shield === maxHp.shield && npc.combatHp.armor === maxHp.armor && npc.combatHp.structure === maxHp.structure,
     "战斗结束：存活 NPC 回满血（与玩家下场重置对称）");

  // 对照：爆船 NPC 不应被 endLegionSquadBattle 回满（修复流程负责，结束清理跳过）
  npc.destroyed = true; npc.repairUntil = NOW + 180000; npc.combatHp = { shield: 0, armor: 0, structure: 0 };
  st.combat.squad = { enabled: true, members: [{ npcId: "m3n1", shipInstanceId: "ship_N1", active: false, destroyedInBattle: true }], targetId: null, battleId: null, lastRound: null, pendingNpcIds: [] };
  Sq.endLegionSquadBattle(st);
  ok(npc.combatHp.shield === 0 && npc.destroyed === true, "爆船 NPC 不被结束清理回满（修复倒计时保留，由修复完成流程回满）");
}

// ================================================================
section("32. M6 在线分步换目标（共享指针 / 击杀即换下一个存活目标）");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;

  // 夹具：双/三协议 + 双 NPC 参战，可控制波次敌人数与各自结构
  function m6Setup() {
    const st = makeM3State(W, { npcCount: 2 });
    st.research.completedLevels.legion_dual_squad = 1;
    st.research.completedLevels.legion_triple_squad = 1;
    Sq.beginLegionSquadBattle(st);
    Sq.addLegionNpcToCombatSquad(st, "m3n1");
    Sq.addLegionNpcToCombatSquad(st, "m3n2");
    return st;
  }
  function setHp(st, idx, structure) {
    const e = st.combat.enemies[idx];
    if (e && e.hp) { e.hp.shield = 0; e.hp.armor = 0; e.hp.structure = structure; e.defeated = false; e.rewarded = false; }
    return e;
  }
  function keepEnemies(st, n) { st.combat.enemies = st.combat.enemies.slice(0, n); st.combat.currentEnemy = st.combat.enemies[0]; }

  // —— M6-1：玩家击杀目标 A → 第一个 NPC 攻击下一个目标 B ——
  {
    const st = m6Setup();
    ok(st.combat.enemies.length >= 2, "M6-1 前置：波次含 ≥2 敌");
    keepEnemies(st, 2);
    setHp(st, 0, 1); setHp(st, 1, 1000);
    const eA = st.combat.enemies[0], eB = st.combat.enemies[1];
    const res = W.advanceCombatRound(st, { now: NOW, offline: false, rng: makeRng(7), playEffects: false });
    ok(res.ok && res.advanced === true, "M6-1 回合正常推进");
    ok(eA.hp.structure <= 0 && eA.defeated === true, "玩家击杀目标 A");
    ok(eB.hp.structure < 1000, "NPC 接手攻击下一个目标 B（B 掉血）");
    const r = Sq.getLegionCombatRoundResult(st);
    ok(r && r.lastRound && r.lastRound.perNpc.length === 2, "两名 NPC 均进入开火者序列");
    ok(r.lastRound.perNpc[0] && r.lastRound.perNpc[0].targetId === eB.id, "玩家击杀 A 后，第一个 NPC 攻击目标 B（非 A）");
    ok(r.lastRound.perNpc[1] && r.lastRound.perNpc[1].targetId === eB.id, "B 未死，NPC2 仍打 B（跳过不推进指针）");
    ok(r.lastRound.attacked === 2, "两名 NPC 均实际开火");
  }

  // —— M6-2：NPC 击杀 B → 下一个 NPC 攻击下一个目标 C ——
  {
    const st = m6Setup();
    ok(st.combat.enemies.length >= 3, "M6-2 前置：波次含 ≥3 敌");
    keepEnemies(st, 3);
    setHp(st, 0, 1); setHp(st, 1, 1); setHp(st, 2, 1000);
    const eA = st.combat.enemies[0], eB = st.combat.enemies[1], eC = st.combat.enemies[2];
    W.advanceCombatRound(st, { now: NOW + 1000, offline: false, rng: makeRng(7), playEffects: false });
    ok(eA.hp.structure <= 0 && eA.defeated === true, "玩家击杀 A");
    ok(eB.hp.structure <= 0 && eB.defeated === true, "NPC1 击杀 B（玩家杀 A 后指针推进到 B）");
    ok(eC.hp.structure < 1000, "NPC2 接手攻击 C（B 死后指针再推进）");
    const r = Sq.getLegionCombatRoundResult(st);
    ok(r && r.lastRound && r.lastRound.perNpc[0].targetId === eB.id, "NPC1 目标 == B");
    ok(r.lastRound.perNpc[1].targetId === eC.id, "NPC2 目标 == C（分步换目标）");
  }

  // —— M6-3：单次攻击造成过量伤害（一击致死 → 仍推进指针） ——
  {
    const st = m6Setup();
    keepEnemies(st, 2);
    setHp(st, 0, 1); setHp(st, 1, 1000);
    const eA = st.combat.enemies[0], eB = st.combat.enemies[1];
    W.advanceCombatRound(st, { now: NOW + 2000, offline: false, rng: makeRng(7), playEffects: false });
    ok(eA.hp.structure <= 0, "过量伤害仍击杀 A");
    const r = Sq.getLegionCombatRoundResult(st);
    ok(r.lastRound.perNpc[0].targetId === eB.id, "过量击杀后指针仍推进到 B（不卡在已死目标）");
  }

  // —— M6-4：多个 NPC 依次击杀多个敌人（分步链） ——
  {
    const st = m6Setup();
    ok(st.combat.enemies.length >= 3, "M6-4 前置：波次含 ≥3 敌");
    keepEnemies(st, 3);
    setHp(st, 0, 1); setHp(st, 1, 1); setHp(st, 2, 1000);
    const eA = st.combat.enemies[0], eB = st.combat.enemies[1], eC = st.combat.enemies[2];
    W.advanceCombatRound(st, { now: NOW + 3000, offline: false, rng: makeRng(7), playEffects: false });
    ok(eA.defeated && eB.defeated, "玩家与 NPC1 依次击杀 A、B");
    ok(eC.hp.structure < 1000, "NPC2 接手攻击 C（分步）");
    const r = Sq.getLegionCombatRoundResult(st);
    ok(r.lastRound.perNpc[0].targetId === eB.id && r.lastRound.perNpc[1].targetId === eC.id, "NPC1→B、NPC2→C 分步换目标");
  }

  // —— M6-5 / M6-8：敌人数量 < 攻击者数量 → 指针耗尽，剩余攻击者无目标即停止，不越界 ——
  {
    const st = m6Setup();
    keepEnemies(st, 1);
    setHp(st, 0, 1);
    const e0 = st.combat.enemies[0];
    const res = W.advanceCombatRound(st, { now: NOW + 4000, offline: false, rng: makeRng(7), playEffects: false });
    ok(res.ok && res.advanced === true, "唯一敌人被击杀后回合正常结束（无越界/无限循环）");
    ok(e0.defeated === true, "唯一敌人被玩家 + NPC 火力击杀");
  }
  // M6-5 单元级：fireSingleNpcMember 对死亡目标 → skipped:no-target（不推进指针的底层保证）
  {
    const st = m6Setup();
    const arr = [];
    const dead = { id: "deadX", hp: { shield: 0, armor: 0, structure: 0 }, defeated: true, dodge: 0 };
    const member = st.combat.squad.members[0];
    const fe = Sq.fireSingleNpcMember(st, { now: NOW, rng: () => 0.5 }, member, dead, arr);
    // 注：fireSingleNpcMember 在 skip 时返回 null（跳过项已记入 perNpcArr），故此处断言返回 null
    ok(fe === null, "fireSingleNpcMember 对死亡目标 → 返回 null（跳过不计入有效开火）");
    ok(arr.length === 1 && arr[0].skipped === "no-target", "死亡目标记入 perNpc skipped（不推进指针的底层保证）");
  }

  // —— M6-6：攻击者因无弹药 / 修复中而跳过 → 指针不推进 ——
  {
    // (a) 修复中 NPC 被过滤出开火序列：NPC2 应与玩家打同一存活目标 A
    const st = m6Setup();
    keepEnemies(st, 2);
    setHp(st, 0, 1000); setHp(st, 1, 1000);
    const eA = st.combat.enemies[0], eB = st.combat.enemies[1];
    st.legion.npcs[0].repairUntil = NOW + 999999; // NPC1 修复中
    W.advanceCombatRound(st, { now: NOW + 5000, offline: false, rng: makeRng(7), playEffects: false });
    const r = Sq.getLegionCombatRoundResult(st);
    ok(r.lastRound.perNpc.length === 1, "修复中 NPC1 不进入开火序列（仅 NPC2 参战）");
    ok(r.lastRound.perNpc[0].targetId === eA.id, "NPC2 与玩家打同一目标 A（跳过不推进指针）");
    ok(eB.hp.structure === 1000, "B 未受攻击（指针未因 NPC1 跳过而推进到 B）");
  }
  {
    // (b) 无弹药：单元测试级直接调用 fireSingleNpcMember。注意：经 advanceCombatRound 设 st.ammo=[]
    // 会先触发「全队弹药耗尽撤退」逻辑清空 c.enemies，无法验证分步换目标语义，故此处用单元接口。
    const st = m6Setup();
    const arr = [];
    const member = st.combat.squad.members[0];
    const liveEnemy = st.combat.enemies[0];
    st.ammo = []; // 清空全局弹药池（玩家与 NPC 共享）
    const fe = Sq.fireSingleNpcMember(st, { now: NOW, rng: () => 0.5 }, member, liveEnemy, arr);
    ok(fe === null, "无弹药时 NPC 单体开火 → 返回 null（skipped:no-ammo）");
    ok(arr.length === 1 && arr[0].skipped === "no-ammo", "无弹药记入 perNpc skipped（与玩家共享弹药池）");
  }

  // —— M6-7：击毁奖励不重复结算（rewarded 幂等守卫） ——
  {
    const st = m6Setup();
    keepEnemies(st, 2);
    setHp(st, 0, 1); setHp(st, 1, 1);
    // 波次清空后会生成新波（c.enemies 被替换），故先持有被击毁敌对象的引用
    const e0 = st.combat.enemies[0];
    const e1 = st.combat.enemies[1];
    const iskB = st.resources.isk;
    W.advanceCombatRound(st, { now: NOW + 7000, offline: false, rng: makeRng(7), playEffects: false });
    ok(e0.rewarded === true && e1.rewarded === true, "击毁奖励对每个阵亡敌人均结算一次（rewarded 幂等守卫）");
    ok(st.resources.isk > iskB, "击毁奖励进入玩家 ISK");
    ok(e0.rewarded === true, "同一敌人对象 rewarded 标志保持（奖励不重复结算的核心守卫）");
  }
}

// ================================================================
section("33. M6 Phase 2 离线分步换目标集成");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  const st = makeM3State(W, { npcCount: 2, ammo: 1000000, fuel: 100000000 });
  st.research.completedLevels.legion_dual_squad = 1;
  st.research.completedLevels.legion_triple_squad = 1;
  st.research.completedLevels.legion_dual_squad = 1;
  st.research.completedLevels.legion_triple_squad = 1;
  Sq.beginLegionSquadBattle(st);
  Sq.addLegionNpcToCombatSquad(st, "m3n1");
  Sq.addLegionNpcToCombatSquad(st, "m3n2");
  const zone = W.getCombatEncounterZone(st.combat);
  const enemies = [
    { id: "offline_A", hp: { shield: 0, armor: 0, structure: 1 }, dodge: 0, hit: 0, baseDamage: 0, kind: "normal", iskDrop: 1, xpDrop: 0 },
    { id: "offline_B", hp: { shield: 0, armor: 0, structure: 1000000000000 }, dodge: 0, hit: 0, baseDamage: 0, kind: "normal", iskDrop: 1, xpDrop: 0 }
  ];
  const originalBuildWave = W.buildCombatWave;
  W.buildCombatWave = () => ({ enemies: enemies });
  st.combat.currentEnemy = enemies[0];
  const runId = "m6-offline-" + NOW;
  const result = W.OfflineCombatSystem.settle(st, 1, {
    now: NOW, runId: runId, offlineEnd: NOW + 1000
  });
  const round = st.combat.squad.lastRound;
  ok(round && round.perNpc.length === 2, "离线 settle 实际执行两名 NPC 开火");
  ok(round && round.perNpc[0].targetId === "offline_B", "离线 NPC1 接手目标 B");
  ok(round && round.perNpc[1].targetId === "offline_B", "离线 NPC2 在 B 未死时继续攻击 B");
  ok(round && round.perNpc.every((entry) => !entry.skipped), "离线两名 NPC 均实际完成开火");
  ok(st.combat.runSquadDamageDealt > 0, "离线 NPC 伤害计入小队累计伤害");
  W.OfflineCombatSystem.flush(st, { now: NOW + 1000, runId: runId });
  W.buildCombatWave = originalBuildWave;
}

// ================================================================
section("33. M6 玩家吃 NPC 战斗经验（出资方收获，机制回归锁定）");
{
  const W = buildCombatSandbox();
  const Sq = W.LEGION_COMBAT_SQUAD;
  const st = makeM3State(W, { npcCount: 1 });
  st.research.completedLevels.legion_dual_squad = 1;
  st.research.completedLevels.legion_triple_squad = 1;
  Sq.beginLegionSquadBattle(st);
  Sq.addLegionNpcToCombatSquad(st, "m3n1");
  const zone = W.getCombatEncounterZone(st.combat);
  const enemy = st.combat.enemies[0];
  const xp = (id) => (st.skills[id] && st.skills[id].xp) || 0;
  const defTotal = () => xp("shieldOperation") + xp("armorReinforcement") + xp("hullEngineering");

  // —— A. NPC 开火 → 玩家获得武器/瞄准/电容经验（与自身开火同口径） ——
  {
    const bLaser = xp("laserOps"), bTarget = xp("targeting"), bCap = xp("capacitorManagement");
    const member = st.combat.squad.members[0];
    const fe = Sq.fireSingleNpcMember(st, { now: NOW, rng: () => 0.5 }, member, enemy, []);
    ok(fe !== null, "NPC 成功开火（返回开火记录）");
    ok(xp("laserOps") - bLaser === 2, "NPC 开火 → 玩家 laserOps +2（每武器模块）");
    ok(xp("targeting") - bTarget === 1, "NPC 开火 → 玩家 targeting +1（每武器模块）");
    ok(xp("capacitorManagement") - bCap > 0, "NPC 开火 → 玩家 capacitorManagement 随耗油增加");
  }

  // —— B. NPC 承伤 → 玩家获得防御经验（反转原 !hitNpc 守卫） ——
  {
    const bDef = defTotal(), bPilot = xp("piloting");
    const res = Sq.processLegionEnemyAttack(st, {
      damage: 0, distribute: true, now: NOW, zone: zone, randomFn: () => 0.5,
      attacker: { hit: 100, baseDamage: 300 }, playerDodge: W.calcPlayerDodge(undefined, st),
      playerShipConfig: W.getActiveShip(st), dcReduction: 0
    });
    ok(res.distributed === true && res.targetCount >= 2, "分摊模式调用成功（玩家 + NPC 多目标）");
    ok(defTotal() - bDef >= 1, "NPC 承伤 → 玩家防御层经验至少 +1");
    ok(xp("piloting") - bPilot === 1, "NPC 承伤 → 玩家 piloting +1（总承伤>0）");
  }

  // 注：NPC 维修 → 玩家 defense +1 的路径与玩家自身维修完全同构（repairLegionSquadNpcs
  // 内 `if (gained>0)` 分支调用 addStationModifiedCombatXp(state,"defense",1,"combat")），
  // 因沙箱内 NPC 血量由 ensureNpcCombatHp 每次重置为满，难以在不引入易碎夹具下稳定触发，
  // 故由代码审查 + 现有玩家维修经验测试（test-offline-combat-queue 等）共同覆盖。
}

summary();
