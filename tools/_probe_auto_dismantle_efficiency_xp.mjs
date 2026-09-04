import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const js = readFileSync(resolve(ROOT, "js/ui/render.js"), "utf8");
const css = readFileSync(resolve(ROOT, "css/components.css"), "utf8");

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; console.log("  PASS " + name); }
  else { failed++; console.log("  FAIL " + name); }
}

console.log("Probe: auto-dismantle efficiency + dual-xp display");

// HTML structure
check("html: ad-efficiency element", /id=["']ad-efficiency["']/.test(html));
check("html: ad-xp-ship element", /id=["']ad-xp-ship["']/.test(html));
check("html: ad-xp-refining element", /id=["']ad-xp-refining["']/.test(html));
check("html: no stale ad-xp element", !/id=["']ad-xp["']/.test(html));
check("html: 拆解效率 label", /拆解效率/.test(html));
check("html: 舰船工程经验 label", /舰船工程经验/.test(html));
check("html: 冶炼经验 label", /冶炼经验/.test(html));
check("html: ad-xp-hint element", /class=["']ad-xp-hint["']/.test(html));
check("html: ad-xp-hint text", /两份经验来源不同/.test(html));

// Version bumps
check("html: render.js?v=18", /render\.js\?v=18/.test(html));
check("html: components.css?v=33", /components\.css\?v=33/.test(html));
check("html: selectors.js?v=69", /selectors\.js\?v=69/.test(html));

// JS renderDismantleDisplay updates new IDs and uses efficiency
const fnMatch = js.match(/function renderDismantleDisplay\([\s\S]*?\n\}/);
const fn = fnMatch ? fnMatch[0] : "";
check("js: renderDismantleDisplay exists", fn.length > 0);
check("js: sets ad-efficiency", /getElementById\(["']ad-efficiency["']\)[\s\S]*?display\.efficiency\.toFixed\(2\)/.test(fn));
check("js: sets ad-efficiency title", /getElementById\(["']ad-efficiency["']\)[\s\S]*?efficiency\.title\s*=\s*display\.efficiencyTooltip/.test(js));
check("js: sets ad-xp-ship", /getElementById\(["']ad-xp-ship["']\)/.test(fn));
check("js: sets ad-xp-refining", /getElementById\(["']ad-xp-refining["']\)/.test(fn));
check("js: no stale ad-xp reference", !/getElementById\(["']ad-xp["']\)/.test(js));
check("js: efficiency used", /display\.efficiency/.test(fn));
check("js: ad-efficiency in click list", /'me-value'[\s\S]*?'ad-efficiency'/.test(js) || /"me-value"[\s\S]*?"ad-efficiency"/.test(js));

// Selectors: getDismantleDisplayState returns efficiencyTooltip
const sel = readFileSync(resolve(ROOT, "js/core/selectors.js"), "utf8");
check("js: getDismantleDisplayState builds efficiencyTooltip", /efficiencyTooltip\s*=\s*getSmeltingEfficiencyBreakdown/.test(sel));
check("js: getDismantleDisplayState returns efficiencyTooltip", /return\s*\{[\s\S]*?efficiency, efficiencyTooltip/.test(sel));

// Runtime: getSmeltingEfficiencyBreakdown must produce non-empty text for a dismantle-shaped display
import { pathToFileURL } from "node:url";
import vm from "node:vm";
const src = readFileSync(resolve(ROOT, "js/core/selectors.js"), "utf8");
const stub = new Proxy(function () { return stub; }, {
  get: () => stub, apply: () => stub, construct: () => stub
});
const sandbox = vm.createContext({ console, Math, JSON, Date, Array, Object, Number, String, RegExp, Proxy, Symbol });
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
try {
  vm.runInContext("var module=undefined;var exports=undefined;(function(){" + src + "\n;globalThis.__B=getSmeltingEfficiencyBreakdown;})();", sandbox, { filename: "selectors.js" });
  const B = sandbox.__B;
  const sampleDisplay = {
    level: 10, skillEfficiency: 1.2, shipBonus: 0.1, rigBonus: 0, pump: null,
    stationLogisticsMultiplier: 1.25, stationLogistics: { text: "OK" },
    researchMultiplier: 1.1, shipEnhanceSmelt: 1, implantRefineEff: 1.06,
    boosterSmeltSpeed: 1, legionRefine: 1, adBuffMult: 1, efficiency: 1.72
  };
  const tip = typeof B === "function" ? B(sampleDisplay) : "";
  check("runtime: breakdown returns string", typeof tip === "string");
  check("runtime: breakdown non-empty", tip.length > 0);
  check("runtime: breakdown has 最终效率", /最终效率/.test(tip));
} catch (e) {
  check("runtime: breakdown executed without throwing (" + (e && e.message) + ")", false);
}

// CSS styling
check("css: #ad-efficiency styled", /#ad-efficiency\s*\{/.test(css));
check("css: #ad-xp-ship styled", /#ad-xp-ship\s*[\,\{]/.test(css));
check("css: #ad-xp-refining styled", /#ad-xp-refining\s*[\,\{]/.test(css));
check("css: no stale #ad-xp rule", !/#ad-xp\s*\{/.test(css));
check("css: .ad-xp-hint styled", /\.ad-xp-hint\s*\{/.test(css));

console.log(`\nResults: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
