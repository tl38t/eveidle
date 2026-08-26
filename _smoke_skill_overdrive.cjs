/* Smoke test for 技能超载协议 (skill_overdrive) booster.
   Loads only data/boosters.js + systems/boosters.js (the effect-layer core),
   replicating the browser global-load via vm, and asserts the booster behaves as designed:
   - series exists, 7-category array, slot "any", effectType skillLevelBonus
   - 3 tiers n/r/l with values 3/5/7, direct-unlock (recipe.requiresBlueprint === false)
   - getEffectiveSkillLevel per-slot scoped: 装在哪个槽就加哪个技能的等级
   - multi-bottle takes MAX per-skill (not additive across skills)
   - expired bottle adds nothing
   - quote gates inherit bonus (offline/online share getBoosterEffectState)
*/
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = "D:/EVE-IDLE/EVEIDLE-WORKBUDDY-FRESH";
const files = ["js/data/boosters.js", "js/systems/boosters.js"];
let combined = "";
for (const f of files) {
  const p = path.join(ROOT, f);
  combined += "\n/* ==== " + f + " ==== */\n" + fs.readFileSync(p, "utf8");
}

const probe = `
;(function () {
  const results = [];
  function ok(name, cond, detail) {
    results.push({ name, pass: !!cond, detail: detail === undefined ? null : detail });
  }

  // ---- 1. Series metadata ----
  const s = BOOSTER_SERIES.skill_overdrive;
  ok("series exists", !!s);
  ok("category is training (与神经训练催化器同tab)", s && s.category === "training", s && s.category);
  ok("slot any", s && s.slot === "any");
  ok("effectType skillLevelBonus", s && s.effectType === "skillLevelBonus");

  // ---- 2. 3 tiers + direct unlock + values ----
  const ids = ["skill_overdrive_n", "skill_overdrive_r", "skill_overdrive_l"];
  const values = [3, 5, 7];
  const defs = BOOSTER_DEFS.filter(d => d[ 0] === "skill_overdrive");
  ok("3 tiers present", defs.length === 3, defs.length);
  ids.forEach((id, i) => {
    const item = BOOSTER_ITEMS[id];
    const recipe = typeof getBoosterRecipe === "function" ? getBoosterRecipe(id) : (BOOSTER_RECIPES.filter(r => r.id === id)[0]);
    ok("item " + id + " built", !!item);
    ok("recipe " + id + " direct-unlock (requiresBlueprint false)",
       recipe && recipe.requiresBlueprint === false, recipe && recipe.requiresBlueprint);
    ok("effectValue " + id + " = " + values[i],
       item && Number(item.effectValue) === values[i], item && item.effectValue);
    ok("item.category is training", item && item.category === "training", item && item.category);
  });

  // ---- 3. describe text ----
  ok("describe text +7", describeBoosterEffect("skillLevelBonus", 7).indexOf("+7") >= 0);
  ok("describe text says slot-scoped (not 全部)", describeBoosterEffect("skillLevelBonus", 7).indexOf("全部") < 0, describeBoosterEffect("skillLevelBonus", 7));

  // ---- 4. getEffectiveSkillLevel: base / n / r / l（按槽位作用域）----
  const skills = { mining: { lvl: 10 }, gasHarvesting: { lvl: 10 }, archaeology: { lvl: 10 },
    refining: { lvl: 10 }, shipEngineering: { lvl: 10 }, equipmentEngineering: { lvl: 10 },
    boosterEngineering: { lvl: 10 } };
  const state = { skills, boosters: { active: {} } };

  ["mining", "gasHarvesting", "archaeology", "refining", "shipEngineering", "equipmentEngineering", "boosterEngineering"]
    .forEach(k => ok("no-booster " + k + " = base 10", getEffectiveSkillLevel(state, k) === 10, getEffectiveSkillLevel(state, k)));

  state.boosters.active = { miningSpeed: { itemId: "booster:skill_overdrive_n", remainingMs: 180000 } };
  ok("n on miningSpeed -> mining +3 (13)", getEffectiveSkillLevel(state, "mining") === 13, getEffectiveSkillLevel(state, "mining"));
  ok("n on miningSpeed -> shipEngineering unaffected (10)", getEffectiveSkillLevel(state, "shipEngineering") === 10, getEffectiveSkillLevel(state, "shipEngineering"));

  state.boosters.active = { shipSpeed: { itemId: "booster:skill_overdrive_r", remainingMs: 180000 } };
  ok("r on shipSpeed -> shipEngineering +5 (15)", getEffectiveSkillLevel(state, "shipEngineering") === 15, getEffectiveSkillLevel(state, "shipEngineering"));
  ok("r on shipSpeed -> mining unaffected (10)", getEffectiveSkillLevel(state, "mining") === 10, getEffectiveSkillLevel(state, "mining"));

  state.boosters.active = { miningSpeed: { itemId: "booster:skill_overdrive_l", remainingMs: 180000 } };
  ok("l on miningSpeed -> mining +7 (17)", getEffectiveSkillLevel(state, "mining") === 17, getEffectiveSkillLevel(state, "mining"));

  // ---- 5. multi-bottle: 同技能取 MAX，不同技能各自生效 ----
  state.boosters.active = {
    miningSpeed: { itemId: "booster:skill_overdrive_r", remainingMs: 180000 },
    shipSpeed:   { itemId: "booster:skill_overdrive_l", remainingMs: 180000 }
  };
  ok("per-skill mining = 5", getBoosterEffectState(state).skillLevelBySkill.mining === 5, getBoosterEffectState(state).skillLevelBySkill.mining);
  ok("per-skill shipEngineering = 7", getBoosterEffectState(state).skillLevelBySkill.shipEngineering === 7, getBoosterEffectState(state).skillLevelBySkill.shipEngineering);
  ok("multi getEffective mining = 15", getEffectiveSkillLevel(state, "mining") === 15, getEffectiveSkillLevel(state, "mining"));
  ok("multi getEffective shipEngineering = 17", getEffectiveSkillLevel(state, "shipEngineering") === 17, getEffectiveSkillLevel(state, "shipEngineering"));

  // ---- 6. expired bottle adds nothing ----
  state.boosters.active = { miningSpeed: { itemId: "booster:skill_overdrive_r", remainingMs: 0 } };
  ok("expired -> base 10", getEffectiveSkillLevel(state, "mining") === 10, getEffectiveSkillLevel(state, "mining"));

  // ---- 7. 修复验证：技能超载让玩家临时等级跨过制造门槛 ----
  // 关键：门槛本身不得再加 skillLevelBySkill（否则与玩家侧 getEffectiveSkillLevel 抵消）
  const recipeLocked = { level: 14, cost: { "x": 10 } }; // 基础 10 级做不了 (10 < 14)
  // 未装增强剂
  state.boosters.active = {};
  ok("no-booster: eff shipEngineering = 10", getEffectiveSkillLevel(state, "shipEngineering") === 10, getEffectiveSkillLevel(state, "shipEngineering"));
  const qNo = getShipBuildingQuote(state, recipeLocked, { kind: "component" });
  ok("no-booster: gate = recipe.level (14)", qNo.levelGate === 14, qNo.levelGate);
  ok("no-booster: 10 < 14 -> locked", getEffectiveSkillLevel(state, "shipEngineering") < qNo.levelGate);

  // 装配 skill_overdrive_r (value 5) 到 shipSpeed 槽
  state.boosters.active = { shipSpeed: { itemId: "booster:skill_overdrive_r", remainingMs: 180000 } };
  const effShip = getEffectiveSkillLevel(state, "shipEngineering");
  ok("with-booster: eff shipEngineering = 15", effShip === 15, effShip);
  const qYes = getShipBuildingQuote(state, recipeLocked, { kind: "component" });
  ok("with-booster: gate 仍=14（不含技能加成，避免抵消）", qYes.levelGate === 14, qYes.levelGate);
  ok("with-booster: 15 >= 14 -> 可制造（跨过门槛）", effShip >= qYes.levelGate);

  // 装备工程同理
  state.boosters.active = { equipmentSpeed: { itemId: "booster:skill_overdrive_r", remainingMs: 180000 } };
  const effEq = getEffectiveSkillLevel(state, "equipmentEngineering");
  const eqYes = getEquipEngBuildingQuote(state, recipeLocked);
  ok("equip with-booster: eff equipmentEngineering = 15", effEq === 15, effEq);
  ok("equip with-booster: gate = 14（不含技能加成）", eqYes.levelGate === 14, eqYes.levelGate);
  ok("equip with-booster: 15 >= 14 -> 可制造", effEq >= eqYes.levelGate);

  // ---- 8. 战斗槽不可装（装在战斗槽等于白装，故禁止） ----
  const odItem = getBoosterItem("skill_overdrive_n");
  ok("战斗槽 combatWeapon 不兼容", isBoosterCompatibleWithSlot(odItem, "combatWeapon") === false, isBoosterCompatibleWithSlot(odItem, "combatWeapon"));
  ok("战斗槽 combatRepair 不兼容", isBoosterCompatibleWithSlot(odItem, "combatRepair") === false, isBoosterCompatibleWithSlot(odItem, "combatRepair"));
  ok("采矿槽 miningSpeed 兼容", isBoosterCompatibleWithSlot(odItem, "miningSpeed") === true, isBoosterCompatibleWithSlot(odItem, "miningSpeed"));
  ok("舰船槽 shipSpeed 兼容", isBoosterCompatibleWithSlot(odItem, "shipSpeed") === true, isBoosterCompatibleWithSlot(odItem, "shipSpeed"));
  // 神经增强剂仍可进战斗槽（对照）
  const neuItem = getBoosterItem("neural_training_n") || getBoosterItem("neural_booster_n");
  if (neuItem) ok("神经增强剂 战斗槽兼容（对照）", isBoosterCompatibleWithSlot(neuItem, "combatWeapon") === true, isBoosterCompatibleWithSlot(neuItem, "combatWeapon"));

  // ---- 9. 回归：数组分类 / 分类 id 与 action 不一致 的瓶子必须能正确装备 ----
  // 精密配给剂 category:["ship","equipment"]（数组）
  const pr = getBoosterItem("precision_rationing_n");
  ok("精密配给剂 存在", !!pr, pr && pr.category);
  ok("精密配给剂 舰船槽 shipSpeed 兼容", pr && isBoosterCompatibleWithSlot(pr, "shipSpeed") === true);
  ok("精密配给剂 舰船槽 shipYield 兼容（自身主槽）", pr && isBoosterCompatibleWithSlot(pr, "shipYield") === true);
  ok("精密配给剂 装备槽 equipmentSpeed 兼容", pr && isBoosterCompatibleWithSlot(pr, "equipmentSpeed") === true);
  ok("精密配给剂 装备槽 equipmentYield 兼容", pr && isBoosterCompatibleWithSlot(pr, "equipmentYield") === true);
  ok("精密配给剂 采矿槽 miningSpeed 不兼容", pr && isBoosterCompatibleWithSlot(pr, "miningSpeed") === false);
  ok("精密配给剂 战斗槽 combatWeapon 不兼容", pr && isBoosterCompatibleWithSlot(pr, "combatWeapon") === false);
  // 装备总装协调剂 category:"equipment"（分类 id 与 equipment 槽 action 不等价，需映射修正）
  const ea = getBoosterItem("equipment_assembly_n");
  ok("装备总装协调剂 装备槽 equipmentSpeed 兼容", ea && isBoosterCompatibleWithSlot(ea, "equipmentSpeed") === true);
  ok("装备总装协调剂 装备槽 equipmentYield 兼容", ea && isBoosterCompatibleWithSlot(ea, "equipmentYield") === true);
  ok("装备总装协调剂 舰船槽 shipSpeed 不兼容", ea && isBoosterCompatibleWithSlot(ea, "shipSpeed") === false);
  // 装配协调剂 category:"ship" 单分类对照
  const ac = getBoosterItem("assembly_coordinator_n");
  ok("装配协调剂 舰船槽 shipSpeed 兼容（对照）", ac && isBoosterCompatibleWithSlot(ac, "shipSpeed") === true);

  // ---- report ----
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log((r.pass ? "PASS " : "FAIL ") + r.name + (r.detail !== null ? "  [" + JSON.stringify(r.detail) + "]" : ""));
  }
  console.log("SMOKE_SUMMARY total=" + results.length + " failed=" + failed);
  if (failed > 0) { console.log("SMOKE_RESULT_FAIL"); } else { console.log("SMOKE_RESULT_OK"); }
})();
`;

const sandbox = {};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.console = console;
sandbox.setTimeout = () => 0;
sandbox.clearTimeout = () => {};
sandbox.setInterval = () => 0;
sandbox.clearInterval = () => {};
sandbox.requestAnimationFrame = () => 0;
sandbox.cancelAnimationFrame = () => {};
sandbox.performance = { now: () => Date.now() };
sandbox.navigator = { userAgent: "node" };
sandbox.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
sandbox.sessionStorage = sandbox.localStorage;
sandbox.document = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({}), addEventListener() {}, body: {}, documentElement: {}, head: {},
  title: "", cookie: ""
};
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.dispatchEvent = () => {};
sandbox.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
sandbox.GameEvents = { emit() {}, on() {}, off() {}, once() {} };

vm.createContext(sandbox);
try {
  vm.runInContext(combined + "\n" + probe, sandbox, { filename: "combined.js" });
} catch (e) {
  console.error("SMOKE_ERROR:", e && e.stack ? e.stack : e);
  process.exit(1);
}
