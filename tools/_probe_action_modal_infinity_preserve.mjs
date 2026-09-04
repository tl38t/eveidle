import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const html = fs.readFileSync(path.join(root, "index.html"), "utf-8");
const js = fs.readFileSync(path.join(root, "js/ui/action-modal.js"), "utf-8");

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.error(`FAIL: ${label}`); }
}

// HTML version bump
check("html: action-modal.js ?v=10", /action-modal\.js\?v=10/.test(html));

// renderActionConfirmation: preserveCount should not wipe selected class
check("js: renderActionConfirmation only removes selected when !preserveCount",
  /if \(infinityBtn && !opts\.preserveCount\) infinityBtn\.classList\.remove\("selected"\)/.test(js)
);

// refreshActionConfirmation: detect old -1 and preserve
check("js: refreshActionConfirmation detects wasInfinity",
  /const wasInfinity = \(oldCount === "-1"\)/.test(js)
);
check("js: refreshActionConfirmation preserves -1 value when unlimited",
  /if \(wasInfinity && fresh\.unlimited\) \{[\s\S]*?input\.value = "-1"/.test(js)
);
check("js: refreshActionConfirmation re-adds selected class on infinity refresh",
  /if \(wasInfinity && fresh\.unlimited\) \{[\s\S]*?if \(infinityBtn\) infinityBtn\.classList\.add\("selected"\)/.test(js)
);
check("js: refreshActionConfirmation keeps infinity summary on refresh",
  /if \(sumEl\) sumEl\.innerHTML = '<span class="ai-label">总耗时：<\/span>∞ 无限'/.test(js)
);

// Non-infinity path should still clamp positive counts
check("js: refreshActionConfirmation still clamps finite count to >=1",
  /let v = Math\.max\(1, parseInt\(oldCount\) \|\| 1\)/.test(js)
);
check("js: refreshActionConfirmation still respects maxCount for finite counts",
  /if \(!noCap && mc > 0\) v = Math\.min\(mc, v\)/.test(js)
);

console.log(`\nResults: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
