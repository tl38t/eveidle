// Probe: 激光定向打捞单元（deployable 配方）能正确进入舰船总装「特殊」线，
// 且不打破既有舰船的 display state（不抛 TypeError，role/name 字段正确）。
// Run: node tools/_probe_mtu_assembly_display.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const srcs = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(m => m[1].replace(/\?.*$/, ""));

const noop = () => {};
function Ctx() {}
for (const n of ["arc","arcTo","beginPath","bezierCurveTo","clearRect","clip","closePath","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","quadraticCurveTo","rect","restore","rotate","save","scale","setTransform","stroke","strokeRect","strokeText","translate"]) Ctx.prototype[n] = noop;
Ctx.prototype.createLinearGradient = () => ({ addColorStop: noop });
Ctx.prototype.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
const mkEl = () => ({ addEventListener: noop, appendChild: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, closest: () => null, click: noop, dataset: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), getContext: () => new Ctx(), innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => mkEl(), querySelectorAll: () => [], setAttribute: noop, getAttribute: () => null, style: {}, textContent: "", value: "1" });
const sb = { alert: noop, Blob, CanvasRenderingContext2D: Ctx, console, confirm: () => true, document: { addEventListener: noop, readyState: "loading", body: mkEl(), createElement: () => mkEl(), getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [] }, FileReader: class {}, localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }), requestAnimationFrame: noop, setInterval: () => 0, setTimeout: () => 0, clearTimeout: noop, URL: { createObjectURL: () => "b", revokeObjectURL: noop }, URLSearchParams: globalThis.URLSearchParams, window: null, location: { href: "", search: "", hash: "" }, navigator: { userAgent: "node", language: "zh-CN" } };
sb.window = sb;
sb.window.addEventListener = noop;
vm.createContext(sb);
for (const s of srcs) {
  const f = path.resolve(root, s.replace(/^\.\//, ""));
  if (fs.existsSync(f)) vm.runInContext(fs.readFileSync(f, "utf8"), sb, { filename: s });
}
const R = (expr) => vm.runInContext(expr, sb);
let pass = 0, fail = 0;
const ok = (cond, label, info) => { if (cond) { pass++; console.log("  ✓ " + label); } else { fail++; console.log("  ✗ " + label + (info != null ? " — " + (typeof info === "string" ? info : JSON.stringify(info)) : "")); } };

function buildState(asmTarget, line) {
  return {
    currentAction: {
      shipEngSubView: "assembly",
      shipAsmLine: line || "special",
      shipAsmPage: 0,
      shipAsmTarget: asmTarget || "rookie_corvette",
      startedShipAsmTarget: null, active: false, skill: null, shipSubAction: null
    },
    skills: { shipEngineering: { lvl: 80, xp: 0 }, equipmentEngineering: { lvl: 1, xp: 0 } },
    ownedBlueprints: [],
    inventory: { ships: [] },
    combat: { squad: { enabled: false, members: [], deployables: [], deployableStorage: [] }, salvageArmActive: false, active: false, mode: "belt", zone: null },
    settings: {},
    station: { upgrades: {} },
    shipAssignments: {},
    research: { completedLevels: {} },
    legion: { contribution: { shipComponentCost: 1 } },
    resources: {}
  };
}

console.log("=== 1. 默认舰（rookie_corvette）display 一切照旧 ===");
{
  const display = R(`getShipEngineeringDisplayState(${JSON.stringify(buildState("rookie_corvette", "shield_laser"))}, Date.now())`);
  ok(display && display.assemblyLineTabs && display.assemblyLineTabs.length === R(`SHIP_ASSEMBLY_LINES.length`), "line tabs 数量 = SHIP_ASSEMBLY_LINES.length", display && display.assemblyLineTabs && display.assemblyLineTabs.length);
  ok(display && display.shipRole === "护卫舰", "rookie_corvette shipRole = 护卫舰", display && display.shipRole);
  ok(display && display.assemblyGrid && display.assemblyGrid.length > 0, "assemblyGrid 含默认舰（rookie_corvette）", display && display.assemblyGrid && display.assemblyGrid.length);
  ok(display && display.selectedShip && display.selectedShip.name === "启程级", "selectedShip = 启程级");
}

console.log("\n=== 2. deployable（laser_directional_salvage_unit）作为当前目标：不抛、字段正确 ===");
{
  // 在沙箱内构造 state + 注入材料，避免 JSON 克隆副作用
  R(`__st = (function(){ var st={}; st.currentAction={shipEngSubView:"assembly",shipAsmLine:"special",shipAsmPage:0,shipAsmTarget:"laser_directional_salvage_unit",startedShipAsmTarget:null,active:false,skill:null,shipSubAction:null}; st.skills={shipEngineering:{lvl:80,xp:0},equipmentEngineering:{lvl:1,xp:0}}; st.ownedBlueprints=[]; st.inventory={ships:[]}; st.combat={squad:{enabled:false,members:[],deployables:[],deployableStorage:[]},salvageArmActive:false,active:false,mode:"belt",zone:null}; st.settings={}; st.station={upgrades:{}}; st.shipAssignments={}; st.research={completedLevels:{}}; st.legion={contribution:{shipComponentCost:1}}; st.resources={}; ResourceRegistry.add(st,"mineral:三钛合金",10000); ResourceRegistry.add(st,"planetary:生物质",1000); ResourceRegistry.add(st,"planetary:等离子体",1000); ResourceRegistry.add(st,"mineral:钷",100); return st; })();`);
  const stateJson = R(`JSON.stringify(__st)`);
  const res = R(`(function(){ try { var d = getShipEngineeringDisplayState(${stateJson}, Date.now()); return { ok:true, d:d }; } catch(e) { return { ok:false, err: String(e), stack: e && e.stack }; } })()`);
  ok(res.ok === true, "display 构建不抛 TypeError", res.ok === false ? res.err : "");
  ok(res.d && res.d.shipRole === "部署物", "shipRole = '部署物'", res.d && res.d.shipRole);
  ok(res.d && res.d.selectedShip === null, "selectedShip = null（deployable 非舰船）", res.d && res.d.selectedShip);
  ok(res.d && res.d.shipFlavor === "", "shipFlavor = ''");
  ok(res.d && res.d.hybridSelected === false, "hybridSelected = false");
  ok(res.d && res.d.currentAssembly && res.d.currentAssembly.name === "激光定向打捞单元", "currentAssembly.name = 激光定向打捞单元", res.d && res.d.currentAssembly && res.d.currentAssembly.name);
  const tabs = (res.d && res.d.assemblyLineTabs) || [];
  const specialTab = tabs.find(t => t.id === "special");
  ok(specialTab && specialTab.name === "特殊", "「特殊」线 tab name = 特殊", specialTab);
  const grid = (res.d && res.d.assemblyGrid) || [];
  const card = grid.find(it => it.id === "laser_directional_salvage_unit");
  ok(card && card.name === "激光定向打捞单元", "assemblyGrid 卡名 = 激光定向打捞单元", card);
  ok(card && card.role === "部署物", "卡 role = 部署物", card && card.role);
  ok(card && card.unlocked === true, "卡 unlocked = true（requiresBlueprint:false + 等级足够）");
  ok(card && card.requiredLevel === 55, "卡 requiredLevel = 55");
  // 诊断：材料 key / 注册 / 实际库存（用注入的 __st）
  const matDiag = R(`(function(){ var st=__st; return { mineralTrit: ResourceRegistry.get(st, "mineral:三钛合金"), minPomo: ResourceRegistry.get(st, "mineral:钷"), plBio: ResourceRegistry.get(st, "planetary:生物质"), plPlasma: ResourceRegistry.get(st, "planetary:等离子体"), stockTrit: ResourceRegistry.getMaterialStock(st, "三钛合金"), stockBio: ResourceRegistry.getMaterialStock(st, "生物质"), stockPlasma: ResourceRegistry.getMaterialStock(st, "等离子体"), stockPomo: ResourceRegistry.getMaterialStock(st, "钷") }; })()`);
  console.log("  [diag materials]", JSON.stringify(matDiag));
  ok(card && card.hasComponents === true, "卡 hasComponents = true（无 componentCost，材料足）", card ? { hasComponents: card.hasComponents, matDiag } : "card missing");
}

console.log("\n=== 3. 单元级：getShipAssemblyLine / getShipRoleName 兼容性 ===");
{
  const dRecipe = R(`SHIP_ASSEMBLY_RECIPES.find(r => r.id === "laser_directional_salvage_unit")`);
  ok(dRecipe && dRecipe.productKind === "deployable", "配方是 deployable");
  R(`__dR = ${JSON.stringify(dRecipe)}`); // 注入引用
  ok(R(`getShipAssemblyLine(__dR)`) === "special", "getShipAssemblyLine(recipe) → 'special'");
  ok(R(`getShipRoleName(__dR)`) === "部署物", "getShipRoleName(recipe) → '部署物'");
  ok(R(`getShipAssemblyLine(undefined)`) === "shield_laser", "getShipAssemblyLine(undefined) → 'shield_laser' (防御回退)");
  ok(R(`getShipRoleName(undefined)`) === "舰船", "getShipRoleName(undefined) → '舰船' (防御回退)");
  ok(R(`getShipAssemblyLine("rifter")`) === "shield_laser", "rifter → shield_laser");
  ok(R(`getShipRoleName("rifter")`) === "护卫舰", "rifter → 护卫舰");
}

console.log("\n=== 4. 既有高等级舰：dawnbreaker / orca 等不变 ===");
{
  const display = R(`getShipEngineeringDisplayState(${JSON.stringify(buildState("dawnbreaker", "shield_laser"))}, Date.now())`);
  ok(display.shipRole === "战列舰", "dawnbreaker shipRole = 战列舰", display.shipRole);
  ok(display.selectedShip && display.selectedShip.name === "破晓级", "dawnbreaker selectedShip = 破晓级");
}

console.log("\n=== 5. actions: selectShipAsmLine / 分页统计把 deployable 归到「特殊」线 ===");
{
  // 5.1 切换到「特殊」线应当选到 MTU（且 MTU 是唯一成员）
  const st = R(`__st5 = (function(){ var s = ${JSON.stringify(buildState("rifter", "shield_laser"))}; s.currentAction.shipAsmTarget = "rifter"; s.currentAction.shipAsmLine = "shield_laser"; return s; })();`);
  R(`ManufacturingStateActions.selectShipAsmLine(__st5, "special")`);
  const afterLine = R(`({ target: __st5.currentAction.shipAsmTarget, line: __st5.currentAction.shipAsmLine })`);
  ok(afterLine.line === "special" && afterLine.target === "laser_directional_salvage_unit", "从护盾激光切到「特殊」线 → shipAsmTarget 自动跳到 MTU", afterLine);

  // 5.2 「特殊」线的总页数 = 1（MTU 唯一）
  const total = R(`SHIP_ASSEMBLY_RECIPES.filter(function(r){ return getShipAssemblyLine(r) === "special"; }).length`);
  ok(total === 1, "「特殊」线 SHIP_ASSEMBLY_RECIPES 计数 = 1（只有 MTU）", total);

  // 5.3 selectShipAsmPage 在「特殊」线（唯一 MTU，1 页）下不崩
  R(`__st5.currentAction.shipAsmTarget = "laser_directional_salvage_unit"; __st5.currentAction.shipAsmLine = "special"; __st5.currentAction.shipAsmPage = 0;`);
  // MTU 单条 → SHIP_ASSEMBLY_PAGE_SIZE(20) 总 1 页；任何页号都钳到 0
  const pgZero = R(`ManufacturingStateActions.selectShipAsmPage(__st5, 0)`);
  const pgOver = R(`ManufacturingStateActions.selectShipAsmPage(__st5, 99)`);
  ok(pgZero && pgZero.changed === false && pgZero.reason === "same", "selectShipAsmPage(0) 同页 same（不脏）", pgZero);
  ok(pgOver && pgOver.changed === false && pgOver.reason === "same", "selectShipAsmPage(99) 钳到 0 且同页 same（不脏）", pgOver);
  // 边界：从 page 越界（20）进入 page 0 不会污染状态（state.currentAction.shipAsmPage 仍 = 0）
  const curPg = R(`__st5.currentAction.shipAsmPage`);
  ok(curPg === 0, "钳位后 shipAsmPage 仍 = 0（未越界写入）", curPg);
}

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
