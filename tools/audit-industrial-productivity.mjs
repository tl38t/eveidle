import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { calculateShipProductionTime } from "./calculate-ship-production-times.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(match => match[1]).filter(source =>
  !source.includes("/ui/") && !["actions.js", "tick.js", "offline.js", "persistence.js"].some(file => source.endsWith("/" + file))
);
const noop = () => {};
const canvasContext = { createImageData:(width, height) => ({ data:new Uint8ClampedArray(width * height * 4), width, height }) };
for (const method of [
  "arc", "arcTo", "beginPath", "clearRect", "clip", "drawImage", "ellipse", "fill", "fillRect", "fillText",
  "lineTo", "moveTo", "putImageData", "rect", "restore", "rotate", "save", "scale", "setTransform", "stroke", "strokeText", "translate"
]) canvasContext[method] = noop;
const makeElement = () => ({
  addEventListener:noop, appendChild:noop, classList:{ add:noop, remove:noop, toggle:noop, contains:() => false },
  click:noop, closest:() => null, dataset:{}, focus:noop, getBoundingClientRect:() => ({ left:0, top:0, width:100, height:100 }),
  getContext:() => canvasContext,
  innerHTML:"", offsetHeight:24, offsetWidth:560, querySelector:() => null, querySelectorAll:() => [], remove:noop,
  select:noop, style:{}, textContent:"", value:"1"
});
const sandbox = {
  alert:noop, Blob, CanvasRenderingContext2D:class {}, console, confirm:() => true,
  document:{ addEventListener:noop, body:makeElement(), createElement:makeElement, createElementNS:makeElement, getElementById:makeElement, querySelector:() => null, querySelectorAll:() => [] },
  FileReader:class {}, localStorage:{ getItem:() => null, setItem:noop }, requestAnimationFrame:noop,
  setInterval:noop, setTimeout:noop, clearTimeout:noop, URL:{ createObjectURL:() => "blob:mock", revokeObjectURL:noop }, window:null
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
for (const source of scriptSources) {
  vm.runInContext(fs.readFileSync(path.resolve(root, source.replace(/^\.\//, "")), "utf8"), sandbox, { filename:source });
}
// 额外加载动作层，供「材料不足时制造Action原子拒绝」测试调用真实 dispatchGameAction。
// actions.js 仅定义函数、不依赖 tick/offline/persistence 在模块求值期执行，可在已加载 events/selectors/production 的沙箱中安全运行。
vm.runInContext(fs.readFileSync(path.resolve(root, "js/core/actions.js"), "utf8"), sandbox, { filename:"js/core/actions.js" });

const industrialShips = vm.runInContext("INDUSTRIAL_SHIPS", sandbox);
const miningAreas = vm.runInContext("MINING_AREAS", sandbox);
const moonAreas = vm.runInContext("MOON_MINING_AREAS", sandbox);
const gasAreas = vm.runInContext("GAS_AREAS", sandbox);

const stageShips = [
  { mining:"miner_frigate", gas:"gas_frigate", level:1 },
  { mining:"miner_destroyer", gas:"gas_destroyer", level:15 },
  { mining:"miner_cruiser", gas:"gas_cruiser", level:35 },
  { mining:"miner_battleship", gas:"gas_battleship", level:55 },
];
const equipmentLines = {
  mining:{
    high:[[1,"t1_mining_laser"],[15,"t2_mining_laser"],[35,"t3_mining_laser"],[55,"t4_mining_laser"],[80,"t5_mining_laser"]],
    mid:[[1,"t1_drone_control"],[15,"t2_drone_link"],[35,"t3_drone_link"],[55,"t4_drone_link"],[80,"t5_drone_core"]],
    low:[[10,"t1_mining_booster"],[15,"t2_mining_booster"],[35,"t3_mining_booster"],[55,"t4_mining_booster"],[80,"t5_mining_booster"]]
  },
  gas:{
    high:[[1,"t1_gas_harvester"],[15,"t2_gas_harvester"],[35,"t3_gas_harvester"],[55,"t4_gas_harvester"],[80,"t5_gas_harvester"]],
    mid:[[1,"t1_drone_control"],[15,"t2_drone_link"],[35,"t3_drone_link"],[55,"t4_drone_link"],[80,"t5_drone_core"]],
    low:[[10,"t1_gas_booster"]]
  }
};

function bestAt(entries, level) {
  let id = null;
  for (const [requiredLevel, equipmentId] of entries) if (level >= requiredLevel) id = equipmentId;
  return id;
}

function bestArea(areas, level) {
  return areas.filter(area => area.level <= level).at(-1) || null;
}

function createState(shipId, level, role, enhancementLevel = 0, supportShipId = null) {
  const state = JSON.parse(JSON.stringify(sandbox.gameState));
  const config = industrialShips[shipId];
  const instance = {
    shipId, instanceId:"audit_main", builtAt:0, enhancementLevel,
    fitted:{ high:[], mid:[], low:[], rig:[] }
  };
  for (const slot of ["high", "mid", "low"]) {
    const equipmentId = bestAt(equipmentLines[role][slot], level);
    instance.fitted[slot] = Array.from({ length:config.slots[slot] || 0 }, () => equipmentId);
  }
  state.skills[role === "mining" ? "mining" : "gasHarvesting"] = { lvl:level, xp:0 };
  state.inventory.ships = [instance];
  state.shipAssignments = { [role === "mining" ? "mining" : "gasHarvesting"]:instance.instanceId };
  if (supportShipId) state.inventory.ships.push({ shipId:supportShipId, instanceId:"audit_support", builtAt:0, enhancementLevel:0, fitted:{ high:[], mid:[], low:[], rig:[] } });
  return state;
}

function audit(shipId, level, role, enhancementLevel, area, supportShipId = null) {
  const state = createState(shipId, level, role, enhancementLevel, supportShipId);
  const actionKey = role === "mining" ? "mining" : "gasHarvesting";
  const efficiency = sandbox.getProductionEfficiencyState(state, actionKey);
  const cycle = area ? area.baseTime / efficiency.total : null;
  return {
    ship:industrialShips[shipId].name, level, area:area ? (area.ore || area.gas) : "--",
    efficiency:efficiency.total, cycle, unitsPerHour:cycle ? 3600 / cycle : 0
  };
}

function percent(value) { return (value * 100).toFixed(1) + "%"; }
function number(value) { return value ? value.toFixed(2) : "--"; }
function printRows(title, rows) {
  console.log(`\n${title}`);
  console.log("舰船\t技能\t目标\t+0 单位/h\t+5 单位/h\t+10 单位/h\t换船独立收益");
  for (const row of rows) {
    console.log([row.base.ship, `Lv.${row.base.level}`, row.base.area, number(row.base.unitsPerHour), number(row.plus5.unitsPerHour), number(row.plus10.unitsPerHour), row.replacementGain === null ? "--" : percent(row.replacementGain)].join("\t"));
  }
}

function buildLine(role, areas) {
  const rows = [];
  for (let index = 0; index < stageShips.length; index++) {
    const stage = stageShips[index];
    const shipId = stage[role];
    const area = bestArea(areas, stage.level);
    const base = audit(shipId, stage.level, role, 0, area);
    const plus5 = audit(shipId, stage.level, role, 5, area);
    const plus10 = audit(shipId, stage.level, role, 10, area);
    let replacementGain = null;
    if (index > 0 && area) {
      const previousShipId = stageShips[index - 1][role];
      const previousAtSameStage = audit(previousShipId, stage.level, role, 0, area);
      replacementGain = base.unitsPerHour / previousAtSameStage.unitsPerHour - 1;
      if (replacementGain < 0.18 || replacementGain > 0.45) throw new Error(`${base.ship}的换船独立收益${percent(replacementGain)}超出18%～45%审计区间`);
    }
    if (base.unitsPerHour > 0 && (Math.abs(plus5.unitsPerHour / base.unitsPerHour - 1.075) > 1e-9 || Math.abs(plus10.unitsPerHour / base.unitsPerHour - 1.15) > 1e-9)) {
      throw new Error(`${base.ship}的+5/+10工业强化倍率错误`);
    }
    rows.push({ base, plus5, plus10, replacementGain });
  }
  return rows;
}

const miningRows = buildLine("mining", miningAreas);
const moonRows = buildLine("mining", moonAreas);
const gasRows = buildLine("gas", gasAreas);
printRows("普通矿产能", miningRows);
printRows("月矿产能（未达到门槛显示—）", moonRows);
printRows("气体产能", gasRows);

const supportStage = stageShips.find(stage => stage.level === 55);
const supportArea = bestArea(miningAreas, supportStage.level);
const unsupported = audit(supportStage.mining, supportStage.level, "mining", 0, supportArea);
const dolphin = audit(supportStage.mining, supportStage.level, "mining", 0, supportArea, "dolphin");
const orca = audit(supportStage.mining, supportStage.level, "mining", 0, supportArea, "orca");
if (Math.abs(dolphin.unitsPerHour / unsupported.unitsPerHour - 1.10) > 1e-9 || Math.abs(orca.unitsPerHour / unsupported.unitsPerHour - 1.20) > 1e-9) {
  throw new Error("海豚/逆戟鲸支援倍率没有保持10%/20%");
}
console.log("\n舰队支援对照（巨像级 Lv.55 +0）");
console.log(`无支援 ${number(unsupported.unitsPerHour)}/h · 海豚 ${number(dolphin.unitsPerHour)}/h (+10.0%) · 逆戟鲸 ${number(orca.unitsPerHour)}/h (+20.0%)`);
console.log("\n工业产能审计通过（基础舰队支援对照）");

// ════════════════════════════════════════════════════════════════
// 工业舰专项收尾：层级完整性 / 逆戟鲸自身能力 / 强化接入 /
// 舰队采矿支援 / 冶炼支援 / 制造经济 —— 全部调用真实选择器与动作层。
// ════════════════════════════════════════════════════════════════
const assemblyRecipes = vm.runInContext("SHIP_ASSEMBLY_RECIPES", sandbox);
const compRecipes = vm.runInContext("SHIP_COMPONENT_RECIPES", sandbox);
const smeltingRecipes = vm.runInContext("SMELTING_RECIPES", sandbox);
const gasAreasAll = vm.runInContext("GAS_AREAS", sandbox);
const planetTypes = vm.runInContext("PLANET_TYPES", sandbox);
const dispatchGameAction = sandbox.dispatchGameAction;
const getSmeltingDisplayState = sandbox.getSmeltingDisplayState;
const getShipAssignmentRestriction = sandbox.getShipAssignmentRestriction;
const getShipEnhancementBonuses = sandbox.getShipEnhancementBonuses;
const getShipInstanceFromState = sandbox.getShipInstanceFromState;
const getShipAssemblyMaxCyclesFromState = sandbox.getShipAssemblyMaxCyclesFromState;
const createShipInstance = sandbox.createShipInstance;

const EPS = 1e-9;
function approxEqual(a, b) { return Math.abs(Number(a) - Number(b)) <= EPS; }
function assertIndustrial(cond, msg) { if (!cond) throw new Error("工业舰专项校验失败：" + msg); }

// ── 1. 工业舰层级完整性（精确 10 艘）──
const expectedIndustrial = [
  { id:"miner_frigate", name:"冲锋者级", level:1, prefix:"" },
  { id:"gas_frigate", name:"勘探者级", level:1, prefix:"" },
  { id:"miner_destroyer", name:"妄想级", level:15, prefix:"destroyer_" },
  { id:"gas_destroyer", name:"采集者级", level:15, prefix:"destroyer_" },
  { id:"miner_cruiser", name:"霍克级", level:35, prefix:"cruiser_" },
  { id:"gas_cruiser", name:"奋进级", level:35, prefix:"cruiser_" },
  { id:"dolphin", name:"海豚级", level:35, prefix:"cruiser_" },
  { id:"miner_battleship", name:"巨像级", level:55, prefix:"battleship_" },
  { id:"gas_battleship", name:"云海级", level:55, prefix:"battleship_" },
  { id:"orca", name:"逆戟鲸级", level:80, prefix:"capital_" }
];
assertIndustrial(industrialShips && Object.keys(industrialShips).length === 10, `工业舰必须精确 10 艘，实际 ${industrialShips ? Object.keys(industrialShips).length : 0}`);
for (const spec of expectedIndustrial) {
  const cfg = industrialShips[spec.id];
  assertIndustrial(cfg, `${spec.id} 工业舰缺失`);
  assertIndustrial(cfg.name === spec.name, `${spec.id} 名称应为 ${spec.name}，实际 ${cfg.name}`);
  const recipe = assemblyRecipes.find(r => r.shipId === spec.id);
  assertIndustrial(recipe, `${spec.id} 缺少整船制造配方`);
  assertIndustrial(recipe.level === spec.level, `${spec.id} 制造门槛应为 Lv.${spec.level}，实际 ${recipe.level}`);
  const compKeys = Object.keys(recipe.componentCost || {});
  assertIndustrial(compKeys.length === 3, `${spec.id} 部件档位应为 3 类，实际 ${compKeys.length}`);
  for (const key of compKeys) assertIndustrial(key.startsWith(spec.prefix), `${spec.id} 部件 ${key} 前缀应为 ${JSON.stringify(spec.prefix)}`);
  // 真实实例创建（调用沙箱内 createShipInstance，非手工构造）
  const inst = createShipInstance(spec.id, 1000);
  assertIndustrial(inst && inst.shipId === spec.id, `${spec.id} createShipInstance 返回的 shipId 应为自身`);
  assertIndustrial(typeof inst.instanceId === "string" && inst.instanceId.length > 0, `${spec.id} 未生成有效 instanceId`);
  assertIndustrial(inst.enhancementLevel === 0, `${spec.id} 初始强化等级应为 0，实际 ${inst.enhancementLevel}`);
  assertIndustrial(inst.fitted && Array.isArray(inst.fitted.high) && Array.isArray(inst.fitted.mid) && Array.isArray(inst.fitted.low) && Array.isArray(inst.fitted.rig), `${spec.id} fitted 必须为 high/mid/low/rig 四槽结构`);
  // 连续两艘同型号 instanceId 必须不同
  const instA = createShipInstance(spec.id, 1000);
  const instB = createShipInstance(spec.id, 1000);
  assertIndustrial(instA.instanceId !== instB.instanceId, `${spec.id} 连续两艘同型号 instanceId 必须不同（可区分实例）`);
  // getShipInstanceFromState 作为创建后的读取验证（非自证可实例化）
  const probe = JSON.parse(JSON.stringify(sandbox.gameState));
  probe.inventory.ships = [inst];
  assertIndustrial(getShipInstanceFromState(probe, inst.instanceId), `${spec.id} 真实创建的实例无法通过 getShipInstanceFromState 按 instanceId 读取`);
}
console.log("工业舰层级完整性校验通过：10 艘（Lv.1/15/35/55/80）舰体/配方/门槛/三部件档位/可实例化均符合预期");

// ── 2. 逆戟鲸自身工业能力（真实选择器）──
const orcaCfg = industrialShips.orca;
assertIndustrial(orcaCfg.type === "industrial_capital", "逆戟鲸 type 应为 industrial_capital");
assertIndustrial(orcaCfg.unlock && orcaCfg.unlock.type === "shipEngineering" && orcaCfg.unlock.level === 80, "逆戟鲸解锁应为 shipEngineering/Lv.80");
const orcaMining0 = sandbox.getProductionEfficiencyState(createState("orca", 80, "mining", 0), "mining");
assertIndustrial(approxEqual(orcaMining0.shipAmplifier, 2.8), `逆戟鲸采矿装备效果应精确 2.8，实际 ${orcaMining0.shipAmplifier}`);
const orcaGas0 = sandbox.getProductionEfficiencyState(createState("orca", 80, "gas", 0), "gasHarvesting");
assertIndustrial(approxEqual(orcaGas0.shipAmplifier, 2.8), `逆戟鲸采气装备效果应精确 2.8，实际 ${orcaGas0.shipAmplifier}`);
assertIndustrial(orcaCfg.slots.high === 4, `逆戟鲸高槽应为 4，实际 ${orcaCfg.slots.high}`);
assertIndustrial(getShipAssignmentRestriction(orcaCfg, "mining") === null, "逆戟鲸应能承担采矿任务");
assertIndustrial(getShipAssignmentRestriction(orcaCfg, "gasHarvesting") === null, "逆戟鲸应能承担采气任务");
assertIndustrial(getShipAssignmentRestriction(orcaCfg, "refining") === null, "逆戟鲸应能承担冶炼任务");
assertIndustrial(orcaMining0.total > 0, "逆戟鲸普通矿与月矿产能均应为有效正值（效率与矿区无关）");
assertIndustrial(orcaGas0.total > 0, "逆戟鲸采气产能应为有效正值");
console.log("逆戟鲸自身工业能力校验通过：miningLaser/gasLaser=2.8、4 高槽、可采矿/采气/冶炼、普通矿与月矿产能为正");

// ── 3. 工业舰强化接入（真实强化公式）──
const orcaBase = sandbox.getProductionEfficiencyState(createState("orca", 80, "mining", 0), "mining").total;
const orcaPlus5 = sandbox.getProductionEfficiencyState(createState("orca", 80, "mining", 5), "mining").total;
const orcaPlus10 = sandbox.getProductionEfficiencyState(createState("orca", 80, "mining", 10), "mining").total;
assertIndustrial(approxEqual(orcaPlus5 / orcaBase, 1.075), `+5 相对 +0 最终采集乘区应精确 1.075x，实际 ${orcaPlus5 / orcaBase}`);
assertIndustrial(approxEqual(orcaPlus10 / orcaBase, 1.15), `+10 相对 +0 最终采集乘区应精确 1.15x，实际 ${orcaPlus10 / orcaBase}`);
const orcaEnh10 = getShipEnhancementBonuses(orcaCfg, 10);
assertIndustrial(approxEqual(orcaEnh10.hpMultiplier, 1), "强化不增加舰体生命（hpMultiplier 应为 1）");
assertIndustrial(approxEqual(orcaEnh10.industryMultiplier, 1.15), "工业强化 +10 乘区应精确 1.15x");
console.log("工业舰强化接入校验通过（采矿）：+5=1.075x、+10=1.15x、不增舰体生命");
// ── 3b. 逆戟鲸采气强化（真实选择器，gasHarvesting）──
const orcaGasBase = sandbox.getProductionEfficiencyState(createState("orca", 80, "gas", 0), "gasHarvesting").total;
const orcaGasPlus5 = sandbox.getProductionEfficiencyState(createState("orca", 80, "gas", 5), "gasHarvesting").total;
const orcaGasPlus10 = sandbox.getProductionEfficiencyState(createState("orca", 80, "gas", 10), "gasHarvesting").total;
assertIndustrial(approxEqual(orcaGasPlus5 / orcaGasBase, 1.075), `+5 相对 +0 采气最终采集乘区应精确 1.075x，实际 ${orcaGasPlus5 / orcaGasBase}`);
assertIndustrial(approxEqual(orcaGasPlus10 / orcaGasBase, 1.15), `+10 相对 +0 采气最终采集乘区应精确 1.15x，实际 ${orcaGasPlus10 / orcaGasBase}`);
console.log("逆戟鲸采气强化校验通过（gasHarvesting）：+5=1.075x、+10=1.15x（真实 getProductionEfficiencyState）");
// ── 3c. 月矿实际准入（Lv.80 逆戟鲸 + T5 采矿激光器 + 月矿区）──
const moonArea = moonAreas.filter(a => a.level <= 80).at(-1) || moonAreas[0];
const orcaMoonInst = createShipInstance("orca", 1000);
orcaMoonInst.fitted.high = ["eq_t5_moon"];
const orcaMoonState = JSON.parse(JSON.stringify(sandbox.gameState));
if (!orcaMoonState.equipment) orcaMoonState.equipment = { instances: [], inventory: [] };
if (!Array.isArray(orcaMoonState.equipment.instances)) orcaMoonState.equipment.instances = [];
orcaMoonState.equipment.instances.push({ instanceId:"eq_t5_moon", itemId:"t5_mining_laser", enhancementLevel:0 });
orcaMoonState.inventory.ships = [orcaMoonInst];
orcaMoonState.skills.mining = { lvl:80, xp:0 };
orcaMoonState.shipAssignments = { mining: orcaMoonInst.instanceId };
const moonAccess = sandbox.getMoonMiningAccessState(orcaMoonState);
const moonReq = sandbox.getMiningRequirementState(orcaMoonState, moonArea);
assertIndustrial(moonAccess.hasShip === true, "月矿准入：逆戟鲸已分配采矿，hasShip 应为 true");
assertIndustrial(moonAccess.hasEquipment === true, "月矿准入：高槽已装 T5 采矿激光器，hasEquipment 应为 true");
assertIndustrial(moonReq.available === true, `月矿准入：Lv.80 逆戟鲸（采矿）+T5激光器 应可采「${moonArea.name}」，实际 available=${moonReq.available}（${moonReq.text}）`);
orcaMoonInst.fitted.high = [];
const moonReqNoLaser = sandbox.getMiningRequirementState(orcaMoonState, moonArea);
assertIndustrial(moonReqNoLaser.available === false, `移除高槽采矿激光器后月矿准入必须 available=false，实际 ${moonReqNoLaser.available}（${moonReqNoLaser.text}）`);
console.log(`月矿准入校验通过：Lv.80逆戟鲸+T5采矿激光器 可采「${moonArea.name}」(available=true)，移除激光器后 available=false`);

// ── 4. 舰队采矿支援（保持并加强）──
function fleetState(mainId, mainLevel, supportList) {
  const state = JSON.parse(JSON.stringify(sandbox.gameState));
  const config = industrialShips[mainId];
  const instance = { shipId:mainId, instanceId:"audit_main", builtAt:0, enhancementLevel:0, fitted:{ high:[], mid:[], low:[], rig:[] } };
  for (const slot of ["high", "mid", "low"]) {
    const eqId = bestAt(equipmentLines.mining[slot], mainLevel);
    instance.fitted[slot] = Array.from({ length:config.slots[slot] || 0 }, () => eqId);
  }
  state.skills.mining = { lvl:mainLevel, xp:0 };
  state.inventory.ships = [instance];
  state.shipAssignments = { mining:instance.instanceId };
  for (const sup of (supportList || [])) {
    const sid = sup.instanceId || ("sup_" + sup.shipId);
    state.inventory.ships.push({ shipId:sup.shipId, instanceId:sid, builtAt:0, enhancementLevel:sup.enh || 0, fitted:{ high:[], mid:[], low:[], rig:[] } });
    if (sup.assignRefining) state.shipAssignments.refining = sid;
  }
  return state;
}
const fMainId = "miner_battleship", fMainLv = 55;
const fNoSup = sandbox.getProductionEfficiencyState(fleetState(fMainId, fMainLv, []), "mining").total;
const fDol = sandbox.getProductionEfficiencyState(fleetState(fMainId, fMainLv, [{ shipId:"dolphin", instanceId:"d" }]), "mining").total;
const fOrca = sandbox.getProductionEfficiencyState(fleetState(fMainId, fMainLv, [{ shipId:"orca", instanceId:"o" }]), "mining").total;
const fBoth = sandbox.getProductionEfficiencyState(fleetState(fMainId, fMainLv, [{ shipId:"dolphin", instanceId:"d" }, { shipId:"orca", instanceId:"o" }]), "mining").total;
assertIndustrial(approxEqual(fDol / fNoSup, 1.10), `海豚支援应为 1.10x，实际 ${fDol / fNoSup}`);
assertIndustrial(approxEqual(fOrca / fNoSup, 1.20), `逆戟鲸支援应为 1.20x，实际 ${fOrca / fNoSup}`);
assertIndustrial(approxEqual(fBoth / fNoSup, 1.20), `海豚+逆戟鲸同时存在应只取最高 1.20x（不叠加），实际 ${fBoth / fNoSup}`);
const fDolRefine = sandbox.getProductionEfficiencyState(fleetState(fMainId, fMainLv, [{ shipId:"dolphin", instanceId:"d", assignRefining:true }]), "mining").total;
assertIndustrial(approxEqual(fDolRefine / fNoSup, 1.10), `海豚被分配冶炼时仍应提供船坞采矿协同 1.10x，实际 ${fDolRefine / fNoSup}`);
const fOrcaRefine = sandbox.getProductionEfficiencyState(fleetState(fMainId, fMainLv, [{ shipId:"orca", instanceId:"o", assignRefining:true }]), "mining").total;
assertIndustrial(approxEqual(fOrcaRefine / fNoSup, 1.20), `逆戟鲸被分配冶炼时仍应提供船坞采矿协同 1.20x，实际 ${fOrcaRefine / fNoSup}`);
const fOrcaEnh = sandbox.getProductionEfficiencyState(fleetState(fMainId, fMainLv, [{ shipId:"orca", instanceId:"o", enh:10 }]), "mining").total;
assertIndustrial(approxEqual(fOrcaEnh / fNoSup, 1.20), `逆戟鲸 +10 强化不应改变 20% 协同，实际 ${fOrcaEnh / fNoSup}`);
const fGasFleet = fleetState(fMainId, fMainLv, [{ shipId:"orca", instanceId:"o" }]);
fGasFleet.skills.gasHarvesting = { lvl:fMainLv, xp:0 };
fGasFleet.shipAssignments = { gasHarvesting:fGasFleet.inventory.ships[0].instanceId };
const fGasSup = sandbox.getProductionEfficiencyState(fGasFleet, "gasHarvesting");
assertIndustrial(approxEqual(fGasSup.fleetSupportBonus, 0), `舰队采矿协同不得错误提高采气（fleetSupportBonus 应为 0，实际 ${fGasSup.fleetSupportBonus}）`);
console.log("舰队采矿支援校验通过：无支援1.00x、海豚1.10x、逆戟鲸1.20x、同存取最高不叠加、分配冶炼仍协同、强化不改变、不误提采气");

// ── 5. 冶炼支援（真实冶炼 View State）──
function smeltState(assignedShipId, assignedEnh, extraShips) {
  const state = JSON.parse(JSON.stringify(sandbox.gameState));
  state.skills.refining = { lvl:80, xp:0 };
  state.inventory.ships = [];
  if (assignedShipId) {
    const inst = { shipId:assignedShipId, instanceId:"sm_main", builtAt:0, enhancementLevel:assignedEnh || 0, fitted:{ high:[], mid:[], low:[], rig:[] } };
    state.inventory.ships.push(inst);
    state.shipAssignments = { refining:inst.instanceId };
  } else {
    state.shipAssignments = {};
  }
  for (const extra of (extraShips || [])) state.inventory.ships.push({ shipId:extra, instanceId:"sm_" + extra, builtAt:0, enhancementLevel:0, fitted:{ high:[], mid:[], low:[], rig:[] } });
  state.currentAction.smeltingArea = "凡晶石带";
  return state;
}
const smNoneB = getSmeltingDisplayState(smeltState(null), Date.now()).shipBonus;
const smDolB = getSmeltingDisplayState(smeltState("dolphin"), Date.now()).shipBonus;
const smOrcaB = getSmeltingDisplayState(smeltState("orca"), Date.now()).shipBonus;
assertIndustrial(approxEqual(smNoneB, 0), `无支援冶炼 shipBonus 应为 0（1.00x），实际 ${smNoneB}`);
assertIndustrial(approxEqual(smDolB, 0.25), `海豚冶炼 shipBonus 应为 0.25（1.25x），实际 ${smDolB}`);
assertIndustrial(approxEqual(smOrcaB, 0.30), `逆戟鲸冶炼 shipBonus 应为 0.30（1.30x），实际 ${smOrcaB}`);
const smBothNoAssign = getSmeltingDisplayState(smeltState(null, 0, ["dolphin", "orca"]), Date.now()).shipBonus;
assertIndustrial(approxEqual(smBothNoAssign, 0), `海豚+逆戟鲸在船坞但未分配冶炼时 shipBonus 应为 0，实际 ${smBothNoAssign}`);
const smDolEnh = getSmeltingDisplayState(smeltState("dolphin", 10), Date.now()).shipBonus;
const smOrcaEnh = getSmeltingDisplayState(smeltState("orca", 10), Date.now()).shipBonus;
assertIndustrial(approxEqual(smDolEnh, 0.25), `海豚 +10 强化不应放大 0.25 冶炼加成，实际 ${smDolEnh}`);
assertIndustrial(approxEqual(smOrcaEnh, 0.30), `逆戟鲸 +10 强化不应放大 0.30 冶炼加成，实际 ${smOrcaEnh}`);
console.log("冶炼支援校验通过：无支援1.00x、海豚1.25x、逆戟鲸1.30x、未分配不提供、强化不放大");

// ── 6. 制造经济 ──
const orcaRecipe = assemblyRecipes.find(r => r.id === "orca");
assertIndustrial(orcaRecipe && orcaRecipe.requiresBlueprint === false, "逆戟鲸不需要蓝图（requiresBlueprint 应为 false）");
assertIndustrial(orcaRecipe.time === 320 && orcaRecipe.xp === 500, `逆戟鲸组装应为 time=320/xp=500，实际 ${orcaRecipe.time}/${orcaRecipe.xp}`);
const orcaComp = orcaRecipe.componentCost;
const orcaCompSum = (orcaComp.capital_integrated_hull || 0) + (orcaComp.capital_power_core || 0) + (orcaComp.capital_functional_system || 0);
assertIndustrial(orcaCompSum === 28, `逆戟鲸部件总数应为 28，实际 ${orcaCompSum}`);
assertIndustrial(orcaComp.capital_integrated_hull === 10 && orcaComp.capital_power_core === 8 && orcaComp.capital_functional_system === 10, "逆戟鲸部件应为 10/8/10");
assertIndustrial(!orcaRecipe.materialCost, "逆戟鲸配方不得有 materialCost（不耗莫尔石/深层舰船数据/考古材料）");
const knownMaterials = new Set();
for (const r of smeltingRecipes) if (r.outputMineral) knownMaterials.add(r.outputMineral);
for (const g of gasAreasAll) if (g.gas) knownMaterials.add(g.gas);
for (const p of planetTypes) if (p.output) knownMaterials.add(p.output);
for (const m of ["镓", "铂", "铪", "锇", "钷", "铷"]) knownMaterials.add(m);
const orcaMaterials = {};
for (const [compId, count] of Object.entries(orcaComp)) {
  const comp = compRecipes.find(c => c.id === compId);
  assertIndustrial(comp, `逆戟鲸部件 ${compId} 缺少部件配方`);
  for (const [mat, qty] of Object.entries(comp.cost || {})) orcaMaterials[mat] = (orcaMaterials[mat] || 0) + qty * count;
}
for (const mat of Object.keys(orcaMaterials)) {
  assertIndustrial(knownMaterials.has(mat), `逆戟鲸部件材料 ${mat} 无真实资源来源`);
  assertIndustrial(mat !== "莫尔石", `逆戟鲸部件不得消耗莫尔石`);
}
const orcaTime = calculateShipProductionTime(orcaRecipe);
assertIndustrial(orcaTime.totalSeconds >= 18 * 3600 && orcaTime.totalSeconds <= 24 * 3600, `逆戟鲸生产全链路应在 18~24h，实际 ${orcaTime.totalSeconds}s（约 ${Math.floor(orcaTime.totalSeconds / 3600)}h${Math.floor(orcaTime.totalSeconds % 3600 / 60)}m）`);
const asmState = JSON.parse(JSON.stringify(sandbox.gameState));
// 船坞 Lv.2 解锁旗舰总装
asmState.station.bodyLevel = 3;
asmState.station.buildings = asmState.station.buildings || {};
asmState.station.buildings.shipyard = 2;
asmState.station.maintenance = asmState.station.maintenance || {};
asmState.station.maintenance.fuelRemaining = 500000;
asmState.skills.shipEngineering = { lvl:90, xp:0 };
asmState.ownedBlueprints = [];
asmState.inventory.ships = [];
asmState.currentAction = Object.assign({}, asmState.currentAction, { skill:"shipEngineering", shipSubAction:"assembly", shipAsmTarget:"orca", active:false, progress:0 });
const selOrca = dispatchGameAction(asmState, { type:"manufacturing/selectShipAssembly", recipeId:"orca" }, Date.now());
assertIndustrial(selOrca.changed === true, "逆戟鲸应可选中（requiresBlueprint=false 且 Lv.80）");
const beforeInv = JSON.stringify(asmState.inventory);
const startOrca = dispatchGameAction(asmState, { type:"manufacturing/startShipAssembly" }, Date.now());
assertIndustrial(startOrca.changed === false && startOrca.reason === "insufficient-components", `材料不足时制造应原子拒绝，实际 ${JSON.stringify(startOrca)}`);
assertIndustrial(JSON.stringify(asmState.inventory) === beforeInv, "材料不足拒绝时不得部分扣除部件（inventory 不变）");
assertIndustrial(getShipAssemblyMaxCyclesFromState(asmState, orcaRecipe) < 1, "材料不足时 getShipAssemblyMaxCyclesFromState 应 < 1");
console.log("制造经济校验通过：全链路18~24h、部件均真实来源、无莫尔石/深层/考古、不需蓝图、材料不足原子拒绝");
// ── 7. Lv.80 制造边界（真实 dispatchGameAction）──
function makeAssemblyState(level) {
  const s = JSON.parse(JSON.stringify(sandbox.gameState));
  s.skills.shipEngineering = { lvl:level, xp:0 };
  s.ownedBlueprints = [];
  s.inventory.ships = [];
  s.currentAction = Object.assign({}, s.currentAction, { skill:"shipEngineering", shipSubAction:"assembly", shipAsmTarget:null, active:false, progress:0 });
  // 船坞 Lv.2 解锁旗舰/工业旗舰组装
  if (!s.station) s.station = {};
  if (!s.station.autoLines) s.station.autoLines = {};
  s.station.bodyLevel = 3;
  if (!s.station.buildings) s.station.buildings = {};
  s.station.buildings.shipyard = 2;
  if (!s.station.maintenance) s.station.maintenance = { fuelRemaining:500000, lastTick:Date.now() };
  else s.station.maintenance.fuelRemaining = 500000;
  return s;
}
const lv79 = makeAssemblyState(79);
const before79 = JSON.stringify(lv79.currentAction);
const sel79 = dispatchGameAction(lv79, { type:"manufacturing/selectShipAssembly", recipeId:"orca" }, Date.now());
assertIndustrial(sel79.changed === false && sel79.reason === "level-locked", `舰船工程 Lv.79 选逆戟鲸应 level-locked，实际 ${JSON.stringify(sel79)}`);
assertIndustrial(JSON.stringify(lv79.currentAction) === before79, "Lv.79 选配方被拒时 currentAction 不得被修改");
const lv80 = makeAssemblyState(80);
const sel80 = dispatchGameAction(lv80, { type:"manufacturing/selectShipAssembly", recipeId:"orca" }, Date.now());
assertIndustrial(sel80.changed === true && lv80.currentAction.shipAsmTarget === "orca", "舰船工程 Lv.80 应选逆戟鲸成功并写入 shipAsmTarget");
const lv79Forced = makeAssemblyState(79);
lv79Forced.currentAction.shipAsmTarget = "orca";
const start79 = dispatchGameAction(lv79Forced, { type:"manufacturing/startShipAssembly" }, Date.now());
assertIndustrial(start79.changed === false && start79.reason === "level-locked", `Lv.79 即使预置 shipAsmTarget 启动组装仍应 level-locked，实际 ${JSON.stringify(start79)}`);
const lv80Poor = makeAssemblyState(80);
lv80Poor.currentAction.shipAsmTarget = "orca";
const beforeInv80 = JSON.stringify(lv80Poor.inventory);
const start80Poor = dispatchGameAction(lv80Poor, { type:"manufacturing/startShipAssembly" }, Date.now());
assertIndustrial(start80Poor.changed === false && start80Poor.reason === "insufficient-components", `Lv.80 材料不足应 insufficient-components，实际 ${JSON.stringify(start80Poor)}`);
assertIndustrial(JSON.stringify(lv80Poor.inventory) === beforeInv80, "Lv.80 材料不足拒绝时 inventory 不得部分扣除");
assertIndustrial(orcaRecipe.requiresBlueprint === false, "逆戟鲸制造不需蓝图（Lv.80 边界前置条件）");
console.log("Lv.80 制造边界校验通过：Lv.79选配方level-locked且状态不变、Lv.80选配方成功、Lv.79预置target启动仍level-locked、Lv.80材料不足insufficient-components且库存不变、不需蓝图");

console.log("\n工业产能专项审计全部通过：");
console.log("  · 真实实例创建（createShipInstance 四槽结构/强化0/同型号instanceId不重复）");
console.log("  · 采矿 + 采气强化（+5=1.075x、+10=1.15x，真实 getProductionEfficiencyState）");
console.log("  · 月矿准入（Lv.80逆戟鲸+T5激光器 available=true，移除激光器 available=false）");
console.log("  · Lv.79/80 制造边界（选配方/启动组装 level-locked 与 insufficient-components）");
