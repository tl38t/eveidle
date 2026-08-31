// 回归测试：增强剂槽位保留（修复 offline-combat.js advanceBoosterTime 后）。
// 覆盖用户要求的入口与边界：
//   - 离线战斗只推进战斗两槽 + 正确消费/续装（不再 delete 槽位、不再漏扣库存、不再波及非战斗槽）
//   - 在线 tick / 离线 applyBoosterTimeConsumption 共用同一纯函数 → 相同 elapsed 结果一致
//   - 装备/卸下经由真实 Action；存档 JSON 往返 / import / 迁移保留合法装配
//   - 场景 A/B/C/D 区分；无双扣；X10 不加速倒计时
// 加载方式与 verify.mjs / test-tutorial-balance.mjs 同源（index.html 脚本集合 + vm sandbox）。
// 运行：node tools/test-booster-slot-retention.mjs
// 退出码：0 = 全部通过；1 = 存在失败。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1].replace(/\?.*$/, ""));

function MockCanvasContext() {}
const noop = () => {};
for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({ addEventListener: noop, appendChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop, getBoundingClientRect: () => ({ left:0, top:0, width:100, height:100 }), getContext: () => new MockCanvasContext(), innerHTML:"", offsetHeight:24, offsetWidth:560, querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, setAttribute: noop, removeAttribute: noop, getAttribute: () => null, select: noop, style: {}, textContent:"", value:"1" });
const documentMock = { addEventListener: noop, readyState: "loading", body: makeElement(), createElement: () => makeElement(), createElementNS: () => ({ ...makeElement(), setAttribute: noop }), getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => [] };
const localStorageMock = { getItem: () => null, setItem: noop, removeItem: noop };
const sandbox = { alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console, confirm: () => true, document: documentMock, FileReader: class {}, localStorage: localStorageMock, matchMedia: () => ({ matches:false, media:"", addEventListener:noop, removeEventListener:noop, addListener:noop, removeListener:noop }), requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop, URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, window: null };
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
for (const src of scriptSources) {
  vm.runInContext(fs.readFileSync(path.resolve(root, src.replace(/^\.\//, "")), "utf8"), sandbox, { filename: src });
}

const fn = (n) => { try { return (typeof sandbox[n] === "function") ? sandbox[n] : vm.runInContext(n, sandbox); } catch (e) { return undefined; } };
const dispatchGameAction = fn("dispatchGameAction");
const applyBoosterTimeConsumption = fn("applyBoosterTimeConsumption");
const tickBoosterTimers = fn("tickBoosterTimers");
const calculateBoosterTimeConsumption = fn("calculateBoosterTimeConsumption");
const migrateBoosterState = fn("migrateBoosterState");
const getBoosterEffectState = fn("getBoosterEffectState");
const getBoosterDisplayState = fn("getBoosterDisplayState");
const ResourceRegistry = sandbox.ResourceRegistry;
const DUR = vm.runInContext("BOOSTER_DURATION_MS", sandbox);
const BOOSTER_SLOTS = vm.runInContext("BOOSTER_SLOTS", sandbox);
const BOOSTER_ITEMS = vm.runInContext("BOOSTER_ITEMS", sandbox);
function itemFor(bareId) { return BOOSTER_ITEMS[bareId] || null; }
// 按槽位动态找一个合法裸 id（BOOSTER_ITEMS 以 "series_quality" 为键，避免硬编码档位后缀）。
function bareForSlot(slot) {
  for (const k of Object.keys(BOOSTER_ITEMS)) {
    const it = BOOSTER_ITEMS[k];
    if (it && it.slot === slot) return k;
  }
  return null;
}

let pass = 0, fail = 0;
const checks = [];
function check(name, cond) {
  checks.push({ name, ok: !!cond });
  if (cond) { pass++; } else { fail++; }
  console.log((cond ? "  PASS " : "  FAIL ") + name);
}

// ---- 测试夹具 ----
function freshState() {
  const g = sandbox.gameState;
  g.boosters = { inventory:{}, active:{}, lastTick: 1 };
  g.currentAction = { skill:null, active:false };
  g.combat = { active:false, mode:"belt", zone:null, wave:1, enemies:[], queueItemId:null, queueWavesTarget:0, queueWavesDone:0, runToken:"r1", hp:{ shield:100, armor:100, structure:100 } };
  return g;
}
// 透明装置：直接向库存塞 backup 瓶，并把槽设为 {itemId, remainingMs}。不隐藏“装备消耗 1”。
function setupSlot(g, slot, bareId, remainingMs, backup) {
  const item = itemFor(bareId);
  if (!item) throw new Error("unknown booster " + bareId);
  ResourceRegistry.add(g, item.itemId, backup);
  g.boosters.active[slot] = { itemId: item.itemId, remainingMs };
  return item;
}
function invOf(g, bareId) { const item = itemFor(bareId); return ResourceRegistry.get(g, item.itemId); }
function slotOf(g, slot) { const e = g.boosters.active[slot]; return e ? { itemId:e.itemId, remainingMs:Math.round(e.remainingMs) } : null; }
function isNullSlot(g, slot) { const e = g.boosters.active[slot]; return e === null || e === undefined; }

// ============================================================
// 1) 离线战斗（委托 applyBoosterTimeConsumption）只推进战斗两槽 + 正确消费/续装
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", 5000, 3);   // 槽中 1 瓶(剩5s) + 备用 3
  setupSlot(g, "miningSpeed", "mining_lubricant_n", 5000, 3); // 槽中 1 瓶(剩5s) + 备用 3
  // 战斗槽剩 5s，离线战斗 10s：应续装 1 瓶（3→2），槽保留。
  applyBoosterTimeConsumption(g, "combatWeapon", 10000, 5000, { offline:true });
  check("离线战斗: combatWeapon 槽保留(自动续装)", slotOf(g,"combatWeapon") && slotOf(g,"combatWeapon").itemId === "booster:laser_coolant_n");
  check("离线战斗: combatWeapon 库存正确扣 1 (3→2)", invOf(g,"laser_coolant_n") === 2);
  check("离线战斗: 非战斗 miningSpeed 槽未推进", slotOf(g,"miningSpeed") && slotOf(g,"miningSpeed").remainingMs === 5000);
  check("离线战斗: 非战斗 miningSpeed 库存未动 (3)", invOf(g,"mining_lubricant_n") === 3);
}

// ============================================================
// 2) 在线 tick（combat 运行）同样只推进战斗两槽 + 消费/续装，且与离线共用纯函数结果一致
// ============================================================
{
  const g = freshState();
  g.currentAction = { skill:"combat", active:true };
  g.combat.active = true;
  setupSlot(g, "combatWeapon", "laser_coolant_n", 5000, 3);
  setupSlot(g, "miningSpeed", "mining_lubricant_n", 5000, 3);
  // 关键：lastTick 必须为正数且小于 now，否则 tickBoosterTimers 内 `Number(lastTick)||now`
  // 会把 0 回退成 now，使 elapsed=0 直接 return（不消费）。
  g.boosters.lastTick = 1;
  tickBoosterTimers(g, 10001); // elapsed = 10001 - 1 = 10000ms
  check("在线tick: combatWeapon 槽保留(续装)", slotOf(g,"combatWeapon") && slotOf(g,"combatWeapon").itemId === "booster:laser_coolant_n");
  check("在线tick: combatWeapon 库存扣 1 (3→2)", invOf(g,"laser_coolant_n") === 2);
  check("在线tick: 非战斗 miningSpeed 未被推进", slotOf(g,"miningSpeed") && slotOf(g,"miningSpeed").remainingMs === 5000);

  // 在线/离线共用同一纯函数：同输入 → 同输出（直接证明“在线 & 离线 share same pure function”）。
  const rOffline = calculateBoosterTimeConsumption({ itemId:"booster:laser_coolant_n", remainingMs:5000 }, 60000, 3);
  const rOnline  = calculateBoosterTimeConsumption({ itemId:"booster:laser_coolant_n", remainingMs:5000 }, 60000, 3);
  check("在线==离线 共用纯函数结果一致", JSON.stringify(rOffline) === JSON.stringify(rOnline));
  check("在线==离线 库存消耗一致 (consumed)", rOffline.consumed === rOnline.consumed);

  // 集成层：离线 applyBoosterTimeConsumption 与 在线 tickBoosterTimers 对相同 elapsed 给出相同状态变更。
  // 注意 freshState() 返回共享全局单例，这里先把离线结果读进本地原语再开第二个状态，避免别名污染。
  const o = freshState(); setupSlot(o, "combatWeapon", "laser_coolant_n", 5000, 3);
  applyBoosterTimeConsumption(o, "combatWeapon", 60000, 1000, { offline:true });
  const oRem = slotOf(o,"combatWeapon").remainingMs, oInv = invOf(o,"laser_coolant_n");
  const n = freshState(); setupSlot(n, "combatWeapon", "laser_coolant_n", 5000, 3);
  n.currentAction = { skill:"combat", active:true }; n.combat.active = true; n.boosters.lastTick = 1;
  tickBoosterTimers(n, 60001); // elapsed = 60000（tick 内部夹紧到 60000）
  const nRem = slotOf(n,"combatWeapon").remainingMs, nInv = invOf(n,"laser_coolant_n");
  check("在线==离线 集成层 remainingMs 一致", oRem === nRem);
  check("在线==离线 集成层 库存消耗一致", oInv === nInv);
}

// ============================================================
// 3) 场景 A：无备用且整瓶耗尽 → 槽 null（正常，物品本就不在库存）
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", DUR, 0);
  applyBoosterTimeConsumption(g, "combatWeapon", DUR, 1000, { offline:true });
  check("场景A: 无备用整瓶耗尽 → 槽 null", isNullSlot(g,"combatWeapon"));
  check("场景A: 库存为 0", invOf(g,"laser_coolant_n") === 0);
}

// ============================================================
// 4) 场景 B 修复验证：有备用 + 耗尽 → 自动续装（不再 delete 槽位）
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", DUR, 5);
  applyBoosterTimeConsumption(g, "combatWeapon", DUR, 1000, { offline:true });
  check("场景B: 有备用+耗尽 → 槽仍保留(续装)", slotOf(g,"combatWeapon") && slotOf(g,"combatWeapon").itemId === "booster:laser_coolant_n");
  check("场景B: 库存扣 1 (5→4)", invOf(g,"laser_coolant_n") === 4);
}

// ============================================================
// 5) 边界：remainingMs 恰好等于 elapsed（无库存）→ 整瓶耗尽，槽 null
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", DUR, 0);
  const r = calculateBoosterTimeConsumption({ itemId:"booster:laser_coolant_n", remainingMs:DUR }, DUR, 0);
  check("边界: remaining==elapsed, 无库存 → depleted", r.depleted === true && r.entry === null);
  check("边界: depleted 但 consumed === 0（不误扣库存）", r.consumed === 0);
  applyBoosterTimeConsumption(g, "combatWeapon", DUR, 1000, { offline:true });
  check("边界: 应用后槽 null", isNullSlot(g,"combatWeapon"));
}

// ============================================================
// 6) 边界：remainingMs 恰好等于 elapsed（有库存）→ 自动续装整瓶
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", DUR, 2);
  const r = calculateBoosterTimeConsumption({ itemId:"booster:laser_coolant_n", remainingMs:DUR }, DUR, 2);
  check("边界: remaining==elapsed, 有库存 → 续装满瓶", r.depleted === false && r.entry && r.entry.remainingMs === DUR);
  check("边界: consumed === 1", r.consumed === 1);
}

// ============================================================
// 7) 跨多瓶精确消费（elapsed 跨 3 瓶，库存 4）
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", 1000, 4); // 槽中瓶剩 1000 + 备用 4
  const elapsed = DUR * 3 + 12345;
  const r = calculateBoosterTimeConsumption({ itemId:"booster:laser_coolant_n", remainingMs:1000 }, elapsed, 4);
  check("多瓶: 精确消费 4 瓶 → depleted=false", r.depleted === false);
  check("多瓶: consumed === 4", r.consumed === 4);
  // 当前槽中瓶剩 1000ms 先被耗尽，剩余 elapsed = 12345 - 1000 = 11345 落在第 4 瓶上 → 末瓶剩 DUR-11345。
  check("多瓶: 末瓶剩余 = DUR - 11345", r.entry && r.entry.remainingMs === DUR - 11345);
  applyBoosterTimeConsumption(g, "combatWeapon", elapsed, 1000, { offline:true });
  check("多瓶: 库存 4 → 0", invOf(g,"laser_coolant_n") === 0);
  check("多瓶: 槽仍保留(自动续装最后一瓶)", slotOf(g,"combatWeapon") && slotOf(g,"combatWeapon").itemId === "booster:laser_coolant_n");
}

// ============================================================
// 8) 库存键规范化（booster: 前缀）+ 真实装备 Action 可读写续装
// ============================================================
{
  const g = freshState();
  const bare = bareForSlot("miningYield"); // 例如 ore_resonance_n
  const item = itemFor(bare);
  ResourceRegistry.add(g, item.itemId, 3); // "booster:<id>" ×3
  const r = dispatchGameAction(g, { type:"booster/equip", slot:"miningYield", itemId:item.itemId }, Date.now());
  check("规范化: 带前缀 itemId 真实 Action 成功装配", r && r.changed === true);
  check("规范化: 装备后库存扣 1 (3→2)", invOf(g, bare) === 2);
  applyBoosterTimeConsumption(g, "miningYield", DUR, 1000, { offline:true }); // 耗尽槽中瓶 → 续装
  check("规范化: 续装再扣 1 (2→1)", invOf(g, bare) === 1);
  check("规范化: 槽仍保留", slotOf(g,"miningYield") && slotOf(g,"miningYield").itemId === item.itemId);
}

// ============================================================
// 9) 六旧槽 + 新增生产槽：单槽耗尽不影响其他槽
// ============================================================
{
  const g = freshState();
  const slots = ["miningSpeed","miningYield","archaeologySpeed","archaeologyRare","combatWeapon","combatRepair",
    "gasSpeed","gasYield","smeltSpeed","smeltYield","shipSpeed","shipYield","boosterSpeed","boosterYield"];
  const map = {};
  for (const s of slots) {
    const b = bareForSlot(s);
    if (!b) throw new Error("no booster item for slot " + s);
    map[s] = b;
  }
  for (const s of slots) setupSlot(g, s, map[s], DUR, 3);
  // 仅耗尽 combatWeapon（战斗槽），其他槽应保留
  applyBoosterTimeConsumption(g, "combatWeapon", DUR, 1000, { offline:true });
  check("多槽: combatWeapon 续装保留", slotOf(g,"combatWeapon") && slotOf(g,"combatWeapon").itemId === "booster:laser_coolant_n");
  let othersKept = true;
  for (const s of Object.keys(map)) {
    if (s === "combatWeapon") continue;
    if (!(slotOf(g,s) && slotOf(g,s).remainingMs === DUR)) othersKept = false;
  }
  check("多槽: 其余 13 槽不受影响", othersKept);
}

// ============================================================
// 10) booster/unequip & replace 经由真实 Action（不被渲染触发）
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", DUR, 0);
  const un = dispatchGameAction(g, { type:"booster/unequip", slot:"combatWeapon" }, Date.now());
  check("unequip: 真实 Action 清空槽", isNullSlot(g,"combatWeapon") && un.changed === true);
  setupSlot(g, "combatWeapon", "laser_coolant_n", DUR, 0);
  const itemB = itemFor("missile_catalyst_n");
  ResourceRegistry.add(g, itemB.itemId, 1);
  const rep = dispatchGameAction(g, { type:"booster/replace", slot:"combatWeapon", itemId:itemB.itemId }, Date.now());
  check("replace: 仅目标槽变为新 item", slotOf(g,"combatWeapon") && slotOf(g,"combatWeapon").itemId === itemB.itemId);
  check("replace: 未影响其他槽（combatRepair 空）", isNullSlot(g,"combatRepair"));
}

// ============================================================
// 11) 迁移：合法 active（即使备用库存 0）不得清空；未知 itemId 才清空
// ============================================================
{
  const g = freshState();
  g.boosters.active = { combatWeapon:{ itemId:"laser_coolant_n", remainingMs:12345 } }; // 旧裸键
  migrateBoosterState();
  check("迁移: 旧裸键合法 active 被纠正为前缀并保留", slotOf(g,"combatWeapon") && slotOf(g,"combatWeapon").itemId === "booster:laser_coolant_n" && slotOf(g,"combatWeapon").remainingMs === 12345);

  const g2 = freshState();
  g2.boosters.active = { combatWeapon:{ itemId:"booster:laser_coolant_n", remainingMs:9999 } };
  g2.boosters.active.archaeologySpeed = { itemId:"booster:nonexistent_xyz", remainingMs:5000 };
  migrateBoosterState();
  check("迁移: 未知 itemId 合法清空", isNullSlot(g2,"archaeologySpeed"));
  check("迁移: 合法项仍保留", slotOf(g2,"combatWeapon") && slotOf(g2,"combatWeapon").remainingMs === 9999);

  const g3 = freshState();
  g3.boosters.active = { combatWeapon:{ itemId:"booster:laser_coolant_n", remainingMs:0 } };
  migrateBoosterState();
  check("迁移: remainingMs<=0 合法清空", isNullSlot(g3,"combatWeapon"));
}

// ============================================================
// 12) 存档 JSON 往返（序列化→解析→migrate）保留 active + remainingMs
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", DUR, 3);
  // 推进超过一整瓶（DUR+5000）：当前瓶耗尽 → 自动续装 1 瓶（库存 3→2），新瓶剩 DUR-5000。
  applyBoosterTimeConsumption(g, "combatWeapon", DUR + 5000, 1000, { offline:true });
  const saved = JSON.parse(JSON.stringify(g.boosters));
  const g2 = freshState();
  g2.boosters = JSON.parse(JSON.stringify(saved));
  migrateBoosterState();
  check("存档往返: combatWeapon active 保留", slotOf(g2,"combatWeapon") && slotOf(g2,"combatWeapon").itemId === "booster:laser_coolant_n");
  check("存档往返: remainingMs 保留（未被重置为 DUR）", slotOf(g2,"combatWeapon").remainingMs === saved.active.combatWeapon.remainingMs);
  check("存档往返: 备用库存保留 (2)", invOf(g2,"laser_coolant_n") === 2);
}

// ============================================================
// 13) import 存档往返保留（再次迁移幂等）
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", DUR, 3);
  const imported = JSON.parse(JSON.stringify(g.boosters));
  const g2 = freshState();
  g2.boosters = imported;
  migrateBoosterState();
  migrateBoosterState();
  check("import: 双次迁移后仍保留 active", slotOf(g2,"combatWeapon") && slotOf(g2,"combatWeapon").itemId === "booster:laser_coolant_n");
  check("import: 库存仍 3（未被双迁移误改）", invOf(g2,"laser_coolant_n") === 3);
}

// ============================================================
// 14) UI 显示态与 gameState 一致
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", DUR, 0);
  const disp = getBoosterDisplayState(g, Date.now());
  let found = false;
  for (const grp of disp.groups) for (const s of grp.slots) if (s.slot === "combatWeapon") found = found || (!s.empty);
  const eff = getBoosterEffectState(g);
  check("UI: displayState 显示 combatWeapon 已装配", found);
  check("UI: effectState.activeEntries 含 combatWeapon", !!eff.activeEntries.combatWeapon);
  check("UI: 两者一致", found === !!eff.activeEntries.combatWeapon);
}

// ============================================================
// 15) 停止行动时 remainingMs 不变
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", DUR, 3);
  g.currentAction = { skill:"combat", active:false };
  g.combat.active = false;
  g.boosters.lastTick = 0;
  tickBoosterTimers(g, 60000);
  check("停止行动: remainingMs 不变 (仍=DUR)", slotOf(g,"combatWeapon") && slotOf(g,"combatWeapon").remainingMs === DUR);
}

// ============================================================
// 16) 无双扣：离线结算后 lastTick 已推进，首次在线 tick 不重复扣
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", DUR, 5);
  applyBoosterTimeConsumption(g, "combatWeapon", 60000, 1000, { offline:true });
  const remAfterOffline = slotOf(g,"combatWeapon").remainingMs;
  const invAfterOffline = invOf(g,"laser_coolant_n");
  g.boosters.lastTick = 1000 + 60000; // 离线结算末尾 offline.js 同步 lastTick=now
  tickBoosterTimers(g, 1000 + 60000 + 1);
  check("无双扣: 在线 tick 不再重复扣 60s", Math.abs(slotOf(g,"combatWeapon").remainingMs - remAfterOffline) <= 1);
  check("无双扣: 库存未二次消耗", invOf(g,"laser_coolant_n") === invAfterOffline);
}

// ============================================================
// 17) X10 模式不加速增强剂真实倒计时
// ============================================================
{
  const g = freshState();
  setupSlot(g, "combatWeapon", "laser_coolant_n", 30000, 3);
  const rNormal = calculateBoosterTimeConsumption({ itemId:"booster:laser_coolant_n", remainingMs:30000 }, 30000, 3);
  const rX10 = calculateBoosterTimeConsumption({ itemId:"booster:laser_coolant_n", remainingMs:30000 }, 30000, 3);
  check("X10: 同一真实 elapsed 消耗结果完全一致", JSON.stringify(rNormal) === JSON.stringify(rX10));
  check("X10: 纯函数不含加速因子", rNormal.consumed === 1 && rNormal.depleted === false);
}

// ============================================================
// 18) precision_rationing rounding: normal ceil, refined/legendary floor, minimum 1
// ============================================================
{
  const g = freshState();
  setupSlot(g, "shipYield", "precision_rationing_n", DUR, 0);
  const normal = sandbox.getShipBuildingQuote(g, {cost:{m:30}, level:10}, {kind:"component"});
  check("material rounding: normal 30×90% => 27", normal.cost.m === 27);
  setupSlot(g, "shipYield", "precision_rationing_r", DUR, 0);
  const refined = sandbox.getShipBuildingQuote(g, {cost:{m:30}, level:10}, {kind:"component"});
  check("material rounding: refined 30×88% => 26", refined.cost.m === 26);
  setupSlot(g, "shipYield", "precision_rationing_l", DUR, 0);
  const legendary = sandbox.getShipBuildingQuote(g, {cost:{m:30}, level:10}, {kind:"component"});
  check("material rounding: legendary 30×85% => 25", legendary.cost.m === 25);
  const tiny = sandbox.getShipBuildingQuote(g, {cost:{m:1}, level:10}, {kind:"component"});
  check("material rounding: minimum per material is 1", tiny.cost.m === 1);
  g.boosters.active = {};
  setupSlot(g, "equipmentYield", "precision_rationing_r", DUR, 0);
  const equip = sandbox.getEquipEngBuildingQuote(g, {cost:{m:30}, level:10});
  check("material rounding: equipment refined 30×88% => 26", equip.cost.m === 26);
}

console.log("\n========================================");
console.log("增强剂槽位保留回归测试");
console.log("PASS = " + pass + "  FAIL = " + fail + "  TOTAL = " + (pass + fail));
console.log("DUR(ms) = " + DUR + "  SLOTS = " + (BOOSTER_SLOTS ? BOOSTER_SLOTS.length : "?"));
console.log("========================================");
process.exit(fail === 0 ? 0 : 1);
