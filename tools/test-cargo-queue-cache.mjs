// 货柜出率预览缩放 + queue.js 缓存破坏 专项测试（RC6 复审交付物）
// 运行：node tools/test-cargo-queue-cache.mjs
//
// 覆盖 Codex 复审两项：
//  (1) queue.js 缓存版本对应关系：旧 index 引用 ?v=1 且旧 queue.js 无 moveQueueItemToTop
//      （RC5 缓存升级若不 bump 会 ReferenceError）；新 index 引用 ?v=2 且新 queue.js 含该函数。
//  (2) 货柜出率预览数量与真实开箱一致：S/M/L/XL 每档抽查 矿物/行星资源/弹药（随尺寸缩放）
//      与 loot/implant/blueprint（不缩放）。

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

let passed = 0, failed = 0;
const failures = [];
function check(cond, label) {
  if (cond) { passed += 1; }
  else { failed += 1; failures.push(label); }
}

// ============================================================
// A. queue.js 缓存版本对应关系
// ============================================================
const queueNew = fs.readFileSync(path.join(root, "js/core/queue.js"), "utf8");
const hasNewFn = /function\s+moveQueueItemToTop\s*\(/.test(queueNew);
check(/js\/core\/queue\.js\?v=2\b/.test(html), "A1 index.html 引用 queue.js?v=2（缓存破坏）");
check(!/js\/core\/queue\.js\?v=1\b/.test(html), "A2 index.html 不再引用 queue.js?v=1");
check(hasNewFn, "A3 queue.js 定义 moveQueueItemToTop");

// RC5 基线（8f293f9）：旧 index 引用 ?v=1，旧 queue.js 无 moveQueueItemToTop —— 证明 bump 是必要破坏
const rc5Html = execSync("git show 8f293f9:index.html", { cwd: root }).toString();
const rc5Queue = execSync("git show 8f293f9:js/core/queue.js", { cwd: root }).toString();
check(/js\/core\/queue\.js\?v=1\b/.test(rc5Html), "A4 RC5 index.html 引用 queue.js?v=1（旧缓存基线）");
check(!/js\/core\/queue\.js\?v=2\b/.test(rc5Html), "A5 RC5 index.html 无 ?v=2");
check(!/function\s+moveQueueItemToTop\s*\(/.test(rc5Queue), "A6 RC5 queue.js 无 moveQueueItemToTop（旧缓存会 ReferenceError）");

// 一键置顶 调用方存在（确保 bump 后浏览器能取到新函数，不会 ReferenceError）
let callers = 0;
for (const f of ["js/ui/action-modal.js", "js/ui/render.js", "js/ui/shell-render.js", "js/core/selectors.js", "js/core/actions.js"]) {
  const p = path.join(root, f);
  if (fs.existsSync(p) && /moveQueueItemToTop/.test(fs.readFileSync(p, "utf8"))) callers += 1;
}
check(callers >= 1, `A7 至少一处调用方引用 moveQueueItemToTop（实际 ${callers}）`);

// 同批编辑 cargo.js（qtyText 修复）同样需缓存破坏：index.html 引用 ?v=5，且文件含被改函数
const cargoNew = fs.readFileSync(path.join(root, "js/data/cargo.js"), "utf8");
check(/js\/data\/cargo\.js\?v=5\b/.test(html), "A8 index.html 引用 cargo.js?v=5（qtyText 修复缓存破坏）");
check(/function\s+getCargoDropInfo\s*\(/.test(cargoNew), "A9 cargo.js 定义 getCargoDropInfo");

// ============================================================
// B. 货柜出率预览缩放（vm 加载 cargo.js 纯函数）
// ============================================================
const noop = () => {};
const sandbox = { console, Math, Date, window: null };
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
sandbox.window.removeEventListener = noop;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "js/data/cargo.js"), "utf8"), sandbox, { filename: "js/data/cargo.js" });
const G = (name) => vm.runInContext(name, sandbox);
const getCargoDropInfo = G("getCargoDropInfo");
const CARGO_T1_SIZE_MUL = G("CARGO_T1_SIZE_MUL");
const CARGO_POOLS = G("CARGO_POOLS");
const CARGO_BLUEPRINT_BY_SIZE = G("CARGO_BLUEPRINT_BY_SIZE");
check(typeof getCargoDropInfo === "function", "B0 加载 getCargoDropInfo");
check(typeof CARGO_T1_SIZE_MUL === "object", "B0b 加载 CARGO_T1_SIZE_MUL");

const SIZES = ["S", "M", "L", "XL"];

// 解析 "×75" / "48~160" / "50,000~250,000" → {lo, hi}
function parseQty(text) {
  if (text == null) return null;
  const s = String(text).replace(/×/g, "").replace(/,/g, "");
  if (s.includes("~")) { const [a, b] = s.split("~").map(Number); return { lo: a, hi: b }; }
  return { lo: Number(s), hi: Number(s) };
}
function findEntry(content, id) {
  for (const tier of ["T1", "T2", "T3", "T4"]) {
    const e = (content[tier] || []).find((x) => x.id === id);
    if (e) return e;
  }
  return null;
}
// T2 池专用查找：loot/planetary 在 T1（保底包，随尺寸缩放）与 T2（奖池，loot 不缩放/planetary 缩放）各有一份，
// 需精确比对 T2 奖池条目，避免取到 T1 保底包导致基数/缩放规则错位。
function findEntryT2(content, id) {
  return (content.T2 || []).find((x) => x.id === id);
}
function poolBase(tier, id) {
  return (CARGO_POOLS[tier] || []).find((x) => x.id === id);
}

for (const size of SIZES) {
  const info = getCargoDropInfo(size);
  const mul = CARGO_T1_SIZE_MUL[size];
  // 矿物（T2）：随尺寸缩放
  const minEntry = findEntry(info.content, "mineral:三钛合金");
  const minBase = poolBase("T2", "mineral:三钛合金");
  if (minEntry && minBase) {
    const got = parseQty(minEntry.qtyText);
    const expLo = Math.round(minBase.qty[0] * mul);
    const expHi = Math.round(minBase.qty[1] * mul);
    check(got && got.lo === expLo && got.hi === expHi,
      `B-${size} 矿物(三钛合金) 预览 ${got && got.lo}~${got && got.hi} == 缩放 ${expLo}~${expHi}`);
  } else check(false, `B-${size} 矿物条目缺失`);
  // 行星资源（T2 奖池）：随尺寸缩放
  const plEntry = findEntryT2(info.content, "planetary:等离子体");
  const plBase = poolBase("T2", "planetary:等离子体");
  if (plEntry && plBase) {
    const got = parseQty(plEntry.qtyText);
    const expLo = Math.round(plBase.qty[0] * mul);
    const expHi = Math.round(plBase.qty[1] * mul);
    check(got && got.lo === expLo && got.hi === expHi,
      `B-${size} 行星资源(等离子体) 预览 ${got && got.lo}~${got && got.hi} == 缩放 ${expLo}~${expHi}`);
  } else check(false, `B-${size} 行星资源条目缺失`);
  // 弹药（T1）：随尺寸缩放
  const ammoEntry = findEntry(info.content, "ammo:T1");
  if (ammoEntry) {
    const got = parseQty(ammoEntry.qtyText);
    const exp = Math.round(75 * mul);
    check(got && got.lo === exp, `B-${size} 弹药(T1) 预览 ${got && got.lo} == 缩放 ${exp}`);
  } else check(false, `B-${size} 弹药(T1) 条目缺失`);
  // loot（T2 奖池）：不缩放
  const lootEntry = findEntryT2(info.content, "loot:isk");
  const lootBase = poolBase("T2", "loot:isk");
  if (lootEntry && lootBase) {
    const got = parseQty(lootEntry.qtyText);
    const expLo = lootBase.qty[0], expHi = lootBase.qty[1];
    check(got && got.lo === expLo && got.hi === expHi,
      `B-${size} loot(isk) 预览 ${got && got.lo}~${got && got.hi} == 未缩放 ${expLo}~${expHi}`);
  } else check(false, `B-${size} loot 条目缺失`);
  // implant（T3）：不缩放
  const impEntry = findEntry(info.content, "implant_planet_speed");
  if (impEntry) {
    const got = parseQty(impEntry.qtyText);
    check(got && got.lo === 1, `B-${size} implant(planet_speed) 预览 ${got && got.lo} == 未缩放 1`);
  } else check(false, `B-${size} implant 条目缺失`);
  // blueprint：不缩放（仅列出，无 qtyText）
  const bps = info.blueprints || [];
  const bpBase = (CARGO_BLUEPRINT_BY_SIZE[size] || []);
  check(bps.length === bpBase.length && bps.length > 0, `B-${size} 蓝图数 ${bps.length} == 尺寸池 ${bpBase.length} 且 >0`);
  check(bps.every((b) => !("qtyText" in b)), `B-${size} 蓝图无缩放 qtyText`);
}

// 跨尺寸：矿物 S vs XL 应放大；loot S vs XL 应不变（双重确认缩放/不缩放）
{
  const infoS = getCargoDropInfo("S"), infoXL = getCargoDropInfo("XL");
  const mS = parseQty(findEntry(infoS.content, "mineral:三钛合金").qtyText);
  const mXL = parseQty(findEntry(infoXL.content, "mineral:三钛合金").qtyText);
  check(mXL.lo >= mS.lo * 4 && mXL.hi >= mS.hi * 4,
    `B-X 矿物 S(${mS.lo}~${mS.hi}) vs XL(${mXL.lo}~${mXL.hi}) 放大≈4.2x`);
  const lS = parseQty(findEntryT2(infoS.content, "loot:isk").qtyText);
  const lXL = parseQty(findEntryT2(infoXL.content, "loot:isk").qtyText);
  check(lS.lo === lXL.lo && lS.hi === lXL.hi,
    `B-X loot S(${lS.lo}~${lS.hi}) == XL(${lXL.lo}~${lXL.hi}) 不缩放`);
}

// ---- 汇总 ----
console.log(`\n货柜出率预览缩放 + queue 缓存测试：通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  console.log("失败项：");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("全部通过 ✅");
process.exit(0);
