// 验证离线结算时打捞臂/MTU 燃料不被双计：
// ① __combatLogOfflineFlush=true 期间 ResourceRegistry.spend(consumable:fuel) 不触发 combat-log hook
// ② 离线结算后 combatLogMergeOffline 依据 resourceNet 只记一次
// ③ 模拟 flush 外调用打捞臂/MTU 燃料（旧 bug 位置）时，若忘记设 flush 标志则会被双计
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
class MutationObserverMock { observe() {} disconnect() {} takeRecords() { return []; } }
const sandbox = {
  console, window: null, document: documentMock,
  localStorage: { getItem: () => null, setItem: noop },
  alert: noop, setTimeout: noop, setInterval: noop, requestAnimationFrame: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  RuntimeGuard: { report: noop, guard: noop },
  GameEvents: { emit: noop, on: () => () => {} },
  Blob: class {}, FileReader: class {},
  URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams,
  MutationObserver: MutationObserverMock,
  // 拦截动态 import（ship3d-loader.js 等 UI 脚本），避免 ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING
  __ship3dImportResolved: false
};
sandbox.window = sandbox; sandbox.addEventListener = noop; sandbox.location = { href: "", search: "", hash: "" }; sandbox.navigator = { userAgent: "node" };
vm.createContext(sandbox, { importModuleDynamically: () => Promise.resolve({ default: {} }) });
vm.runInContext(combined, sandbox, { filename: "c.js", importModuleDynamically: () => Promise.resolve({ default: {} }) });
const R = e => vm.runInContext(e, sandbox);

let pass = 0, fail = 0;
function ok(cond, label, extra) { if (cond) { pass++; console.log("  PASS:", label); } else { fail++; console.log("  FAIL:", label, extra !== undefined ? " :: " + JSON.stringify(extra) : ""); } }

const reset = () => R(`(function(){
  var st = gameState;
  st.combat = { active:false, hp:{shield:100,armor:100,structure:100}, maxHp:{shield:100,armor:100,structure:100}, repairs:{}, runLog:null, salvageArmActive:true };
  st.currentAction = { active:false, skill:"" };
  ResourceRegistry.set(gameState, "consumable:fuel", 1000000);
  return ensureCombatRunLog() ? "READY" : "NO_RUNLOG";
})()`);

console.log("\n[0] 环境与初始化");
ok(reset() === "READY", "runLog 初始化成功（salvageArmActive=true）");
ok(R(`ResourceRegistry.spend.__combatLogHooked === true`), "ResourceRegistry.spend 已 hook");

console.log("\n[1] 离线 flush 临界区屏蔽 hook");
{
  const r = R(`(function(){
    var base = gameState.combat.runLog.fuelSpent;
    globalThis.__combatLogOfflineFlush = true;
    ResourceRegistry.spend(gameState, "consumable:fuel", 5555);   // 模拟 flush 内 RR.spend
    var during = gameState.combat.runLog.fuelSpent;
    globalThis.__combatLogOfflineFlush = false;
    return { base:base, during:during };
  })()`);
  ok(r.during === r.base, "flush 临界区内 RR.spend 不触发 fuelSpent 记账", r);
}

console.log("\n[2] 离线 merge 只从 resourceNet 反推一次");
{
  const r = R(`(function(){
    var before = gameState.combat.runLog.fuelSpent;
    combatLogMergeOffline({ kills:10, resourceNet:{ "consumable:fuel": -5555 } });
    return { before:before, after:gameState.combat.runLog.fuelSpent };
  })()`);
  ok(r.after === r.before + 5555, "merge 只记一次（+5555），无双计", r);
}

console.log("\n[3] 模拟 flush 内同时发生主燃料+打捞臂+MTU（均在临界区）");
{
  const r = R(`(function(){
    ensureCombatRunLog();
    var base = gameState.combat.runLog.fuelSpent;
    globalThis.__combatLogOfflineFlush = true;
    // 主燃料
    ResourceRegistry.spend(gameState, "consumable:fuel", 12000);
    // 打捞臂
    ResourceRegistry.spend(gameState, "consumable:fuel", 3400);
    // MTU
    ResourceRegistry.spend(gameState, "consumable:fuel", 2100);
    var during = gameState.combat.runLog.fuelSpent;
    globalThis.__combatLogOfflineFlush = false;
    combatLogMergeOffline({ kills:10, resourceNet:{ "consumable:fuel": -(12000+3400+2100) } });
    return { base:base, during:during, after:gameState.combat.runLog.fuelSpent };
  })()`);
  ok(r.during === r.base, "临界区三笔 spend 均不触发 hook", r);
  ok(r.after === r.base + 12000 + 3400 + 2100, "merge 后总燃料 = 主燃料+打捞臂+MTU（仅一次）", r);
}

console.log("\n[4] 反向哨兵：若 flush 标志泄漏或忘记设置，会双计");
{
  const r = R(`(function(){
    ensureCombatRunLog();
    var base = gameState.combat.runLog.fuelSpent;
    globalThis.__combatLogOfflineFlush = false;   // 故意不在临界区
    gameState.combat.active = true;               // 模拟在线战斗上下文，让 hook 先记一次
    ResourceRegistry.spend(gameState, "consumable:fuel", 1234);
    var afterDirect = gameState.combat.runLog.fuelSpent;
    combatLogMergeOffline({ kills:10, resourceNet:{ "consumable:fuel": -1234 } });
    gameState.combat.active = false;
    return { base:base, afterDirect:afterDirect, afterMerge:gameState.combat.runLog.fuelSpent };
  })()`);
  // 这个用例演示：不在临界区时 hook 会先记 1234，merge 再记 1234，共双计
  ok(r.afterDirect === r.base + 1234, "非临界区 spend 被 hook 记账（+1234）", r);
  ok(r.afterMerge === r.base + 2468, "非临界区 spend + merge = 双计（+2468），反向哨兵成立", r);
}

console.log("\n[5] 在线战斗不受 flush 标志误伤");
{
  const r = R(`(function(){
    ensureCombatRunLog();
    var base = gameState.combat.runLog.fuelSpent;
    gameState.combat.active = true;
    ResourceRegistry.spend(gameState, "consumable:fuel", 777);
    return { base:base, after:gameState.combat.runLog.fuelSpent };
  })()`);
  ok(r.after === r.base + 777, "在线战斗正常记账 +777", r);
}

console.log("\n共 " + pass + "/" + (pass + fail) + " 通过");
process.exit(fail === 0 ? 0 : 1);
