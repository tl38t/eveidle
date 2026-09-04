import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let passed = 0, failed = 0;
function ok(label, cond) {
  if (cond) { passed++; console.log("PASS", label); }
  else { failed++; console.error("FAIL", label); }
}

const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const combatCss = fs.readFileSync(path.join(root, "css", "combat.css"), "utf8");
const combatRender = fs.readFileSync(path.join(root, "js", "ui", "combat-render.js"), "utf8");

// HTML: enemy side now has main + formation column
ok("html: combat-enemy-main wrapper exists", indexHtml.includes('class="combat-enemy-main"'));
ok("html: combat-enemy-formation-column exists", indexHtml.includes('class="combat-enemy-formation-column"'));
ok("html: HOSTILE FORMATION kicker moved into formation column", /combat-enemy-formation-column[\s\S]*HOSTILE FORMATION/.test(indexHtml));
ok("html: combat.css v bumped", indexHtml.includes('combat.css?v=20'));
ok("html: combat-render.js v bumped", indexHtml.includes('combat-render.js?v=49'));

// CSS: enemy side flex row + main/column + vertical formation + card full-width + mini bars
ok("css: .combat-enemy-side flex-direction row", /\.combat-enemy-side\s*\{[\s\S]*?flex-direction:\s*row/.test(combatCss));
ok("css: .combat-enemy-main exists", combatCss.includes('.combat-enemy-main'));
ok("css: .combat-enemy-formation-column exists", combatCss.includes('.combat-enemy-formation-column'));
ok("css: .combat-enemy-formation flex-direction column", /\.combat-enemy-formation\s*\{[\s\S]*?flex-direction:\s*column/.test(combatCss));
ok("css: .combat-enemy-card width 100%", /\.combat-enemy-card\s*\{[\s\S]*?width:\s*100%/.test(combatCss));
ok("css: enemy card uses .lcs-mini-bars", combatCss.includes('.combat-enemy-card .lcs-mini-bars'));
ok("css: mobile enemy side column layout", /@media\s*\(\s*max-width:\s*720px\s*\)[\s\S]*\.combat-enemy-side\s*\{[\s\S]*?flex-direction:\s*column/.test(combatCss));

// JS: helper + usage
ok("js: renderEnemyMiniBars helper exists", combatRender.includes('function renderEnemyMiniBars'));
ok("js: formation cards use renderEnemyMiniBars", combatRender.includes('renderEnemyMiniBars(enemy.hp, enemy.maxHp)'));
ok("js: old single combat-enemy-card-bar no longer rendered", !combatRender.includes('combat-enemy-card-bar'));

console.log(`\n${passed}/${passed + failed} 通过`);
process.exit(failed ? 1 : 0);
