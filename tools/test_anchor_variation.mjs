// tools/test_anchor_variation.mjs — Phase 3 Commit 4：验证 Anchor 区间 + Seed 变异
//
// 三条断言（每个新增锚点 × 每档）：
//   ① 确定性：同 (anchor, shipClass, seed) → 同 profile.hull（逐字段相等）
//   ② 变异性：不同 seed → 至少 3 个数值字段差异 > 1e-3（证明 seed 真正消费了区间）
//   ③ 区间约束：所有产出值都落在锚点定义的 [min,max] 区间内（不越界）
//
// Spear 是标量锚点（无区间），单独走「确定性 + 零变异」断言。
//
// 用法：node tools/test_anchor_variation.mjs

import { buildProfile, ANCHORS, SHIP_CLASSES } from "../js/render3d/shipfactory2/ShipProfile.js";

// 简易确定性 rng（mulberry32），与 ShipContext 同算法
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFromSeed(seed) {
  const n = typeof seed === "string" ? hashStr(seed) : (seed | 0);
  return mulberry32(n >>> 0);
}
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const NUMERIC_KEYS = ["len", "noseFat", "mid", "tail", "scale", "wingSpan", "ringRadius", "radialSegments", "widthRatio", "twist", "asymmetry"];
const INTEGER_KEYS = new Set(["radialSegments", "engines", "mounts"]);

// 取锚点某档的「原始区间/标量」用于越界检查
function getRaw(anchorId, shipClass) {
  const A = ANCHORS[anchorId];
  return A.perClass[shipClass] || A.perClass.frigate;
}

function inBounds(value, raw) {
  if (Array.isArray(raw)) return value >= raw[0] - 1e-6 && value <= raw[1] + 1e-6;
  return Math.abs(value - raw) < 1e-6; // 标量必须精确
}

function diffCount(a, b) {
  let n = 0;
  for (const k of NUMERIC_KEYS) {
    if (Math.abs(a[k] - b[k]) > 1e-3) n++;
  }
  return n;
}

const SEEDS = ["alpha", "bravo", "charlie", "delta", "echo"];
const NEW_ANCHORS = Object.keys(ANCHORS).filter((a) => a !== "Spear");

let totalPass = 0, totalFail = 0;
const failures = [];

function record(ok, label, detail = "") {
  if (ok) totalPass++;
  else { totalFail++; failures.push(label + (detail ? " — " + detail : "")); }
}

// ── Spear：标量锚点，必须确定性 + 零变异 ──
for (const cls of SHIP_CLASSES) {
  const p1 = buildProfile({ anchor: "Spear", shipClass: cls, rng: rngFromSeed("any-seed-A") }).hull;
  const p2 = buildProfile({ anchor: "Spear", shipClass: cls, rng: rngFromSeed("different-seed-B") }).hull;
  const same = diffCount(p1, p2) === 0;
  record(same, `Spear/${cls} 确定性+零变异`, same ? "" : `diff=${diffCount(p1, p2)}（应为 0，Spear 是标量锚点）`);
}

// ── 新锚点：确定性 + 变异性 + 区间约束 ──
for (const anchor of NEW_ANCHORS) {
  for (const cls of SHIP_CLASSES) {
    const raw = getRaw(anchor, cls);

    // ① 确定性：同 seed 必同输出
    const a = buildProfile({ anchor, shipClass: cls, rng: rngFromSeed("seed-X") }).hull;
    const b = buildProfile({ anchor, shipClass: cls, rng: rngFromSeed("seed-X") }).hull;
    record(diffCount(a, b) === 0, `${anchor}/${cls} 确定性`, `diff=${diffCount(a, b)}`);

    // ② 变异性：跨 5 个 seed，至少有一对产出差异 >= 3 字段
    const outputs = SEEDS.map((s) => buildProfile({ anchor, shipClass: cls, rng: rngFromSeed(s) }).hull);
    let maxDiff = 0;
    for (let i = 0; i < outputs.length; i++) {
      for (let j = i + 1; j < outputs.length; j++) {
        const d = diffCount(outputs[i], outputs[j]);
        if (d > maxDiff) maxDiff = d;
      }
    }
    record(maxDiff >= 3, `${anchor}/${cls} 变异性`, `maxDiff=${maxDiff}（应 >=3）`);

    // ③ 区间约束：每个产出都在 raw 区间内
    for (let i = 0; i < outputs.length; i++) {
      for (const k of NUMERIC_KEYS) {
        const ok = inBounds(outputs[i][k], raw[k]);
        record(ok, `${anchor}/${cls} seed=${SEEDS[i]} 区间 ${k}=${outputs[i][k]}`, ok ? "" : `raw=${JSON.stringify(raw[k])}`);
      }
    }
  }
}

// ── 报告 ──
console.log("=== Anchor Variation Test (Phase 3 Commit 4) ===");
console.log(`Anchors tested: Spear(scalar) + ${NEW_ANCHORS.join(", ")}`);
console.log(`Classes: ${SHIP_CLASSES.join(", ")}`);
console.log(`Seeds: ${SEEDS.join(", ")}\n`);

// 打一个「同锚点不同 seed」的对比表，肉眼可见变异
console.log("=== Sample: Needle/frigate × 3 seeds ===");
for (const s of SEEDS.slice(0, 3)) {
  const h = buildProfile({ anchor: "Needle", shipClass: "frigate", rng: rngFromSeed(s) }).hull;
  console.log(`  seed=${s.padEnd(8)} len=${h.len.toFixed(3)} mid=${h.mid.toFixed(3)} noseFat=${h.noseFat.toFixed(3)} tail=${h.tail.toFixed(3)} wingSpan=${h.wingSpan.toFixed(3)} widthRatio=${h.widthRatio.toFixed(3)}`);
}
console.log("");
console.log("=== Sample: Broken/cruiser × 3 seeds (asymmetry 应有变异) ===");
for (const s of SEEDS.slice(0, 3)) {
  const h = buildProfile({ anchor: "Broken", shipClass: "cruiser", rng: rngFromSeed(s) }).hull;
  console.log(`  seed=${s.padEnd(8)} mid=${h.mid.toFixed(3)} asymmetry=${h.asymmetry.toFixed(3)} twist=${h.twist.toFixed(3)} widthRatio=${h.widthRatio.toFixed(3)}`);
}
console.log("");

console.log(`PASS: ${totalPass}`);
console.log(`FAIL: ${totalFail}`);
if (totalFail > 0) {
  console.log("\n--- FAILURES ---");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("\nALL_PASS");
