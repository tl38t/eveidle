// 验证：战斗补给告警实装（2026-09-03 玩家反馈「提示不够明显」）。
// 数据层：getCombatDisplayState 透出 supply（与出击弹窗 getCombatSupplyWarning 同口径）
// 与 lastStatus（断火原因，此前从未渲染）；supply.ammoTypes 只含当前武器实际使用的类型。
// UI 层：镜像 renderCombatSupplyStatus 的告警文案与三档判定做断言。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const re = /<script\s+defer\s+src="([^"]+)"/g;
let m; const srcs = [];
while ((m = re.exec(html))) srcs.push(m[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
const UI_EXCLUDE = new Set([
  "js/ui/error-boundary.js", "js/ui/combat-render.js", "js/ui/planetary-render.js",
  "js/ui/archaeology-render.js", "js/ui/booster-render.js", "js/ui/render.js",
  "js/core/runtime.js", "js/ui/taptap-portrait.js", "js/ui/ad-buff-widget.js"
]);
let combined = "";
for (const s of srcs.filter(x => !UI_EXCLUDE.has(x))) {
  combined += "\n;\n// " + s + "\n" + fs.readFileSync(path.resolve(ROOT, s), "utf8");
}
const noop = () => {};
const mk = () => ({ addEventListener: noop, removeEventListener: noop, appendChild: noop, insertBefore: noop, style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, dataset: {}, getContext: () => ({}), innerHTML: "", querySelector: () => mk(), querySelectorAll: () => [], getElementById: () => mk(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }), offsetHeight: 1, offsetWidth: 1, textContent: "", value: "1", children: [], parentNode: null, setAttribute: noop, getAttribute: () => null });
const documentMock = { addEventListener: noop, body: mk(), createElement: () => mk(), getElementById: () => mk(), querySelector: () => mk(), querySelectorAll: () => [] };
const sandbox = { console, window: null, document: documentMock, localStorage: { getItem: () => null, setItem: noop }, alert: noop, setTimeout: noop, setInterval: noop, requestAnimationFrame: noop, matchMedia: () => ({ matches: false, addEventListener: noop }), RuntimeGuard: { report: noop, guard: noop }, GameEvents: { emit: noop, on: () => () => {} }, Blob: class {}, FileReader: class {}, URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams };
sandbox.window = sandbox; sandbox.addEventListener = noop; sandbox.location = { href: "", search: "", hash: "" }; sandbox.navigator = { userAgent: "node", language: "zh-CN" };
vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: "c.js" });
const R = e => vm.runInContext(e, sandbox);

let pass = 0, fail = 0;
function ok(cond, label, extra) { if (cond) { pass++; console.log("  PASS:", label); } else { fail++; console.log("  FAIL:", label, extra !== undefined ? " :: " + JSON.stringify(extra) : ""); } }

// 构造：战斗舰装 1 门小型激光炮（每齐射 1 发激光弹 + 3 燃料），可指定燃料/弹药量
const setup = `(function(fuel, ammoQty, ammoLoaded, ammoType){
  var st = {
    inventory: { ships: [ { instanceId:"s1", shipId:"rifter", enhancementLevel:0,
      fitted: { high:["e1"], mid:[], low:[], rig:[] } } ] },
    equipment: { instances: [ { instanceId:"e1", itemId:"t1_small_laser", enhancementLevel:0, installedOn:null } ], inventory: [] },
    ammo: ammoQty > 0 ? [ { type: ammoType || "laser", tier:"T1", qty: ammoQty, loaded: ammoLoaded !== false } ] : [],
    shipAssignments: { combat: "s1" },
    combat: { active:false, zone:"angel_corridor", activeShip:"s1", hp:{shield:0,armor:0,structure:0}, maxHp:{shield:0,armor:0,structure:0}, wave:1, enemies:[], lastStatus:null },
    skills: { capacitorManagement:{lvl:1,xp:0}, laserOps:{lvl:1,xp:0}, cannonOps:{lvl:1,xp:0}, missileOperations:{lvl:1,xp:0}, targeting:{lvl:1,xp:0}, defense:{lvl:1,xp:0}, shieldOperation:{lvl:1,xp:0}, armorReinforcement:{lvl:1,xp:0}, hullEngineering:{lvl:1,xp:0}, piloting:{lvl:1,xp:0} },
    resources: {}
  };
  ResourceRegistry.set(st, "consumable:fuel", fuel);
  return st;
})`;

console.log("\n[1] display 透出 supply 与 lastStatus");
{
  const d = R(`(function(){ var st = ${setup}(100000, 500, true, "laser"); return getCombatDisplayState(st, Date.now()); })()`);
  ok(d && d.supply && typeof d.supply === "object", "display.supply 存在", d && d.supply);
  ok(d.lastStatus === null, "无断火时 lastStatus = null", d.lastStatus);
  ok(Array.isArray(d.supply.ammoTypes) && d.supply.ammoTypes.join() === "laser",
     "ammoTypes 只含当前武器类型 laser", d.supply.ammoTypes);
}
{
  const d = R(`(function(){
    var st = ${setup}(0, 500, true, "laser");
    st.combat.lastStatus = "燃料不足，整轮武器未能开火";
    return getCombatDisplayState(st, Date.now());
  })()`);
  ok(d.lastStatus === "燃料不足，整轮武器未能开火", "断火原因透出（此前从未渲染）", d.lastStatus);
}
{
  const d = R(`(function(){ var st = ${setup}(100000, 500, true, "laser"); st.combat.lastStatus = ""; return getCombatDisplayState(st, Date.now()); })()`);
  ok(d.lastStatus === null, "空字符串 lastStatus 归一为 null", d.lastStatus);
}

console.log("\n[2] 燃料三档判定（与出击弹窗同口径）");
{
  const r0 = R(`(function(){ return getCombatDisplayState(${setup}(0, 500, true, "laser"), Date.now()).supply; })()`);
  ok(r0.fuel === "none" && r0.fuelRounds === 0, "燃料 0 → none / 0 轮", r0);
  // 每轮 = 齐射 3 燃料（无 DCU）→ 300 燃料 = 100 轮，恰在 low 边界内
  const rLow = R(`(function(){ return getCombatDisplayState(${setup}(300, 500, true, "laser"), Date.now()).supply; })()`);
  ok(rLow.fuel === "low" && rLow.fuelRounds === 100, "燃料 300 → low / 100 轮（边界内）", rLow);
  const rOk = R(`(function(){ return getCombatDisplayState(${setup}(303, 500, true, "laser"), Date.now()).supply; })()`);
  ok(rOk.fuel === null && rOk.fuelRounds === 101, "燃料 303 → 无告警 / 101 轮", rOk);
}

console.log("\n[3] 弹药四态判定");
{
  const none = R(`(function(){ return getCombatDisplayState(${setup}(100000, 0, true, "laser"), Date.now()).supply; })()`);
  ok(none.ammo === "none", "未装备弹药 → none", none);
  const wrong = R(`(function(){ return getCombatDisplayState(${setup}(100000, 50, true, "missile"), Date.now()).supply; })()`);
  ok(wrong.ammo === "wrong", "装填类型与武器不匹配 → wrong", wrong);
  const low = R(`(function(){ return getCombatDisplayState(${setup}(100000, 100, true, "laser"), Date.now()).supply; })()`);
  ok(low.ammo === "low" && low.ammoVolleys === 100, "弹药 100 → low / 100 齐射（边界内）", low);
  const okc = R(`(function(){ return getCombatDisplayState(${setup}(100000, 101, true, "laser"), Date.now()).supply; })()`);
  ok(okc.ammo === null && okc.ammoVolleys === 101, "弹药 101 → 无告警 / 101 齐射", okc);
  const unloaded = R(`(function(){ return getCombatDisplayState(${setup}(100000, 500, false, "laser"), Date.now()).supply; })()`);
  ok(unloaded.ammo === "none", "有库存但全部未装填 → none（只看已装填）", unloaded);
}

console.log("\n[4] 无武器时不误报弹药");
{
  const d = R(`(function(){
    var st = ${setup}(100000, 0, true, "laser");
    st.inventory.ships[0].fitted.high = [];
    st.equipment.instances = [];
    return getCombatDisplayState(st, Date.now()).supply;
  })()`);
  ok(d.ammo === null && d.ammoTypes.length === 0, "没装武器 → ammo null 且 ammoTypes 为空", d);
}

console.log("\n[5] 告警文案（镜像 renderCombatSupplyStatus 逻辑）");
function alertLines(supply, lastStatus) {
  const lines = [];
  if (supply) {
    if (supply.fuel === "none") lines.push("⛔ 燃料耗尽，武器无法开火");
    else if (supply.fuel === "low") lines.push("⚠ 燃料仅够约 " + (Number(supply.fuelRounds) || 0).toLocaleString() + " 轮 —— 请及时补给");
    if (supply.ammo === "none") lines.push("⛔ 未装备弹药，将无法开火");
    else if (supply.ammo === "wrong") lines.push("⛔ 弹药类型错误，已装填弹药与当前武器不匹配");
    else if (supply.ammo === "low") lines.push("⚠ 已装填弹药仅够约 " + (Number(supply.ammoVolleys) || 0).toLocaleString() + " 次齐射");
  }
  const blocked = Boolean(supply && (supply.fuel === "none" || supply.ammo === "none" || supply.ammo === "wrong"));
  if (blocked && lastStatus) lines.push("⛔ " + lastStatus);
  return lines;
}
{
  const s = R(`(function(){ return getCombatDisplayState(${setup}(0, 0, true, "laser"), Date.now()).supply; })()`);
  const lines = alertLines(s, "燃料不足，整轮武器未能开火");
  ok(lines.length === 3, "断油+无弹 → 3 行（含 lastStatus）", lines);
  ok(lines.some(l => l.indexOf("⛔ 燃料耗尽") === 0), "含「燃料耗尽，武器无法开火」");
  ok(lines.some(l => l.indexOf("⛔ 燃料不足，整轮武器未能开火") === 0), "含断火原因 lastStatus");
}
{
  const s = R(`(function(){ return getCombatDisplayState(${setup}(300, 100, true, "laser"), Date.now()).supply; })()`);
  const lines = alertLines(s, null);
  ok(lines.length === 2 && lines.every(l => l.indexOf("⚠") === 0), "双 low → 2 行黄色（不阻断）", lines);
}
{
  const s = R(`(function(){ return getCombatDisplayState(${setup}(100000, 500, true, "laser"), Date.now()).supply; })()`);
  ok(alertLines(s, null).length === 0, "补给充足 → 无告警（告警条隐藏）");
}
{
  const s = R(`(function(){ return getCombatDisplayState(${setup}(100000, 500, true, "laser"), Date.now()).supply; })()`);
  ok(alertLines(s, "燃料不足，整轮武器未能开火").length === 0,
     "补给正常时即便残留旧 lastStatus 也不展示（防陈旧信息）");
}

console.log("\n共 " + pass + "/" + (pass + fail) + " 通过");
process.exit(fail === 0 ? 0 : 1);
