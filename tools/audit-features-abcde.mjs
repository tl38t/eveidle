#!/usr/bin/env node
// ============================================================================
// audit-features-abcde.mjs — A/B/C/D/E 五项功能专项审计 + F 项测试收尾
// ----------------------------------------------------------------------------
// 真实脚本 VM 沙箱加载全部游戏逻辑（render3d 除外），不伪造状态、不绕过真实入口：
//   - 真实 Action 入口：dispatchGameAction(gameState, {type:"hangar/disassembleShip",...})
//   - 真实结算入口：forceOfflineTest / calculateOfflineGains（applyOfflineGains 链路）
//   - 真实开箱入口：openCargoContainers(state, size, count, rng)
//   - 真实事件总线：GameEvents.emit（含幂等消费者）
//   - 离线/开箱弹窗：openRewardResultModal + 真实 DOM 点击关闭（关闭按钮 / 背景 / Escape）
//
// 覆盖要求：旧档迁移二次 JSON 一致、重复事件幂等、失败零副作用、快速双击。
// 报告真实 EXIT CODE。
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const noop = () => {};
class MC {}
for (const n of ["arc","beginPath","clearRect","clip","fill","fillRect","fillText","lineTo","moveTo","rect","restore","save","scale","setTransform","stroke","strokeText"]) MC.prototype[n] = noop;
MC.prototype.createImageData = (w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h});
MC.prototype.createRadialGradient = ()=>({addColorStop:noop});
MC.prototype.getImageData = ()=>({data:new Uint8ClampedArray(4)});
MC.prototype.roundRect = noop;

// ---- 注册表式 DOM mock（支持按 id 复用同一元素 + querySelector 缓存 + 真实事件派发）----
const elRegistry = {};
const docHandlers = {};
function makeEl(tag) {
  const handlers = {};
  const children = [];
  const queryCache = {};
  const el = {
    tagName:(tag||"div").toUpperCase(),
    _id:"", className:"", _innerHTML:"", textContent:"", value:"1",
    offsetWidth:560, offsetHeight:24, width:0, height:0,
    dataset:{}, style:{},
    children,
    classList:{ add:noop, remove:noop, toggle:noop, contains:()=>false },
    get id(){ return this._id; },
    set id(v){ this._id = v; if (v) elRegistry[v] = this; },
    get innerHTML(){ return this._innerHTML; },
    set innerHTML(v){ this._innerHTML = String(v); },
    addEventListener(type, fn){ (handlers[type]=handlers[type]||[]).push(fn); },
    removeEventListener(type, fn){ if (handlers[type]) handlers[type]=handlers[type].filter(f=>f!==fn); },
    appendChild(c){ children.push(c); return c; },
    removeChild(c){ const i=children.indexOf(c); if (i>=0) children.splice(i,1); return c; },
    remove:noop, setAttribute:noop, getAttribute:()=>null,
    querySelector(sel){ if (!queryCache[sel]) queryCache[sel]=makeEl("button"); return queryCache[sel]; },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    getBoundingClientRect(){ return {left:0,top:0,width:100,height:100}; },
    getContext(){ return new MC(); },
    focus:noop,
    click(){ (handlers.click||[]).forEach(fn=>fn({target:el})); },
    _fire(type, ev){ (handlers[type]||[]).forEach(fn=>fn(ev||{target:el})); }
  };
  return el;
}
const documentMock = {
  // reward-result-modal 由 openRewardResultModal 动态创建：未创建时必须返回 null，
  // 否则 openRewardResultModal 的 if(!backdrop) 永远为假、点击/Esc 监听不注册。
  getElementById(id){ if (id === "reward-result-modal") return elRegistry[id] || null; if (!elRegistry[id]) elRegistry[id]=makeEl("div"); return elRegistry[id]; },
  createElement(tag){ return makeEl(tag); },
  createElementNS(ns, tag){ return makeEl(tag); },
  querySelector(){ return makeEl("div"); },
  querySelectorAll(){ return []; },
  addEventListener(type, fn){ (docHandlers[type]=docHandlers[type]||[]).push(fn); },
  removeEventListener(type, fn){ if (docHandlers[type]) docHandlers[type]=docHandlers[type].filter(f=>f!==fn); },
  body: makeEl("body"),
  _fire(type, ev){ (docHandlers[type]||[]).forEach(fn=>fn(ev||{})); }
};

const sb = vm.createContext({
  alert:noop, Blob, FileReader:class{}, Image:class{},
  CanvasRenderingContext2D:MC, console,
  confirm:()=>true,
  document: documentMock,
  localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop, clear:noop },
  requestAnimationFrame:noop, cancelAnimationFrame:noop,
  setInterval:noop, setTimeout:(fn)=>0, clearTimeout:noop, clearInterval:noop,
  URL:{ createObjectURL:()=>"blob:mock", revokeObjectURL:noop },
  location:{ href:"", search:"", hash:"" },
  navigator:{ userAgent:"node" },
  matchMedia:()=>({ matches:false, media:"", addEventListener:noop, removeEventListener:noop, addListener:noop, removeListener:noop }),
  innerWidth:1280, innerHeight:800
});
sb.window = sb; sb.window.addEventListener = noop; sb.globalThis = sb;
sb.addEventListener = noop; sb.removeEventListener = noop; sb.dispatchEvent = noop;

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const srcs = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)]
  .map(m => m[1].replace(/\?.*$/,"").replace(/^\.\//,""))
  .filter(s => !s.startsWith("js/render3d/") && s !== "js/ui/taptap-portrait.js");
for (const s of srcs) vm.runInContext(fs.readFileSync(path.resolve(root, s), "utf8"), sb, { filename:s });

const $ = (c) => vm.runInContext(c, sb);
const clone = (o) => JSON.parse(JSON.stringify(o));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) { if (cond) { pass++; } else { fail++; failures.push(label); console.log("  [FAIL] " + label); } }
function section(name) { console.log("\n== " + name + " =="); }

// 在加载后快照纯数据默认态（用于后续的 installGS 还原）
const DEFAULT_GS = clone($("gameState"));
function installGS(obj) {
  const real = $("gameState");
  for (const k of Object.keys(real)) delete real[k];
  Object.assign(real, obj);
  return real;
}

// ---------------------------------------------------------------------------
section("A. 共享仓库物品卡（buildCargoCardHTML + 弹窗真实 DOM 点击关闭）");
{
  const build = $("buildCargoCardHTML");
  ok(typeof build === "function", "buildCargoCardHTML 函数存在");
  const html1 = build({ name:"<script>bad</script>", quantity:7 }, {});
  ok(html1.includes("cargo-card"), "buildCargoCardHTML 输出含 .cargo-card 根类");
  ok(html1.includes("&lt;script&gt;"), "buildCargoCardHTML 对 name 做 HTML 转义");
  ok(html1.includes("×7"), "buildCargoCardHTML 默认渲染 ×数量");

  // 离线/开箱共用持久弹窗：开 → 真实点击关闭按钮 → 关；背景点击 → 关；Escape → 关
  const open = $("openRewardResultModal");
  const close = $("closeRewardResultModal");
  ok(typeof open === "function" && typeof close === "function", "openRewardResultModal / closeRewardResultModal 函数存在");

  const items = [ { name:"veldspar", quantity:100, categoryLabel:"物资", icon:"⛏", source:{pageLabel:"离线收益"} } ];
  open({ title:"⏳ 测试结算", subtitle:"离线 1 分 0 秒", items });
  const modal = elRegistry["reward-result-modal"];
  ok(modal && modal.style.display === "flex", "弹窗打开后 display=flex（持久，无自动计时）");
  ok(modal && modal.innerHTML.includes("veldspar"), "弹窗渲染奖励卡片（含物品名）");

  // 真实 DOM 点击 [data-rrm-close] 关闭按钮
  const closeBtn = modal.querySelector("[data-rrm-close]");
  closeBtn._fire("click", { target: closeBtn });
  ok(modal.style.display === "none" && modal.innerHTML === "", "真实点击关闭按钮 → 弹窗关闭（display:none + innerHTML 清空）");

  // 背景点击关闭（event.target === backdrop）
  open({ title:"再开", items });
  modal._fire("click", { target: modal });
  ok(modal.style.display === "none", "真实点击背景（target===backdrop）→ 弹窗关闭");

  // Escape 键关闭（document keydown 注册的 _esc）
  open({ title:"再开2", items });
  documentMock._fire("keydown", { key:"Escape" });
  ok(modal.style.display === "none", "真实 Escape 键 → 弹窗关闭");
  close();
}

// ---------------------------------------------------------------------------
section("B. 离线收益（canonical 库存快照 + 净获得 diff）");
{
  const createSnap = $("createInventorySnapshot");
  const diffSnap = $("diffInventorySnapshot");
  ok(typeof createSnap === "function" && typeof diffSnap === "function", "createInventorySnapshot / diffInventorySnapshot 函数存在");

  const RR = $("ResourceRegistry");
  const def = RR.listDefinitions().find(d => d.id.startsWith("mineral:") || d.id.startsWith("ore:"));
  ok(!!def, "ResourceRegistry 含 mineral:/ore: 命名空间定义");
  const st = clone($("gameState"));
  const before = createSnap(st);
  RR.add(st, def.id, 100);
  const after = createSnap(st);
  const items = diffSnap(before, after);
  ok(items.length === 1, "diff 仅输出 1 项正差额");
  ok(items[0] && items[0].quantity === 100, "diff 数量 = 真实增量 100");
  ok(items[0] && items[0].categoryLabel === "物资", "diff 资源分类标签 = 物资");
  ok(items[0] && typeof items[0].name === "string" && items[0].name.length > 0, "diff 名称经 getResourceDisplayName 解析");

  // 只取正差额：扣回后无项；扣成负差额无项
  const before2 = createSnap(st);
  RR.spend(st, def.id, 100); // 回到原始
  const after2 = createSnap(st);
  ok(diffSnap(before2, after2).length === 0, "资源回落后 diff 无项（仅正差额）");
  const before3 = createSnap(st);
  RR.spend(st, def.id, 50); // 负差额
  const after3 = createSnap(st);
  ok(diffSnap(before3, after3).length === 0, "资源减少（负差额）diff 无项");

  // 静态断言：showOfflineToast 无自动关闭计时、且调用 openRewardResultModal
  const offlineSrc = fs.readFileSync(path.join(root, "js/core/offline.js"), "utf8");
  const fnBlock = offlineSrc.slice(offlineSrc.indexOf("function showOfflineToast"), offlineSrc.indexOf("function createInventorySnapshot"));
  ok(!/setTimeout\s*\([^)]*,\s*\d+/.test(fnBlock), "showOfflineToast 无 setTimeout 自动关闭计时");
  ok(fnBlock.includes("openRewardResultModal("), "showOfflineToast 调用 openRewardResultModal（持久弹窗）");
}

// ---------------------------------------------------------------------------
section("B1. 离线舰船明细（按 shipId 聚合 + 具体舰名卡）");
{
  const createSnap = $("createInventorySnapshot");
  const diffSnap = $("diffInventorySnapshot");
  const cfg = $("getShipConfigById");
  const open = $("openRewardResultModal");
  const close = $("closeRewardResultModal");
  ok(typeof createSnap === "function" && typeof diffSnap === "function" && typeof cfg === "function", "createInventorySnapshot / diffInventorySnapshot / getShipConfigById 函数存在");

  // 构造：先快照（无新增舰），再向库存注入 2 艘 rifter + 3 艘 gale（两种舰型）
  const st = clone($("gameState"));
  st.shipAssignments = {}; st.combat = st.combat || {}; st.combat.active = false; st.combat.repairs = {};
  const before = createSnap(st);
  const mk = (shipId) => ({ shipId, instanceId:"tmp_" + shipId + "_" + Math.random().toString(36).slice(2,7), builtAt:Date.now(), fitted:{ high:[], mid:[], low:[], rig:[] }, enhancementLevel:0 });
  for (let i = 0; i < 2; i++) st.inventory.ships.push(mk("rifter"));
  for (let i = 0; i < 3; i++) st.inventory.ships.push(mk("gale"));
  const after = createSnap(st);
  const items = diffSnap(before, after);
  const shipItems = items.filter(x => typeof x.id === "string" && x.id.startsWith("ship:"));
  ok(shipItems.length === 2, "diff 输出恰好 2 种舰型卡（rifter + gale）");
  const rifterCard = shipItems.find(x => x.id === "ship:rifter");
  const galeCard = shipItems.find(x => x.id === "ship:gale");
  ok(rifterCard && rifterCard.quantity === 2, "rifter 卡数量 = 2");
  ok(galeCard && galeCard.quantity === 3, "gale 卡数量 = 3");
  ok(rifterCard && rifterCard.name === cfg("rifter").name, "rifter 卡使用正式舰名（非笼统'舰船（制造）'）");
  ok(galeCard && galeCard.name === cfg("gale").name, "gale 卡使用正式舰名");

  // 持久弹窗按具体舰型渲染两张（以上）卡，而非笼统总数
  if (typeof open === "function") {
    open({ title:"📦 离线收益", subtitle:"测试", items });
    const modal = elRegistry["reward-result-modal"];
    const html = modal ? modal.innerHTML : "";
    const cardCount = (html.match(/class="[^"]*cargo-card/g) || []).length;
    ok(cardCount >= 2, "持久弹窗渲染至少 2 张具体物品卡（含两种舰型）");
    ok(html.includes(rifterCard.name) && html.includes(galeCard.name), "弹窗同时含两种舰型正式舰名");
    if (typeof close === "function") close();
  }
}

// ---------------------------------------------------------------------------
section("B2. 离线结算真实入口（forceOfflineTest → 持久弹窗）");
{
  const MA = $("MINING_AREAS");
  const def = clone(DEFAULT_GS);
  def.currentAction = { active:true, skill:"mining", area:MA[0].name, startedArea:MA[0].name, progress:0, batchRemaining:0, lastProgressUpdate:Date.now() };
  def.combat = def.combat || {}; def.combat.active = false; def.combat.repairs = {};
  def.shipAssignments = {};
  def.lastActiveTime = Date.now();
  installGS(def);
  // 拦截在线 UI 副作用，聚焦结算+弹窗链路
  vm.runInContext("if(typeof updateUI==='function'){window.__oui=updateUI;updateUI=function(){};} if(typeof SaveManager!=='undefined'&&SaveManager&&SaveManager.save){SaveManager.save=function(){};}", sb);
  let threw = null;
  try { $("forceOfflineTest")(3600); } catch (e) { threw = e; }
  const modal = elRegistry["reward-result-modal"];
  if (threw) {
    console.log("  [WARN] forceOfflineTest 抛异常（已捕获）：" + threw.message);
    ok(false, "forceOfflineTest 真实结算入口未抛异常");
  } else {
    ok(modal && modal.style.display === "flex", "forceOfflineTest 真实结算 → 持久弹窗打开");
    ok(modal && modal.innerHTML.includes("结算"), "持久弹窗含结算标题");
  }
  // 还原
  vm.runInContext("if(typeof window.__oui==='function'){updateUI=window.__oui;}", sb);
  installGS(DEFAULT_GS);
}

// ---------------------------------------------------------------------------
section("C. 开箱结果（openCargoContainers + 聚合 + 失败零副作用 + 快速双击）");
{
  const openMany = $("openCargoContainers");
  const norm = $("normalizeRewardItem");
  const agg = $("aggregateRewardRolls");
  ok(typeof openMany === "function" && typeof norm === "function" && typeof agg === "function", "openCargoContainers / normalizeRewardItem / aggregateRewardRolls 函数存在");

  const RR = $("ResourceRegistry");
  const st = clone($("gameState"));
  RR.add(st, "special:货柜S", 3);
  const rng = () => 0.0;
  const res = openMany(st, "S", 3, rng);
  ok(res && res.opened === 3, "持有 3 个货柜、开 3 个 → opened=3");
  ok(RR.get(st, "special:货柜S") === 0, "开箱后货柜精确扣减至 0（无超额扣减）");
  ok(Array.isArray(res.rolls) && res.rolls.length > 0, "rolls 非空");

  // 快速双击：同一状态再次开箱（货柜已 0）→ 返回 null（无超额扣减、无异常）
  const res2 = openMany(st, "S", 3, rng);
  ok(res2 === null, "快速二次开箱（货柜已空）→ 返回 null，零副作用");
  ok(RR.get(st, "special:货柜S") === 0, "二次开箱后货柜仍为 0（无负扣减）");

  // 失败零副作用：0 货柜开箱 → 返回 null、不抛错、库存不变
  const st0 = clone($("gameState"));
  const beforeAmt = RR.get(st0, "special:货柜S");
  const res0 = openMany(st0, "S", 2, rng);
  ok(res0 === null, "0 货柜开箱 → 返回 null（安全拒绝）");
  ok(RR.get(st0, "special:货柜S") === beforeAmt, "0 货柜开箱：库存零变化");

  // 聚合：相同 canonical ref（显示名）合并数量
  const aggr = agg([ { id:"mineral:veldspar", quantity:2 }, { id:"mineral:veldspar", quantity:3 }, { id:"ore:tritanium", quantity:1 } ]);
  ok(aggr.length === 2, "聚合将 3 条合并为 2 个不同物品");
  ok(aggr.some(x => x.quantity === 5), "相同 ref 数量合并（2+3=5）");

  // normalizeRewardItem 多形态解析（loot/ammo/implant/blueprint/mineral）
  const EQ = $("EQUIPMENT_DB");
  const eqKey = Object.keys(EQ)[0];
  const bp = norm({ id:"blueprint:" + eqKey, blueprint:true });
  ok(bp && bp.name.endsWith("蓝图"), "蓝图 roll 解析为「<装备名>蓝图」");
  const IMP = $("IMPLANT_DB");
  const impKey = Object.keys(IMP)[0];
  const im = norm({ id:impKey, implant:true });
  ok(im && im.name === IMP[impKey].name && im.categoryLabel === "脑插", "脑插 roll 经 IMPLANT_DB 解析");
  const am = norm({ id:"ammo:laser|T1", ammo:true, weaponType:"laser" });
  ok(am && am.categoryLabel === "弹药" && am.icon.length > 0, "弹药 roll 分类=弹药、带图标");
  const lo = norm({ id:"loot:foo", loot:true, name:"战利品X", kind:"isk" });
  ok(lo && lo.categoryLabel === "战利品", "战利品 roll 分类=战利品");

  // canonical 聚合：两个不同 ID、相同显示名不得合并（按 canonical ref 聚合，不按显示名）
  const dup = agg([ { id:"res:alpha", name:"同名物品" }, { id:"res:beta", name:"同名物品" } ]);
  ok(dup.length === 2, "不同 ID 相同显示名不合并（按 canonical ref 聚合）");
  ok(dup.every(x => typeof x.ref === "string" && x.ref !== "同名物品"), "聚合键为 canonical ref 而非显示名");
}

// ---------------------------------------------------------------------------
section("D. 货币消耗统计（迁移幂等 + 重复事件幂等 + 仅货币消费累计）");
{
  const ensure = $("ensureStatisticsState");
  const createDef = $("createDefaultStatisticsState");
  ok(typeof ensure === "function" && typeof createDef === "function", "ensureStatisticsState / createDefaultStatisticsState 函数存在");

  // 旧档迁移二次 JSON 一致 + economy 清洗
  const stOld = { statistics:{ version:9, totals:{}, activity:{}, production:{}, combat:{}, lifecycle:{}, economy:{ iskSpent:5, lpSpent:-3 }, eventLedger:{processedEventIds:[]} }, queue:{items:[]}, planetary:{}, station:{} };
  ensure(stOld);
  ok(stOld.statistics.economy && typeof stOld.statistics.economy.iskSpent === "number", "迁移后 economy 字段存在");
  ok(stOld.statistics.economy.iskSpent === 5, "合法 iskSpent 保留（=5）");
  ok(stOld.statistics.economy.lpSpent === 0, "非法 lpSpent(-3) 清洗归 0（不臆测历史）");
  const json1 = JSON.stringify(stOld.statistics);
  ensure(stOld); // 二次迁移
  const json2 = JSON.stringify(stOld.statistics);
  ok(json1 === json2, "旧档迁移二次 JSON 严格一致（幂等）");

  // v10 默认态二次迁移幂等
  const stDef = { statistics: createDef(), queue:{items:[]}, planetary:{}, station:{} };
  ensure(stDef);
  const jd1 = JSON.stringify(stDef.statistics);
  ensure(stDef);
  const jd2 = JSON.stringify(stDef.statistics);
  ok(jd1 === jd2, "v10 默认态二次迁移 JSON 一致（幂等）");
  ok(stDef.statistics.version === $("GAME_STATISTICS_VERSION"), "statistics.version 升级到 GAME_STATISTICS_VERSION");

  // 重复事件幂等（同一 eventId 仅计一次）+ 仅 currency 且 previousValue>value 才累计
  const GE = $("GameEvents");
  const gs = $("gameState");
  const before = gs.statistics.economy.iskSpent;
  GE.emit("resource:changed", { resourceId:"currency:isk", previousValue:1000, value:600, delta:400 }, { eventId:"audit-isk-1", source:"test" });
  GE.emit("resource:changed", { resourceId:"currency:isk", previousValue:1000, value:600, delta:400 }, { eventId:"audit-isk-1", source:"test" }); // 重复
  const after = gs.statistics.economy.iskSpent;
  ok(after - before === 400, "重复 eventId 仅累计一次（iskSpent +400，非 +800）");

  // 非货币 / 余额增加 不累计
  const before2 = gs.statistics.economy.iskSpent;
  GE.emit("resource:changed", { resourceId:"mineral:veldspar", previousValue:100, value:50, delta:50 }, { eventId:"audit-min-1", source:"test" });
  GE.emit("resource:changed", { resourceId:"currency:isk", previousValue:600, value:800, delta:200 }, { eventId:"audit-isk-2", source:"test" });
  ok(gs.statistics.economy.iskSpent === before2, "非货币 id / 余额增加 不累计 iskSpent");

  // selector「经济活动」卡存在
  const sel = $("getStatisticsDisplayState");
  ok(typeof sel === "function", "getStatisticsDisplayState 函数存在");
  const disp = sel(gs, Date.now());
  const hasEcon = (disp.summaryGroups || []).some(g => g.id === "economy") || (disp.detailGroups || []).some(g => g.id === "economy");
  ok(hasEcon, "统计展示态含「经济活动」卡");
}

// ---------------------------------------------------------------------------
section("E. 舰船拆解（只读报价 + 真实 Action + 阻塞 + 失败零副作用 + 快速双击）");
{
  const quote = $("getShipDismantleQuote");
  const blockReason = $("getShipDismantleBlockReason");
  const getHangar = $("getHangarDisplayState");
  const dispatch = $("dispatchGameAction");
  const createShip = $("createShipInstance");
  const ASM = $("SHIP_ASSEMBLY_RECIPES");
  ok(ASM.length > 0, "SHIP_ASSEMBLY_RECIPES 非空");
  const recipe = ASM[0];
  ok(typeof quote === "function" && typeof blockReason === "function", "getShipDismantleQuote / getShipDismantleBlockReason 函数存在");

  const q = quote(recipe);
  ok(Array.isArray(q) && q.length > 0, "拆解报价非空");
  ok(q.every(e => e.returned === Math.floor(e.total * 0.5)), "每项 returned = floor(total*0.5)");
  let sorted = true;
  for (let i = 1; i < q.length; i++) if (q[i-1].returned < q[i].returned) sorted = false;
  ok(sorted, "报价按 returned 降序");

  // 阻塞判定：已装配 → has-fitting
  const stFit = clone($("gameState"));
  const instFit = createShip(recipe.shipId);
  instFit.fitted = { high:["eqref1"], mid:[], low:[], rig:[] };
  stFit.inventory.ships.push(instFit);
  stFit.shipAssignments = {}; stFit.combat = stFit.combat || {}; stFit.combat.active = false; stFit.combat.repairs = {};
  const rFit = blockReason(stFit, instFit, Date.now());
  ok(rFit === "has-fitting", "已装配装备 → 阻塞原因 has-fitting");

  // 已分配 → ship-assigned
  const stAss = clone($("gameState"));
  const instAss = createShip(recipe.shipId);
  stAss.inventory.ships.push(instAss);
  stAss.shipAssignments = { mining: instAss.instanceId };
  const rAss = blockReason(stAss, instAss, Date.now());
  ok(rAss === "ship-assigned", "岗位已分配 → 阻塞原因 ship-assigned");

  // 维修中 → repairing
  const stRep = clone($("gameState"));
  const instRep = createShip(recipe.shipId);
  stRep.inventory.ships.push(instRep);
  stRep.shipAssignments = {};
  stRep.combat = stRep.combat || {}; stRep.combat.active = false; stRep.combat.repairs = {};
  stRep.combat.repairs[instRep.instanceId] = Date.now() + 100000;
  const rRep = blockReason(stRep, instRep, Date.now());
  ok(rRep === "repairing", "维修中 → 阻塞原因 repairing");

  // 干净船 → 可拆解
  const stClean = clone($("gameState"));
  const instClean = createShip(recipe.shipId);
  stClean.inventory.ships.push(instClean);
  stClean.shipAssignments = {};
  stClean.combat = stClean.combat || {}; stClean.combat.active = false; stClean.combat.repairs = {};
  const rClean = blockReason(stClean, instClean, Date.now());
  ok(rClean === null, "干净船 → 无阻塞（可拆解）");

  // selector 输出 dismantle 字段（只读，不改动状态）
  const hangarDisp = getHangar(stClean, Date.now());
  const shipDisp = hangarDisp.ships.find(s => s.instanceId === instClean.instanceId);
  ok(shipDisp && shipDisp.dismantle && shipDisp.dismantle.canDismantle === true, "getHangarDisplayState 输出 canDismantle=true（只读）");
  ok(shipDisp.dismantle.preview.length > 0, "selector 输出 dismantle.preview 报价");

  // 真实 Action：拆解干净船 → 移除实例 + 归还材料 + 发射事件
  const RR = $("ResourceRegistry");
  const q0 = q[0];
  const refId = q0.refId;
  const beforeRef = RR.get(stClean, refId);
  const beforeShips = stClean.inventory.ships.length;
  // 拦截 ship:disassembled 事件，校验 refundedResources（canonical ref → 实际数量）
  const GE = $("GameEvents");
  const disassembled = [];
  const origEmit = GE.emit;
  GE.emit = (name, payload) => { if (name === "ship:disassembled") disassembled.push(payload); return origEmit(name, payload); };
  const res = dispatch(stClean, { type:"hangar/disassembleShip", instanceId:instClean.instanceId }, Date.now());
  GE.emit = origEmit;
  ok(res && res.changed === true, "dispatch hangar/disassembleShip → changed=true");
  ok(stClean.inventory.ships.length === beforeShips - 1, "拆解后舰船实例移除");
  ok(RR.get(stClean, refId) === beforeRef + q0.returned, "拆解归还材料（refId 增加 returned）");
  ok(disassembled.length === 1, "ship:disassembled 事件恰好发射一次");
  ok(disassembled[0] && typeof disassembled[0].refundedResources === "object" && !Array.isArray(disassembled[0].refundedResources), "事件 payload 含 refundedResources 对象");
  ok(disassembled[0] && disassembled[0].refundedResources[refId] === q0.returned, "refundedResources[refId] = 实际归还数量（与 Action 真实入账一致）");

  // 失败零副作用：对已装配船发起拆解 → 拒绝、状态不变
  const beforeShipsAss = stFit.inventory.ships.length;
  const resFail = dispatch(stFit, { type:"hangar/disassembleShip", instanceId:instFit.instanceId }, Date.now());
  ok(resFail && resFail.changed === false && resFail.reason === "has-fitting", "已装配船拆解被拒（reason=has-fitting）");
  ok(stFit.inventory.ships.length === beforeShipsAss, "被拒拆解：舰船实例不变（零副作用）");

  // 快速双击：对同一干净船连续两次 dispatch → 第二次实例已不存在 → unknown-ship
  const stDbl = clone($("gameState"));
  const instD = createShip(recipe.shipId);
  stDbl.inventory.ships.push(instD);
  stDbl.shipAssignments = {}; stDbl.combat = stDbl.combat || {}; stDbl.combat.active = false; stDbl.combat.repairs = {};
  const r1 = dispatch(stDbl, { type:"hangar/disassembleShip", instanceId:instD.instanceId }, Date.now());
  const r2 = dispatch(stDbl, { type:"hangar/disassembleShip", instanceId:instD.instanceId }, Date.now());
  ok(r1.changed === true, "第一次拆解成功");
  ok(r2.changed === false && r2.reason === "unknown-ship", "快速第二次拆解 → 实例已不存在，安全拒绝（unknown-ship）");
}

// ---------------------------------------------------------------------------
section("E+. 船坞装备候选堆叠（同装备合并、不同强化等级分开、保留原始 id）");
{
  const getFitting = $("getShipFittingDisplayState");
  const createShip = $("createShipInstance");
  const st = clone($("gameState"));
  const ship = createShip("rifter");
  st.inventory.ships = [ship];
  st.equipment = { inventory:[], instances:[], nextInstanceId:10 };
  // inventory 字符串池：2 把 +0 采矿激光、1 个气云采集器
  st.equipment.inventory = ["t1_mining_laser", "t1_mining_laser", "t1_gas_harvester"];
  // 实例池：2 把 +1 采矿激光、1 把 +2 采矿激光（均游离未装配）
  st.equipment.instances = [
    { instanceId:"eq_inst_ml_1", itemId:"t1_mining_laser", enhancementLevel:1, installedOn:null },
    { instanceId:"eq_inst_ml_2", itemId:"t1_mining_laser", enhancementLevel:1, installedOn:null },
    { instanceId:"eq_inst_ml_3", itemId:"t1_mining_laser", enhancementLevel:2, installedOn:null }
  ];
  const disp = getFitting(st, ship.instanceId);
  ok(disp && Array.isArray(disp.inventoryStacksBySlot.high), "selector 输出 inventoryStacksBySlot.high");
  const stacks = disp.inventoryStacksBySlot.high;
  const base = stacks.find(s => s.itemId === "t1_mining_laser" && s.enhancementLevel === 0);
  const plus1 = stacks.find(s => s.itemId === "t1_mining_laser" && s.enhancementLevel === 1);
  const plus2 = stacks.find(s => s.itemId === "t1_mining_laser" && s.enhancementLevel === 2);
  const gas = stacks.find(s => s.itemId === "t1_gas_harvester");
  ok(base && base.count === 2, "T1采矿激光器 +0 堆叠数量=2（来自 inventory）");
  ok(plus1 && plus1.count === 2, "T1采矿激光器 +1 堆叠数量=2（来自 instances）");
  ok(plus2 && plus2.count === 1, "T1采矿激光器 +2 堆叠数量=1（来自 instances）");
  ok(gas && gas.count === 1, "T1气云采集器单独一堆");
  ok(base.ids.length === 2 && plus1.ids.length === 2 && plus2.ids.length === 1, "每个堆叠保留完整原始 id 列表（安装时 pop）");
  ok(!disp.inventoryStacksBySlot.mid.find(s => s.itemId === "t1_mining_laser"), "采矿激光只出现在高槽堆叠，不串到中槽");
  // rig 槽堆叠字段存在（可能为空）
  ok(Array.isArray(disp.rigStackCandidates) && disp.rigStackCandidates.length === disp.slots.rig, "rigStackCandidates 长度与 rig 槽数一致");
}

// ---------------------------------------------------------------------------
section("F0. 语法检查（node --check）受影响 JS 文件");
{
  const files = [
    "js/core/offline.js", "js/ui/shell-render.js", "js/core/statistics.js",
    "js/core/selectors.js", "js/core/actions.js", "js/core/events.js"
  ];
  for (const f of files) {
    try { execFileSync(process.execPath, ["--check", path.join(root, f)], { stdio:"pipe" }); ok(true, "node --check " + f); }
    catch (e) { ok(false, "node --check " + f + " → " + (e.stderr ? e.stderr.toString().split("\n")[0] : e.message)); }
  }
}

// ---------------------------------------------------------------------------
section("F1. 受影响现有审计（verify.mjs + audit-resume-after-repair.mjs）");
{
  for (const aud of ["tools/verify.mjs", "tools/audit-resume-after-repair.mjs"]) {
    try {
      execFileSync(process.execPath, [path.join(root, aud)], { cwd: root, stdio:"pipe" });
      ok(true, aud + " EXIT 0");
    } catch (e) {
      const code = (typeof e.status === "number") ? e.status : "?";
      const out = (e.stdout ? e.stdout.toString() : "") + (e.stderr ? e.stderr.toString() : "");
      ok(false, aud + " EXIT " + code + " — " + out.split("\n").slice(-3).join(" | "));
    }
  }
}

// ---------------------------------------------------------------------------
section("F2. 布局静态检查（桌面 + 390×844 竖屏）");
{
  const comp = fs.readFileSync(path.join(root, "css/components.css"), "utf8");
  ok(/\.reward-result-modal\s*\{[^}]*max-width:\s*94vw/.test(comp), "reward-result-modal 响应式（max-width:94vw）");
  ok(/\.reward-result-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(160px/.test(comp), "reward-result-grid 自适应列（minmax 160px）");
  const panels = fs.readFileSync(path.join(root, "css/panels.css"), "utf8");
  ok(/\.btn\.danger\s*\{/.test(panels), ".btn.danger 危险按钮样式存在（拆解按钮）");
  const taptap = fs.readFileSync(path.join(root, "index.html"), "utf8");
  ok(/taptap-portrait\.css/.test(taptap), "竖屏样式 taptap-portrait.css 已挂载（390×844 竖屏适配）");
  console.log("  [NOTE] 真实视觉走查（桌面 + 390×844 竖屏）需在浏览器中人工确认；以上为 CSS 静态覆盖校验。");
}

// ---------------------------------------------------------------------------
console.log("\n==================================================");
console.log(`PASS=${pass}  FAIL=${fail}`);
if (fail) { console.log("失败项：\n - " + failures.join("\n - ")); }
console.log("==================================================");
process.exit(fail ? 1 : 0);
