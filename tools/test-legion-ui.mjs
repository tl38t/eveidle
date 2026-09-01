// ================================================================
// 军团 DLC —— UI 与交互集成测试（覆盖 22 项）
// ================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// —— 可存储状态的 DOM 元素mock ——
class El {
  constructor(id) { this.id = id || ""; this._html = ""; this._text = ""; this._cls = ""; this.style = {}; this._handlers = {}; this.children = []; this._attrs = {}; this.dataset = {}; this.parentNode = null; this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } }; }
  get innerHTML() { return this._html; } set innerHTML(v) { this._html = String(v); }
  get textContent() { return this._text; } set textContent(v) { this._text = String(v); }
  get className() { return this._cls; } set className(v) { this._cls = String(v); }
  addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); }
  removeEventListener() {}
  appendChild(c) { c.parentNode = this; this.children.push(c); }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; }
  hasAttribute(k) { return this._attrs[k] != null; }
  closest() { return null; }
  get parentElement() { return this.parentNode || (this._pstub = this._pstub || new El()); }
  getContext() { return new Proxy({}, { get: () => () => undefined }); }
  scrollIntoView() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function buildDocument() {
  const els = new Map();
  const body = new El("body");
  const document = {
    getElementById(id) { if (!els.has(id)) { const e = new El(id); els.set(id, e); } return els.get(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return new El(); },
    createElementNS() { return new El(); },
    addEventListener() {}, removeEventListener() {},
    body
  };
  return { document, els };
}

function makeCtx() { return new Proxy({}, { get: () => () => undefined, set: () => true }); }

const HTML = readFileSync(join(ROOT, "index.html"), "utf8");
const re = /<script\s+defer\s+src="([^"]+)"/g;
const scripts = [];
let mm;
while ((mm = re.exec(HTML))) scripts.push(mm[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
const UI_EXCLUDE = [
  "js/ui/error-boundary.js", "js/ui/action-modal.js", "js/ui/shell-render.js",
  "js/ui/manufacturing-render.js", "js/ui/combat-render.js", "js/ui/planetary-render.js",
  "js/ui/archaeology-render.js", "js/ui/booster-render.js", "js/ui/render.js", "js/core/runtime.js"
];

function load(sysExclude) {
  const { document, els } = buildDocument();
  const sandbox = {
    console, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, confirm: () => true, alert: () => {},
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, clear: () => {} }; })(),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    document,
    Math, Date, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {}; sandbox.dispatchEvent = () => {};
  sandbox.location = { href: "http://localhost/", search: "", hash: "" };
  sandbox.navigator = { userAgent: "node" };
  sandbox.innerWidth = 1280; sandbox.innerHeight = 800;
  sandbox.CanvasRenderingContext2D = function () {}; sandbox.CanvasRenderingContext2D.prototype = {};
  sandbox.RuntimeGuard = { report: (e) => { sandbox.__guardReports.push({ message: e && e.message }); } };
  sandbox.__guardReports = [];
  vm.createContext(sandbox);
  let combined = "";
  for (const s of scripts) {
    if (sysExclude && sysExclude.includes(s)) continue;
    combined += "\n// === " + s + " ===\n" + readFileSync(join(ROOT, s), "utf8") + "\n";
  }
  vm.runInContext(combined, sandbox, { filename: "combined.js" });
  return { sandbox, els };
}

const HOUR = 3600000;
let pass = 0, fail = 0; const failures = [];
function ok(c, label) { if (c) { pass++; console.log("  [PASS] " + label); } else { fail++; failures.push(label); console.log("  [FAIL] " + label); } }
function section(n) { console.log("== " + n + " =="); }

// 事件触发：直接调用元素的已注册处理器
function fire(el, type, target) {
  const hs = (el._handlers[type] || []);
  hs.forEach(fn => fn({ target: target || el, preventDefault() {}, stopPropagation() {} }));
}
function fakeBtn(attr, val) {
  return { closest(sel) { return sel.indexOf(attr) >= 0 ? { getAttribute: a => (a === attr ? val : null), hasAttribute: a => a === attr } : null; }, hasAttribute: a => a === attr };
}
function findModal(W) {
  const ov = (W.document.body.children || []).filter(c => c._cls === "legion-modal-overlay");
  return ov.length ? ov[ov.length - 1] : null;
}

// ===== 场景 1-8：加载 + 入口 + DLC + 模块缺失 =====
section("1-8 入口 / 锁定 / 模块缺失 / 主内容不崩");
{
  const { sandbox: W, els } = load([]);
  const G = W.gameState;
  const LR = W.LegionRender, LE = W.LegionEvents;
  ok(typeof LR === "object" && typeof LE === "object", "脚本加载：LegionRender/LegionEvents 存在");

  // 入口锁定：bodyLevel 不足
  G.station.bodyLevel = 1; G.station.buildings = {}; G.station.dlc = { npcWorkers: true };
  LR.renderLegionEntry(Date.now());
  ok(els.get("legion-entry").className.indexOf("locked") >= 0 && /未解锁/.test(els.get("legion-entry").innerHTML), "bodyLevel < 2 时入口锁定");

  // legion_hall 未建成
  G.station.bodyLevel = 5;
  LR.renderLegionEntry(Date.now());
  ok(els.get("legion-entry").className.indexOf("locked") >= 0 && /需建造/.test(els.get("legion-entry").innerHTML), "legion_hall 未建成时锁定");

  // 开发期恒放行：即便 DLC 禁用入口仍可用（LEGION_DLC_DEV_BYPASS=true）；接回真实 DLC 时恢复「DLC 禁用 → 锁定」。
  G.station.buildings.legion_hall = 1;
  G.station.dlc = { npcWorkers: false };
  LR.renderLegionEntry(Date.now());
  ok(els.get("legion-entry").className.indexOf("active") >= 0, "开发期恒放行 → DLC 禁用时入口仍可用");

  // 激活
  G.station.dlc = { npcWorkers: true };
  LR.renderLegionEntry(Date.now());
  ok(els.get("legion-entry").className.indexOf("active") >= 0, "满足条件时入口可用");

  // 开发期恒放行：即便 DLC 禁用，军团区块仍渲染（接回真实 DLC 时此处恢复「隐藏」）
  G.station.dlc = { npcWorkers: false };
  LR.renderLegionSection(Date.now());
  ok(els.get("legion-section").style.display !== "none", "开发期恒放行 → DLC 禁用时军团区块仍显示");

  // 模块缺失：排除军团脚本，主内容渲染不崩
  const miss = load(["js/systems/legion-npc.js", "js/ui/legion-render.js", "js/ui/legion-events.js"]);
  let threw = false;
  try { miss.sandbox.renderStationPage(Date.now()); } catch (e) { threw = true; }
  ok(!threw, "legion-npc.js 缺失时主页面渲染不崩溃");
  ok(miss.sandbox.__guardReports.length === 0, "legion 模块缺失时无 RuntimeGuard 报错");
}

// ===== 场景 8.5：侧边栏「军团」标签显隐（本体 Lv.3 + 议事大厅） =====
section("8.5 侧边栏标签显隐");
{
  const { sandbox: W } = load([]);
  const LR = W.LegionRender;
  const G = W.gameState;
  G.station = G.station || {};
  G.station.buildings = {};
  G.station.bodyLevel = 1;
  ok(LR.isLegionTabVisible(G) === false, "本体 Lv.1 → 标签隐藏");
  G.station.bodyLevel = 2;
  ok(LR.isLegionTabVisible(G) === false, "本体 Lv.2 但议事大厅未建 → 标签隐藏");
  G.station.buildings.legion_hall = 1;
  ok(LR.isLegionTabVisible(G) === true, "本体 Lv.2 且已建议事大厅 → 标签显示（2026-09-01 门槛 Lv.3→Lv.2）");
  G.station.bodyLevel = 3;
  ok(LR.isLegionTabVisible(G) === true, "本体 Lv.3 且已建议事大厅 → 标签显示");
}

// =====  ️场景 9-18：招募 / 候选 / NPC / 欠薪 / 绑定 / 解雇 / 贡献 =====
section("9-18 候选人 / 招募 / 上限 / 欠薪 / 绑定 / 解雇 / 贡献");
let W, G, LR, LE, els;
{
  const r = load([]); W = r.sandbox; els = r.els; G = W.gameState; LR = W.LegionRender; LE = W.LegionEvents;
  LE.bind();
  const LP = W.LEGION_NPC;
  function ensureActive() { G.station.bodyLevel = 5; G.station.buildings = G.station.buildings || {}; G.station.buildings.legion_hall = 1; G.station.dlc = { npcWorkers: true }; }
  function resetLegion() { delete G.legion; ensureActive(); }
  function addNpc(skillId, grade) {
    LP.ensureLegionState(G);
    const n = LP.createNpc({ npcId: "npc_" + (G.legion.npcs.length + 1), name: "兵" + (G.legion.npcs.length + 1), personalityId: (LP.PERSONALITIES && LP.PERSONALITIES[0] ? LP.PERSONALITIES[0].personalityId : null), skillId, skillGrade: grade || "D", level: 1, xp: 0, salaryState: "paid", boundShipInstanceId: null, dialogueHistory: [] });
    G.legion.npcs.push(n); return n;
  }

  resetLegion();
  LP.tickLegionNpc(G, { now: Date.now() }); // 生成 3 候选人
  LR.renderLegionSection(Date.now());
  const candHtml = els.get("legion-candidates").innerHTML;
  ok((candHtml.match(/data-legion-recruit/g) || []).length === 3, "候选人显示 3 人");

  // 招募费用 / 倒计时
  ok(/下次刷新/.test(els.get("legion-summary").innerHTML), "候选人自然刷新倒计时存在");
  ok(/1,000,000/.test(els.get("legion-summary").innerHTML), "手动刷新价格正确（1,000,000 星币）");

  // 招募成功 → 列表更新
  G.resources.isk = 1e9; G.resources.lp = 100000;
  const cid = G.legion.candidates[0].npcId;
  fire(els.get("legion-candidates"), "click", fakeBtn("data-legion-recruit", cid));
  ok(G.legion.npcs.length === 1, "招募成功后 NPC 列表更新");
  ok(/已加入/.test((els.get("legion-msg") && (els.get("legion-msg").textContent || els.get("legion-msg").innerHTML)) || ""), "招募台词显示");

  // 上限：填满后不可招募
  const cap = LP.getLegionNpcCapacity(G);
  while (G.legion.npcs.length < cap - 1) addNpc("mining", "D");
  // 确保还有候选人
  LP.tickLegionNpc(G, { now: Date.now() + 10 });
  const before = G.legion.npcs.length;
  const ccid = G.legion.candidates[0] ? G.legion.candidates[0].npcId : null;
  if (ccid) { fire(els.get("legion-candidates"), "click", fakeBtn("data-legion-recruit", ccid)); }
  ok(G.legion.npcs.length === before, "人数达上限后不能继续招募");
  ok(/编队已满/.test(els.get("legion-msg").textContent || ""), "人数已满提示");

  // 欠薪 NPC 显示技能和经验暂停
  const overdue = addNpc("mining", "D");
  overdue.salaryState = "overdue";
  LR.renderLegionNpcs(LP.getLegionContributionSnapshot(G));
  const npcHtml = els.get("legion-npcs").innerHTML;
  ok(/欠薪/.test(npcHtml) && /技能暂停/.test(npcHtml) && /经验暂停/.test(npcHtml), "欠薪 NPC 显示技能暂停与经验暂停");

  // 绑定舰船成功
  G.inventory = G.inventory || {}; G.inventory.ships = G.inventory.ships || [];
  const shipId = "ship_x1"; const instId = "inst_x1";
  G.inventory.ships.push({ instanceId: instId, shipId });
  const paidNpc = G.legion.npcs.find(n => n.salaryState === "paid");
  fire(els.get("legion-npcs"), "click", fakeBtn("data-legion-bind-ship", paidNpc.npcId));
  const modal = findModal(W);
  ok(modal != null, "点击绑定弹出舰船选择弹窗");
  fire(modal, "click", fakeBtn("data-ship-pick", instId));
  ok(paidNpc.boundShipInstanceId === instId, "绑定舰船成功（仅调用 assignLegionNpcShip）");

  // 已绑定给其他 NPC 的舰船不可选择（弹窗标记 disabled）
  const other = addNpc("mining", "D");
  fire(els.get("legion-npcs"), "click", fakeBtn("data-legion-bind-ship", other.npcId));
  const modal2 = findModal(W);
  ok(/disabled/.test(modal2.innerHTML) && modal2.innerHTML.indexOf(instId) >= 0, "已绑定舰船在他人选项中 disabled");

  // 更换舰船二次确认
  const ship2 = "ship_x2", inst2 = "inst_x2";
  G.inventory.ships.push({ instanceId: inst2, shipId: ship2 });
  fire(els.get("legion-npcs"), "click", fakeBtn("data-legion-bind-ship", paidNpc.npcId));
  const pickModal = findModal(W);
  fire(pickModal, "click", fakeBtn("data-ship-pick", inst2)); // 触发二次确认
  const confirmModal = findModal(W);
  ok(confirmModal && /确认更换/.test(confirmModal.innerHTML), "更换舰船需要二次确认弹窗");
  fire(confirmModal, "click", fakeBtn("data-confirm-yes", ""));
  ok(paidNpc.boundShipInstanceId === inst2, "二次确认后更换成功");
  ok(G.inventory.ships.filter(s => s.instanceId === instId).length === 1, "旧舰船归还机库（不再销毁）");

  // 解雇需二次确认 → 确认后释放位置
  const cntBefore = G.legion.npcs.length;
  fire(els.get("legion-npcs"), "click", fakeBtn("data-legion-dismiss", overdue.npcId));
  const dismissModal = findModal(W);
  ok(dismissModal && /确认解雇/.test(dismissModal.innerHTML), "解雇需要二次确认弹窗");
  ok(G.legion.npcs.length === cntBefore, "未点确认前不执行解雇");
  fire(dismissModal, "click", fakeBtn("data-confirm-yes", ""));
  ok(G.legion.npcs.length === cntBefore - 1, "确认后解雇，人数位置释放");

  // 贡献总览：含采矿效率递减最终值 / 无 NPC 显示零贡献
  resetLegion();
  for (let i = 0; i < 6; i++) addNpc("mining", "D");
  LR.renderLegionContribution(LP.getLegionContributionSnapshot(G));
  const contrib = els.get("legion-contribution").innerHTML;
  ok(/采矿效率/.test(contrib) && /\+/.test(contrib), "贡献总览显示最终递减后的值");
  // 无有效 NPC
  resetLegion();
  LR.renderLegionContribution(LP.getLegionContributionSnapshot(G));
  ok(/暂无军团加成/.test(els.get("legion-contribution").innerHTML), "无 NPC 时显示暂无军团加成引导文案");
}

// ===== 场景 19-22：台词不重复 / 重复绑定 / 防重复 / 无报错 =====
section("19-22 台词不重复 / 重复绑定事件 / 防重复点击 / 无新增报错");
{
  const { sandbox: W, els } = load([]);
  const G = W.gameState; const LP = W.LEGION_NPC;
  G.station.bodyLevel = 5; G.station.buildings = { legion_hall: 1 }; G.station.dlc = { npcWorkers: true };
  const npc = LP.createNpc({ npcId: "n1", name: "兵", personalityId: (LP.PERSONALITIES && LP.PERSONALITIES[0] ? LP.PERSONALITIES[0].personalityId : null), skillId: "mining", skillGrade: "D", level: 1, xp: 0, salaryState: "paid", dialogueHistory: [] });
  const t1 = LP.getNpcDialogue(npc, "recruit", {}).text;
  const t2 = LP.getNpcDialogue(npc, "recruit", {}).text;
  ok(t1 && t2 && t1 !== t2, "台词不连续重复");

  // 重复进入不重复注册事件
  W.LegionEvents.bind(); W.LegionEvents.bind();
  ok((els.get("legion-entry")._handlers.click || []).length === 1, "页面重复进入不重复绑定事件");

  // 防重复点击：guard 存在（handler 已注册且幂等）
  ok((els.get("legion-candidates")._handlers.click || []).length === 1, "候选人事件 handler 已注册（防重复）");

  // 整体渲染无 Promise rejection / 报错
  let threw = false;
  try {
    W.LegionRender.renderLegionEntry(Date.now());
    W.LegionRender.renderLegionSection(Date.now());
  } catch (e) { threw = true; console.error(e); }
  ok(!threw && W.__guardReports.length === 0, "渲染无新增错误 / RuntimeErrorGuard 无记录");
}

// ===== 场景 23-25：战斗面板小队区域（M5） =====
section("23-25 战斗面板小队区域（M5）");
{
  const { sandbox: W, els } = load([]);
  const G = W.gameState; const LP = W.LEGION_NPC; const SQ = W.LEGION_COMBAT_SQUAD;
  G.station.bodyLevel = 5; G.station.buildings = { legion_hall: 1 }; G.station.dlc = { npcWorkers: true };
  ok(typeof SQ === "object" && typeof W.renderCombatSquadSection === "function", "小队模块与渲染函数已加载");

  // 容器存在（index.html 增量补丁）
  ok(!!els.get("combat-squad-section"), "战斗面板存在小队容器 #combat-squad-section");

  // 造 2 名战斗 NPC（带舰带武器）
  const mkShip = (id, high) => ({ shipId: "rifter", instanceId: id, builtAt: 1, fitted: { high: high || [], mid: [], low: [], rig: [] }, enhancementLevel: 0 });
  G.inventory.ships = [mkShip("p1", ["t1_small_laser"]), mkShip("n1", ["t1_small_laser"]), mkShip("n2", ["t1_small_laser"])];
  G.shipAssignments = { combat: "p1" };
  G.ammo = [{ id: "am1", type: "laser", tier: "T1", name: "激光晶体弹药", props: { dmgMult: 1, hitMult: 1 }, qty: 999, loaded: true }];
  G.resources.fuel = 5000;
  G.legion.npcs = [
    LP.createNpc({ npcId: "cn1", name: "阿尔法", skillId: "laserOps", skillGrade: "B", level: 20, boundShipInstanceId: "n1" }),
    LP.createNpc({ npcId: "cn2", name: "贝塔", skillId: "missileOperations", skillGrade: "C", level: 40, boundShipInstanceId: "n2" })
  ];
  G.research = G.research || {}; G.research.completedLevels = {};

  // 未解锁协议 → 提示锁定且无可选项（容量0不渲染下拉）
  W.renderCombatSquadSection(Date.now());
  let html = els.get("combat-squad-section").innerHTML;
  ok(/双人协议未解锁/.test(html) && /只能玩家单舰战斗/.test(html), "未解锁：显示协议锁定原因");
  ok((html.match(/class="lcs-slot-select"/g) || []).length === 0, "未解锁：容量0，无选角下拉");

  // 解锁双人 → 可选 1 名（渲染 1 个下拉）
  G.research.completedLevels.legion_dual_squad = 1;
  W.renderCombatSquadSection(Date.now());
  html = els.get("combat-squad-section").innerHTML;
  ok(/双人协议已解锁/.test(html) && /上限 2 人/.test(html), "解锁双人：显示可选 1 名（上限含玩家2人）");
  ok((html.match(/class="lcs-slot-select"/g) || []).length === 1, "解锁双人：渲染 1 个选角下拉");
  ok(/阿尔法/.test(html) && /Lv\.20/.test(html), "下拉含 NPC 名字与等级");

  // 选择 → 走 API 写入，不直接改 state
  SQ.setLegionSquadSelection(G, ["cn1"], { now: Date.now() });
  W.renderCombatSquadSection(Date.now());
  html = els.get("combat-squad-section").innerHTML;
  ok((html.match(/<option value="cn1"[^>]*selected/g) || []).length === 1, "已选 NPC 在下拉中回显为 selected");
  ok(SQ.getLegionSquadSelection(G).length === 1, "选择经 API 写入 pendingNpcIds");

  // 防重复绑定：同一 NPC 传入多次仍只有 1 个
  SQ.setLegionSquadSelection(G, ["cn1", "cn1", "cn1"], { now: Date.now() });
  ok(SQ.getLegionSquadSelection(G).length === 1, "UI 侧防重复绑定（重复勾选只算一人）");

  // 开战 → 渲染锁定成员，禁止修改（下拉 disabled）
  SQ.startLegionSquadBattleWithMembers(G, { now: Date.now() });
  W.renderCombatSquadSection(Date.now());
  html = els.get("combat-squad-section").innerHTML;
  ok(/战斗进行中/.test(html), "战斗中：显示成员与舰船已锁定提示");
  ok(/出战中/.test(html), "战斗中：成员徽章为出战中");
  ok(/disabled/.test(html), "战斗中：选角下拉禁用（战后才能改）");

  // M6 Phase 3：战斗中展示逐员目标与开火顺序
  G.combat.enemies = [{ id: "ui-A", name: "目标 A" }, { id: "ui-B", name: "目标 B" }];
  G.combat.squad.targetId = "ui-B";
  G.combat.squad.lastRound = { attacked: 2, totalDamage: 10, targetId: "ui-B", perNpc: [
    { npcId: "cn1", targetId: "ui-A", damage: 4 },
    { npcId: "cn2", targetId: "ui-B", damage: 6 }
  ] };
  W.renderCombatSquadSection(Date.now());
  html = els.get("combat-squad-section").innerHTML;
  ok(/本轮开火顺序/.test(html), "M6 UI：显示本轮开火顺序");
  ok(/目标 A/.test(html) && /目标 B/.test(html), "M6 UI：显示每名 NPC 的当前目标");
  ok(/当前目标：ui-B/.test(html), "M6 UI：显示共享指针的当前目标");

  // 爆船 → 显示修复倒计时与「在岗但暂时无法参战」
  SQ.handleLegionNpcDestroyed(G, "cn1", Date.now());
  W.renderCombatSquadSection(Date.now());
  html = els.get("combat-squad-section").innerHTML;
  ok(/已爆船/.test(html) && /修复 \d+s/.test(html), "爆船：显示已爆船与修复倒计时");
  ok(/在岗，但暂时无法参战/.test(html), "爆船：显示在岗但暂时无法参战");

  // 修复完成 → 本场不归队（D4），提示下一场可参战
  SQ.completeLegionNpcRepair(G, "cn1", Date.now() + 180000);
  W.renderCombatSquadSection(Date.now() + 180000);
  html = els.get("combat-squad-section").innerHTML;
  ok(/修复完成：本场已退出，下一场可参战/.test(html), "修复完成：本场不归队，提示下一场可参战");
  // 战后（squad 已清理）→ 恢复可参战
  SQ.endLegionSquadBattle(G);
  W.renderCombatSquadSection(Date.now() + 180000);
  html = els.get("combat-squad-section").innerHTML;
  ok(/可参战/.test(html), "战斗结束后：修复完成的 NPC 恢复可参战");

  // 欠薪文案（方块只渲染已选中的 NPC，故设在当前出战选择 cn1 上）
  SQ.endLegionSquadBattle(G);
  G.legion.npcs[0].salaryState = "overdue"; // cn1 为当前选择
  W.renderCombatSquadSection(Date.now() + 180000);
  html = els.get("combat-squad-section").innerHTML;
  ok(/欠薪/.test(html), "欠薪：显示欠薪状态文案");

  // 渲染无异常
  let threw = false;
  try { W.renderCombatSquadSection(Date.now()); W.renderCombatPanel(Date.now()); } catch (e) { threw = true; console.error(e); }
  ok(!threw, "小队区域与战斗面板整体渲染无异常");
}

console.log("\n军团 UI 测试：PASS=" + pass + "  FAIL=" + fail);
if (failures.length) { console.log("失败项："); failures.forEach(f => console.log("  - " + f)); }
process.exit(fail ? 1 : 0);
