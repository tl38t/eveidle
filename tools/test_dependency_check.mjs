// tools/test_dependency_check.mjs — Phase 3 Commit 3 架构护栏
//
// 目的：确保 Generator（纯几何执行器）不直接依赖任何「配置 / 预设 / 锚点」模块。
//   违反 AI_DEVELOPMENT_RULES §19（Generator 禁止直接依赖配置）。
//   若任何 Generator import 了 Preset / Config / Anchor（含 ./ShipProfile.js），或代码里仍出现
//   "preset" 标识符（ctx.preset / .preset / const {preset}），直接 FAIL。
//
// 设计动机（来自用户）：以后 Engine/Weapon/Ribbon/... 都必须通过这条检查；
//   可防止某个 AI 偷懒 `import HULL_PRESETS`，导致整条「Game Spec → Style Resolver →
//   ShipProfile → ShipContext → Generators」数据流歪掉。
//
// 运行：node tools/test_dependency_check.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEN_DIR = join(__dirname, "..", "js", "render3d", "shipfactory2");

// 受检的 Generator 列表（纯几何执行器，禁止 import 配置 / 读 preset）
const GENERATORS = [
  "HullGenerator.js",
  "RibbonGenerator.js",
  "ArmorGenerator.js",
  "PanelGenerator.js",
  "EngineGenerator.js",
  "WeaponGenerator.js",
];

// 禁止的 import 源路径（大小写不敏感）：含这些词即视为配置模块
const FORBIDDEN_SOURCE = /profile|config|preset|anchor|preset_mid/i;
// 禁止的绑定名（大小写不敏感）：导入名为 Preset / Config / Anchor 系列
const FORBIDDEN_BINDING = /preset|config|anchor/i;

// 去掉注释，避免注释里的 "preset" 误判
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // 块注释
    .replace(/\/\/.*$/gm, "");           // 行注释（m 标志：逐行）
}

// 提取所有 `import ... from "source"` 的 { source, named[] }
function parseImports(src) {
  const imports = [];
  const re = /import\s+([^;]+?)\s+from\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const clause = m[1];
    const source = m[2];
    const named = [];
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      braced[1].split(",").forEach((s) => {
        const name = s.trim().split(/\s+as\s+/).pop().trim();
        if (name) named.push(name);
      });
    }
    const ns = clause.match(/\*\s+as\s+(\w+)/);   // 命名空间导入 import * as X
    if (ns) named.push(ns[1]);
    imports.push({ source, named });
  }
  return imports;
}

let allPass = true;
for (const file of GENERATORS) {
  const path = join(GEN_DIR, file);
  const src = stripComments(readFileSync(path, "utf8"));
  const imports = parseImports(src);

  const problems = [];
  // 1) import 源是否含禁止词（Generator 禁止 import ./*Profile 等配置模块）
  for (const imp of imports) {
    if (FORBIDDEN_SOURCE.test(imp.source)) {
      problems.push(`禁止 import 源 "${imp.source}"（配置/预设模块）`);
    }
    // 2) 绑定名是否含禁止词
    for (const n of imp.named) {
      if (FORBIDDEN_BINDING.test(n)) {
        problems.push(`禁止 import 绑定 "${n}"（来自 "${imp.source}"）`);
      }
    }
  }
  // 3) 代码中出现 preset 标识符（ctx.preset / .preset / const {preset}）→ Generator 不应知道 Preset
  if (/\bpreset\b/i.test(src)) {
    problems.push('代码中出现 "preset" 标识符（Generator 不应依赖预设）');
  }

  if (problems.length) {
    allPass = false;
    console.log(`FAIL  ${file}`);
    for (const p of problems) console.log(`        - ${p}`);
  } else {
    console.log(`PASS  ${file}`);
  }
}

console.log(allPass ? "\nALL_PASS" : "\nDEPENDENCY_VIOLATION");
process.exit(allPass ? 0 : 1);
