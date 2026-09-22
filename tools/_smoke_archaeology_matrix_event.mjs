// 回归探针：考古成功周期不得抛 ReferenceError（曾因 emit payload 裸 shorthand `matrix` 熔断主循环）
// 用法（在仓库根执行）：
//   node tools/_smoke_archaeology_matrix_event.mjs                    → 用工作树源码
//   node tools/_smoke_archaeology_matrix_event.mjs <archaeology.js 路径> → 用指定源码替代（A/B 对照）
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERRIDE = process.argv[2] ? path.resolve(process.argv[2]) : "";
const ARCH_REL = "js/systems/archaeology.js";

const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const scriptSources = [];
const re = /<script\s+defer\s+src="([^"]+)"/g;
let mm; while ((mm = re.exec(html))) scriptSources.push(mm[1].replace(/\?.*$/, "").replace(/^\.\//, ""));

const UI_EXCLUDE = new Set([
  "js/ui/error-boundary.js", "js/ui/action-modal.js", "js/ui/shell-render.js",
  "js/ui/manufacturing-render.js", "js/ui/combat-render.js", "js/ui/planetary-render.js",
  "js/ui/archaeology-render.js", "js/ui/booster-render.js", "js/ui/render.js", "js/core/runtime.js",
  "js/ui/taptap-portrait.js", "js/ui/ad-buff-widget.js", "js/ui/ship3d-loader.js"
]);
const logicSources = scriptSources.filter((s) => !UI_EXCLUDE.has(s));

const noop = () => {};
function MockCanvasContext() {}
for (const n of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[n] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({
  addEventListener: noop, removeEventListener: noop, appendChild: noop, insertBefore: noop, insertAdjacentHTML: noop,
  replaceChildren: noop, removeChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop,
  getBoundingClientRect: () => ({ left:0, top:0, width:100, height:100 }), getContext: () => new MockCanvasContext(),
  innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => makeElement(), querySelectorAll: () => [],
  remove: noop, setAttribute: noop, removeAttribute: noop, getAttribute: () => null, select: noop, style: {},
  textContent: "", value: "1", children: [], parentNode: null, nodeType: 1
});
const documentMock = {
  addEventListener: noop, body: makeElement(), createElement: () => makeElement(),
  createElementNS: () => ({ ...makeElement(), setAttribute: noop }),
  getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => [],
  documentElement: makeElement()
};

// 事件总线：记录全部 emit（含 payload），用于断言 matrix 值
const emitted = [];
const sandbox = {
  alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console, confirm: () => true,
  document: documentMock, FileReader: class {},
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop },
  URLSearchParams: globalThis.URLSearchParams,
  matchMedia: () => ({ matches:false, media:"", onchange:null, addEventListener:noop, removeEventListener:noop, addListener:noop, removeListener:noop, dispatchEvent:noop }),
  GameEvents: {
    emit: (t, p, m) => { emitted.push({ t, p, m }); },
    on: () => () => {}, once: noop,
    contracts: { has: () => true, validate: () => ({ valid:true, registered:true }) },
    listenerCount: () => 0
  },
  RuntimeGuard: { report: noop, runCritical: () => ({ ok:true }), resume: () => true, isPaused: () => false, runRecoverable: () => ({ ok:true }) },
  window: null
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
sandbox.addEventListener = noop; sandbox.removeEventListener = noop; sandbox.dispatchEvent = noop;
sandbox.location = { href:"", search:"", hash:"" };
sandbox.navigator = { userAgent: "node" };
sandbox.innerWidth = 1280; sandbox.innerHeight = 800;
sandbox.updateUI = noop; sandbox.switchPage = noop; sandbox.currentPage = "";
sandbox.updateLiveUI = noop; sandbox.refreshVisiblePanelAfterAction = noop;
sandbox.playAttackFX = noop; sandbox.playEnemyAttackFX = noop;
sandbox.MutationObserver = class { observe(){} disconnect(){} takeRecords(){ return []; } };
sandbox.TextEncoder = globalThis.TextEncoder;
sandbox.TextDecoder = globalThis.TextDecoder;
sandbox.btoa = (s) => Buffer.from(s, "binary").toString("base64");
sandbox.atob = (s) => Buffer.from(s, "base64").toString("binary");
sandbox.Uint8Array = Uint8Array;

vm.createContext(sandbox);
const loadErrors = [];
for (const src of logicSources) {
  const full = path.resolve(REPO, src);
  if (!full.startsWith(REPO + path.sep) || !fs.existsSync(full)) { loadErrors.push(src + " (缺失)"); continue; }
  try {
    const code = (OVERRIDE && src === ARCH_REL) ? fs.readFileSync(OVERRIDE, "utf8") : fs.readFileSync(full, "utf8");
    vm.runInContext(code, sandbox, { filename: src + (OVERRIDE && src === ARCH_REL ? " (OVERRIDE)" : "") });
  } catch (e) { loadErrors.push(src + ": " + e.message); }
}
console.log("脚本 " + logicSources.length + " 个，加载错误 " + loadErrors.length + (loadErrors.length ? "：" + loadErrors.slice(0,6).join(" | ") : ""));
console.log("archaeology 源 = " + (OVERRIDE ? OVERRIDE : "(工作树 " + ARCH_REL + ")"));

// ── 构造最小考古场景 ──
const GS = sandbox.gameState;
const RR = sandbox.ResourceRegistry;
const SITES = sandbox.ARCHAEOLOGY_SITES;
const SITE = SITES[0];
console.log("站点 = " + SITE.id + " tier=" + SITE.tier + " level=" + SITE.level);

GS.archaeology = GS.archaeology || {};
GS.archaeology.startedSiteId = SITE.id;
GS.archaeology.startedProbeId = GS.archaeology.startedProbeId || "probe_basic";
GS.archaeology.repairsByInstanceId = {};
GS.inventory = GS.inventory || {};
GS.inventory.ships = [{ instanceId: "arch1", shipId: "heron", enhancementLevel: 0, fitted: { high: [], mid: [], low: [], rig: [] } }];
GS.shipAssignments = GS.shipAssignments || {};
GS.shipAssignments.archaeology = "arch1";
if (!GS.skills.archaeology) GS.skills.archaeology = { lvl: 0, xp: 0 };
GS.skills.archaeology.lvl = Math.max(50, GS.skills.archaeology.lvl || 0);

RR.set(GS, "consumable:fuel", 1e9);
RR.set(GS, "probe:" + GS.archaeology.startedProbeId, 1e9);
RR.set(GS, "matrix:analysis_matrix", 0);

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
};

// 真实事件总线（加载期会被游戏自身覆盖我的桩）→ 用 on() 挂真实监听器读 payload
const seen = [];
try { sandbox.GameEvents.on("archaeology:success", (ev) => seen.push(ev)); }
catch (e) { console.log("⚠ 注册真实监听器失败：" + e.message); }

// rng 恒 0 ⇒ roll(=0) < successChance ⇒ 必成功（成功路径）
let threw = null;
let result = null;
try {
  result = sandbox.resolveArchaeologyCycle(GS, 1700000000000, () => 0, {});
} catch (e) {
  threw = e;
}
console.log("\n--- 调用 resolveArchaeologyCycle（成功路径） ---");
if (threw) console.log("  🔴 抛出：" + threw.name + ": " + threw.message);
else console.log("  正常返回：" + JSON.stringify({ success: result && result.success, reason: result && result.reason }));

t("成功路径不抛异常", threw === null, threw ? threw.message : "");
t("返回 success=true", !!(result && result.success), result ? JSON.stringify({success:result.success, reason:result.reason}) : "null");

const evt = seen.length ? seen[seen.length - 1] : null;
t("真实事件总线收到 archaeology:success", !!evt, "收到 " + seen.length + " 次");
if (evt) {
  const payload = evt.payload || evt;
  const mv = payload.matrix;
  const expect = Math.max(1, Number(SITE.tier) || 1);
  console.log("  payload = " + JSON.stringify({ siteId:payload.siteId, tier:payload.tier, xp:payload.xp, matrix:payload.matrix }));
  t("payload.matrix 为有限数字（非 undefined）", Number.isFinite(mv), "值=" + mv);
  t("payload.matrix 等于 tier 数（1×tier 对称）", mv === expect, "实得 " + mv + " / 期望 " + expect);
}

// 资源侧：矩阵是否真的入库（resolveArchaeologyDrops 内已发放）
const got = Number(RR.get(GS, "matrix:analysis_matrix"));
t("解析矩阵已入库（数量 = tier）", got === Math.max(1, Number(SITE.tier) || 1), "库存=" + got);

// ── 离线臂：randomValue === "offline"（玩家报错的 offline:timeline 正是这条入口形态） ──
let offlineThrew = 0, offlineSuccess = 0, offlineErr = null;
for (let i = 0; i < 20; i++) {
  const now = 1700000000000 + i * 1000;
  try {
    const r = sandbox.resolveArchaeologyCycle(GS, now, "offline", { timestamp: now });
    if (r && r.success) offlineSuccess++;
  } catch (e) { offlineThrew++; offlineErr = offlineErr || (e.name + ": " + e.message); }
}
console.log("\n--- 离线臂（offline 随机源，20 次） ---");
if (offlineErr) console.log("  🔴 抛出：" + offlineErr);
t("离线臂零抛错", offlineThrew === 0, "抛错 " + offlineThrew + " 次" + (offlineErr ? " / " + offlineErr : ""));
t("离线臂至少 1 次成功（证明真的覆盖到目标分支）", offlineSuccess > 0, "成功 " + offlineSuccess + "/20");
t("离线后事件总线累计收到 success（≥ 在线 1 + 离线成功数）",
  seen.length >= 1 + offlineSuccess, "累计 " + seen.length + " 次");

console.log("\n=== 结果：" + pass + " PASS / " + fail + " FAIL ===");
console.log(fail === 0 ? "VERDICT=PASS" : "VERDICT=FAIL");
process.exit(fail ? 1 : 0);
