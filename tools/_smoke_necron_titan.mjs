// 死亡空间 10/10 亡灵统御者：泰坦深绿死灵模型接线回归探针（2026-09-24）。
// 纯源级静态断言，不依赖 three / WebGL，可随 `node tools/_smoke_necron_titan.mjs` 重复跑。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

const titan = read("js/render3d/titan/TitanFactory.js");
const ship3d = read("js/ui/ship3d.js");
const combat = read("js/ui/combat-render.js");

const checks = [];
const ok = (name, cond) => checks.push([name, !!cond]);

// TitanFactory：necro 调色板 + green 核心色
ok("TitanFactory.DEFENSE.necro 存在", /necro:\s*\{\s*shell:/.test(titan));
ok("TitanFactory.coreHue 支持 green", /coreHue\s*=\s*kind\s*=>[\s\S]*kind\s*===\s*"green"/.test(titan));
ok("TitanFactory.green 色值 = 0x39ff7a", /kind\s*===\s*"green"\s*\?\s*0x39ff7a/.test(titan));

// ship3d：buildEnemySpec 支持 titan 覆盖
ok("ship3d.buildEnemySpec 接受 titanVisual 参数", /export function buildEnemySpec\(zoneFaction, level, titanVisual\)/.test(ship3d));
ok("ship3d.buildEnemySpec 返回 titan 分支", /return\s*\{\s*id:\s*"enemy-titan",\s*titan:\s*titanVisual/.test(ship3d));
ok("ship3d.TitanFactory import ?v=2", /TitanFactory\.js\?v=2/.test(ship3d));

// combat-render：侧栏 + 大图两处接线
ok("combat.isNecron 检测 dedTier===10", /isNecron\s*=\s*!!\(display\.deathspace && display\.deathspace\.dedTier === 10\)/.test(combat));
ok("combat.necronVisual 传入 buildEnemySpec", /buildEnemySpec\(zoneFaction, enemyLevel, necronVisual\)/.test(combat));
ok("combat.侧栏护盾绿 0x39ff7a", /shieldColor:\s*isNecron\s*\?\s*0x39ff7a\s*:\s*0xff3a3a/.test(combat));
ok("combat.侧栏背景深绿 0x07140d", /background:\s*isNecron\s*\?\s*0x07140d\s*:\s*0x1a0808/.test(combat));
ok("combat.大图 fallback 传 necro", /display\.deathspace\.dedTier === 10\)\s*\?\s*\{\s*defense:\s*"necro"/.test(combat));
ok("combat.大图背景深绿", /which === "enemy"\s*\?\s*\(display\.deathspace && display\.deathspace\.dedTier === 10\s*\?\s*0x07140d/.test(combat));

let failed = 0;
for (const [name, pass] of checks) {
  console.log((pass ? "PASS " : "FAIL ") + name);
  if (!pass) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} PASS`);
if (failed) { console.error("NECRO TITAN SMOKE FAILED"); process.exit(1); }
console.log("NECRO TITAN SMOKE ALL PASS");
