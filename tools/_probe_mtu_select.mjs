// 探针：NPC select 下拉里"直接装备 MTU"端到端验证（诊断用，不入库）。
// 覆盖：setLegionSquadSelection 拆 NPC/deployable、容量共享、旧 deployable 自动取消、双轨制、ui.selection 合并、MTU_MAX_DEPLOYED 硬上限。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const scriptSources = [];
const re = /<script\s+defer\s+src="([^"]+)"/g;
let m;
while ((m = re.exec(html))) scriptSources.push(m[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
const UI_EXCLUDE = new Set([
  "js/ui/error-boundary.js", "js/ui/action-modal.js", "js/ui/shell-render.js",
  "js/ui/manufacturing-render.js", "js/ui/combat-render.js", "js/ui/planetary-render.js",
  "js/ui/archaeology-render.js", "js/ui/booster-render.js", "js/ui/render.js", "js/core/runtime.js",
  "js/ui/taptap-portrait.js", "js/ui/ad-buff-widget.js"
]);
const logicSources = scriptSources.filter(s => !UI_EXCLUDE.has(s));

let combined = "";
for (const src of logicSources) {
  const full = path.resolve(ROOT, src);
  if (!full.startsWith(ROOT + path.sep) || !fs.existsSync(full)) throw new Error("本地脚本缺失：" + src);
  combined += "\n;\n// ===== " + src + " =====\n" + fs.readFileSync(full, "utf8");
}

const noop = () => {};
function MockCanvasContext() {}
for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({
  addEventListener: noop, removeEventListener: noop, appendChild: noop, insertBefore: noop, insertAdjacentHTML: noop,
  replaceChildren: noop, removeChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop,
  getBoundingClientRect: () => ({ left:0, top:0, width:100, height:100 }),
  getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560,
  querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, setAttribute: noop, removeAttribute: noop,
  getAttribute: () => null, select: noop, style: {}, textContent: "", value: "1", children: [], parentNode: null
});
const documentMock = {
  addEventListener: noop, body: makeElement(), createElement: () => makeElement(), createElementNS: () => ({ ...makeElement(), setAttribute: noop }),
  getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => []
};
const localStorageMock = { getItem: () => null, setItem: noop, removeItem: noop };
const sandbox = {
  alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console, confirm: () => true, document: documentMock,
  FileReader: class {}, localStorage: localStorageMock, requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop },
  matchMedia: () => ({ matches: false, media:"", onchange:null, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop, dispatchEvent: noop }),
  GameEvents: { emit: noop, on: () => () => {}, once: noop, contracts: { has: () => true, validate: () => ({ valid:true, registered:true }) }, listenerCount: () => 0 },
  RuntimeGuard: { report: noop, runCritical: () => ({ ok:true }), resume: () => true, isPaused: () => false, runRecoverable: () => ({ ok:true }) },
  window: null
};
sandbox.window = sandbox; sandbox.window.addEventListener = noop;
sandbox.addEventListener = noop; sandbox.removeEventListener = noop; sandbox.dispatchEvent = noop;
sandbox.location = { href:"", search:"", hash:"" };
sandbox.navigator = { userAgent: "node" };
sandbox.innerWidth = 1280; sandbox.innerHeight = 800;
sandbox.updateUI = noop; sandbox.switchPage = noop; sandbox.currentPage = "";
sandbox.updateLiveUI = noop; sandbox.refreshVisiblePanelAfterAction = noop;
sandbox.playAttackFX = noop; sandbox.playEnemyAttackFX = noop;

vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: "combined.js" });

// 从 sandbox 把需要的函数装到主作用域（vm 共享原型时方便用）
function R(expr) { return vm.runInContext(expr, sandbox); }
const LCS = R("LEGION_COMBAT_SQUAD");
const ResourceRegistry = R("ResourceRegistry");

// 极简测试 helper
let passed = 0, failed = 0;
const failMessages = [];
function ok(cond, name, info) {
  if (cond) { passed++; }
  else {
    failed++;
    failMessages.push((info != null ? "  ✗ " + name + " : " + JSON.stringify(info) : "  ✗ " + name));
  }
}
function assign(name, value) { sandbox[name] = value; }

// —— 构造最小 squad state ——
function makeState({ dualUnlocked = true, tripleUnlocked = false, nNpcs = 0, researchAll = true } = {}) {
  const npcs = [];
  for (let i = 0; i < nNpcs; i++) {
    npcs.push({
      npcId: "npc_" + i,
      name: "测试NPC" + i,
      level: 50,
      skillId: "laserOps",
      skillLevel: 50,
      salaryState: "paid",
      boundShipInstanceId: "ship_" + i,
      combatHp: { shield: null, armor: null, structure: null },
      destroyed: false,
      repairUntil: null,
      occupiedByCombat: false
    });
  }
  const ships = [];
  for (let i = 0; i < nNpcs; i++) {
    ships.push({
      instanceId: "ship_" + i,
      shipId: "rookie_corvette", // frigate → combat (fallthrough)
      fitted: { high: ["t1_small_laser"], mid: [], low: [], rig: [] }
    });
  }
  return {
    legion: { npcs: npcs, hallLevel: 1, active: true, dlc: { unlocked: true } },
    station: { bodyLevel: 3, buildings: { legion_hall: 1 } },
    resources: { fuel: 5000 }, // 确保 consumable:fuel 在 getMtuModifiers 看到足够燃料
    combat: {
      zone: null,
      active: false,
      squad: {
        enabled: false,
        members: [],
        deployables: [],
        deployableStorage: [],
        pendingNpcIds: [],
        targetId: null,
        battleId: null,
        lastRound: null
      }
    },
    inventory: { ships: [
      // 玩家舰（让 getActiveCombatShipState 不抛 NPE）
      { instanceId: "ship_player", shipId: "rookie_corvette", fitted: { high:["t1_small_laser"], mid:[], low:[], rig:[] } },
      ...ships
    ] },
    // 装备实例表（resolveEquipmentReference 在缺省时直接返回 null → NPC 被误判 no-weapon；真实存档恒有此字段）
    equipment: { instances: [], inventory: [] },
    shipAssignments: {},
    research: { completedLevels: {
        ...(dualUnlocked ? { legion_dual_squad: 1 } : {}),
        ...(tripleUnlocked ? { legion_triple_squad: 1 } : {})
      } },
    settings: {},
    _dirty: false
  };
}

// —— 检查已装备 deployable 的形状 ——
const id = "laser_directional_salvage_unit";
const depVal = "deployable:" + id;
// LCS 已在 vm.createContext 后赋值

// =================================================================
//  1. 玩家从空选择开始，下拉选 MTU → 立即虚拟装备到 deployables
// =================================================================
console.log("\n=== 1. 仅选 MTU：squad.deployables = [MTU]，virtual/no storage ===");
{
  const st = makeState();
  st.combat.squad.deployableStorage = [id]; // 修正后：需先制造/拥有才能经下拉入队
  const r = LCS.setLegionSquadSelection(st, [depVal]);
  ok(r.changed === true, "返回 changed=true");
  ok(r.deployableIds.length === 1 && r.deployableIds[0] === id, "返回 deployableIds=[MTU]", r);
  ok(r.npcIds.length === 0, "返回 npcIds=[]（无 NPC）");
  ok(st.combat.squad.deployables.length === 1, "squad.deployables 长度 = 1");
  // 诊断：JSON 可能因 Date.now/等被丢掉引用 — 用 JSON.stringify 看实际内容
  const dump = JSON.stringify(st.combat.squad.deployables);
  ok(st.combat.squad.deployables[0] && st.combat.squad.deployables[0].deployableId === id, "deployableId 正确", { idx: st.combat.squad.deployables[0], dump });
  ok(st.combat.squad.deployableStorage.length === 1 && st.combat.squad.deployableStorage[0] === id, "deployableStorage 未被动（虚拟装备不消耗库存）");
  ok(st.combat.squad.pendingNpcIds.length === 0, "pendingNpcIds=[]");
}

// =================================================================
//  2. 仅选 NPC：deployables 清空，pendingNpcIds=[npc]
// =================================================================
console.log("\n=== 2. 仅选 NPC：deployables 自动清空（虚拟装备随 selection 权威化） ===");
{
  const st = makeState({ nNpcs: 2 });
  st.combat.squad.deployableStorage = [id];
  // 先虚拟装备一台 MTU
  LCS.setLegionSquadSelection(st, [depVal]);
  ok(st.combat.squad.deployables.length === 1, "前置：deployables=[MTU]");
  // 改成只放 NPC_0
  const r = LCS.setLegionSquadSelection(st, ["npc_0"]);
  if (!r.changed) {
    const cv = LCS.canLegionNpcJoinCombat(st, "npc_0", { now: Date.now() });
    console.log("  [diag] canLegionNpcJoinCombat(npc_0) =", JSON.stringify(cv));
    console.log("  [diag] npcs=" + st.legion.npcs.length, "ships=" + st.inventory.ships.length);
    console.log("  [diag] ship_0 =", JSON.stringify(st.inventory.ships.find(s => s.instanceId === "ship_0")));
  }
  ok(r.changed === true, "返回 changed=true", r.reason ? { reason: r.reason } : null);
  ok(st.combat.squad.deployables.length === 0, "squad.deployables=[]");
  ok(st.combat.squad.pendingNpcIds.length === 1 && st.combat.squad.pendingNpcIds[0] === "npc_0", "pendingNpcIds=[npc_0]");
}

// =================================================================
//  3. 同时选 NPC + MTU：容量共享写入
// =================================================================
console.log("\n=== 3. 同时选 NPC + MTU：capacity 校验 ===");
{
  const st = makeState({ nNpcs: 3, tripleUnlocked: true });
  // 三人协议 capacity=2
  const cap = LCS.getLegionSquadCapacity(st);
  ok(cap === 2, "三人协议容量 = 2（前置）", cap);
  st.combat.squad.deployableStorage = [id]; // 修正后：需先拥有

  // 同时选 1 NPC + 1 MTU → 都接受
  const r = LCS.setLegionSquadSelection(st, ["npc_0", depVal]);
  ok(r.changed === true, "返回 changed=true");
  ok(r.npcIds.length === 1 && r.npcIds[0] === "npc_0", "npcIds=[npc_0]");
  ok(r.deployableIds.length === 1 && r.deployableIds[0] === id, "deployableIds=[MTU]");
  ok(st.combat.squad.deployables.length === 1 && st.combat.squad.pendingNpcIds.length === 1, "双方都计入");

  // 已满（npc_0 + MTU），再请求 npc_1 + MTU + npc_2：selection 为权威，重排为 npc_1 + MTU（cap 2），npc_2 满员拒绝
  const r2 = LCS.setLegionSquadSelection(st, ["npc_1", depVal, "npc_2"]);
  ok(r2.changed === true, "返回 changed=true", r2.reason || null);
  ok(r2.npcIds.length === 1 && r2.npcIds[0] === "npc_1", "重排后只接受 npc_1（权威 selection 顶替 npc_0）", r2.npcIds);
  ok(st.combat.squad.pendingNpcIds.length === 1 && st.combat.squad.pendingNpcIds[0] === "npc_1", "pendingNpcIds=[npc_1]（npc_0 被新 selection 顶替）");
  ok(st.combat.squad.deployables.length === 1 && st.combat.squad.deployables[0].deployableId === id, "MTU 仍在队（重选，非 deploy-full）");
  ok(r2.skipped.some(s => s.npcId === "npc_2" && s.reason === "squad-full"), "npc_2 squad-full skip", r2.skipped);
  ok(!r2.skipped.some(s => s.deployableId === id && s.reason === "deploy-full"), "仅 1 台 MTU 请求 → 无 deploy-full", r2.skipped);

  // NPC 满 + deployable 已装：撤掉 deployable 选第 2 NPC
  const r3 = LCS.setLegionSquadSelection(st, ["npc_0", "npc_1"]);
  ok(r3.npcIds.length === 2, "取消 MTU 后 2 NPC 全接受", r3.npcIds);
  ok(st.combat.squad.deployables.length === 0, "deployables=[]");
  ok(st.combat.squad.pendingNpcIds.length === 2, "pendingNpcIds=2");
}

// =================================================================
//  4. MTU_MAX_DEPLOYED=1 硬上限（即使 capacity=2 也不能部署 2 台）
// =================================================================
console.log("\n=== 4. MTU_MAX_DEPLOYED=1：尝试 2 台 deployable，1 接受 1 deploy-full ===");
{
  const st = makeState();
  st.combat.squad.deployableStorage = [id];
  const r = LCS.setLegionSquadSelection(st, [depVal, depVal]); // 重复（重复检测会先去重）
  ok(r.deployableIds.length === 1, "同一 id 自动去重 = 1 台");
  // 模拟两个不同 deployable id 但都被 MTU_MAX_DEPLOYED 截
  // （当前仅一个 MTU，但通过 L2.prototype 验证硬上限生效）
  // 修正后：被截的第二个也需"拥有"才走 deploy-full（否则报 not-owned）
  st.combat.squad.deployableStorage = [id, "other_dummy"];
  const fakeTwo = [depVal, "deployable:other_dummy"];
  const r2 = LCS.setLegionSquadSelection(st, fakeTwo);
  // 仅 first 接受；如果 first 是 MTU、被截 → 1 接受
  ok(r2.deployableIds.length === 1, "MTU_MAX_DEPLOYED=1 限制总接受数 = 1（first in wins）", r2.deployableIds);
  ok(r2.skipped.some(s => s.reason === "deploy-full"), "其余 deploy-full skip", r2.skipped);
}

// =================================================================
//  5. 战斗中（squad.enabled=true）禁止修改
// =================================================================
console.log("\n=== 5. squad.enabled（战斗中）禁止改 setLegionSquadSelection ===");
{
  const st = makeState();
  st.combat.squad.enabled = true;
  const beforeDep = st.combat.squad.deployables.length;
  const beforeNpc = st.combat.squad.pendingNpcIds.length;
  const r = LCS.setLegionSquadSelection(st, [depVal]);
  ok(r.changed === false && r.reason === "squad-locked", "锁状态下返回 squad-locked", r);
  ok(st.combat.squad.deployables.length === beforeDep, "deployables 未改");
  ok(st.combat.squad.pendingNpcIds.length === beforeNpc, "pendingNpcIds 未改");
}

// =================================================================
//  6. 双轨制：NPC select 路径不动 deployableStorage
// =================================================================
console.log("\n=== 6. 双轨制：virtual 路径不动 deployableStorage（工程制造线路独立） ===");
{
  const st = makeState();
  st.combat.squad.deployableStorage = [id]; // 模拟工程制造完成但未手动部署的一台
  const r = LCS.setLegionSquadSelection(st, [depVal]);
  ok(r.deployableIds.length === 1 && r.changed === true, "select 路径虚拟装备 1 台");
  ok(st.combat.squad.deployables.length === 1, "deployables=1");
  ok(st.combat.squad.deployableStorage.length === 1, "deployableStorage 保持原状（不被消耗）", st.combat.squad.deployableStorage);
  ok(st.combat.squad.deployableStorage[0] === id, "库存里还有这台");
  // 现在手动走 deployDeployable（既有路径）：尝试部署 → deploy-full（因为 virtual 占位）
  const r2 = LCS.deployDeployable(st, id);
  ok(r2.changed === false && r2.reason === "deploy-full", "手动路径 → deploy-full（virtual 占位不让位）", r2);
  ok(st.combat.squad.deployableStorage.length === 1, "deployableStorage 仍然不动");
}

// =================================================================
//  7. ui.selection 合并 deployable 前缀（NPC select 重渲依据）
// =================================================================
console.log("\n=== 7. getLegionCombatSquadUiState().selection 合并 NPC + deployable ===");
{
  const st = makeState({ nNpcs: 2 });
  // 直接注入 deployables
  st.combat.squad.deployables = [{ deployableId: id, name: "激光定向打捞单元" }];
  st.combat.squad.pendingNpcIds = ["npc_0"];
  const ui = LCS.getLegionCombatSquadUiState(st, { now: Date.now() });
  ok(Array.isArray(ui.selection), "ui.selection 是数组");
  ok(ui.selection.indexOf("npc_0") >= 0, "ui.selection 包含 npc_0", ui.selection);
  ok(ui.selection.indexOf(depVal) >= 0, "ui.selection 包含 deployable:<id>", ui.selection);
  ok(ui.deployables.length === 1 && ui.deployables[0].deployableId === id, "ui.deployables=[MTU]");
}

// =================================================================
//  8. ui.selection 在 deploy-only 状态下也能正确反映
// =================================================================
console.log("\n=== 8. ui.selection 仅 deployable ===");
{
  const st = makeState();
  st.combat.squad.deployables = [{ deployableId: id, name: "激光定向打捞单元" }];
  const ui = LCS.getLegionCombatSquadUiState(st, { now: Date.now() });
  ok(ui.selection.length === 1 && ui.selection[0] === depVal, "ui.selection = [deployable prefix]", ui.selection);
}

// =================================================================
//  9. NPC select 取消 deployable：UI 选中「— 选择 NPC —」 等同 selection 不含 deployable
// =================================================================
console.log("\n=== 9. 取消选中 deployable → setLegionSquadSelection 接收空 selection → 装备消失 ===");
{
  const st = makeState({ nNpcs: 1 });
  st.combat.squad.deployableStorage = [id];
  LCS.setLegionSquadSelection(st, [depVal]); // 装一台
  ok(st.combat.squad.deployables.length === 1, "已装");
  // UI 重置成「— 选择 NPC —」（value=""），表示该槽取消选择
  const r = LCS.setLegionSquadSelection(st, [""]);
  ok(r.changed === true, "空选也返回 changed=true");
  ok(st.combat.squad.deployables.length === 0, "deployables 清空");
}

// =================================================================
//  10. setLegionSquadSelection 与 startLegionSquadBattleWithMembers 兼容
// =================================================================
console.log("\n=== 10. 成员加入战斗：deployable 不参与 addLegionNpcToCombatSquad 循环 ===");
{
  const st = makeState({ nNpcs: 2, tripleUnlocked: true }); // cap=2，NPC 与 MTU 可共存
  st.combat.squad.deployableStorage = [id];
  LCS.setLegionSquadSelection(st, ["npc_0", depVal]);
  // pendingNpcIds 仍然只含 NPC，deployable 不进循环
  ok(st.combat.squad.pendingNpcIds.length === 1 && st.combat.squad.pendingNpcIds[0] === "npc_0", "pendingNpcIds 仅 NPC");
  // getLegionSquadSelection 返回的也不含 deployable 前缀
  const sel = LCS.getLegionSquadSelection(st);
  ok(sel.indexOf(depVal) < 0 && sel.length === 1 && sel[0] === "npc_0", "getLegionSquadSelection 不含 deployable（保证后续 NPC 战斗循环不读它）", sel);
}

// =================================================================
//  11. 与现有 MTU 核心机制不冲突：getMtuModifiers 在 select 路径装备后立刻 active
// =================================================================
console.log("\n=== 11. select 路径装备后 getMtuModifiers 立即生效 ===");
{
  const st = makeState();
  st.combat.squad.deployableStorage = [id];
  // 加些燃料
  sandbox.__s = st;
  // 已有 5000 fuel via state.resources
  const fuelRead = R("ResourceRegistry.get(__s, 'consumable:fuel')");
  const before = R("getMtuModifiers(__s)");
  ok(!before.active, "无 deployable 时 MTU 非 active");
  LCS.setLegionSquadSelection(st, [depVal]);
  const after = R("getMtuModifiers(__s)");
  ok(after.active === true, "select 装备后 MTU 即时激活", after);
  ok(after.salvage === 2.10 && after.iskBonus === 0.10 && after.lpBonus === 0.10, "增益 = 2.10 / 0.10 / 0.10");
}

// =================================================================
//  12. 容量满状态下尝试从 NPC 切到 MTU（displaced NPC + equip MTU）
// =================================================================
console.log("\n=== 12. 满员下切换 select 项：被顶替的 NPC 自动退出；新 MTU 加入 ===");
{
  const st = makeState({ nNpcs: 3, tripleUnlocked: true }); // cap=2，先装 2 NPC 再切 1 槽给 MTU
  // capacity=2，先装 2 NPC
  LCS.setLegionSquadSelection(st, ["npc_0", "npc_1"]);
  ok(st.combat.squad.pendingNpcIds.length === 2, "前置：2 NPC");
  st.combat.squad.deployableStorage = [id]; // 修正后：需先拥有
  // UI 把 slot 0 从 npc_0 切到 MTU（保留 slot 1 = npc_1）
  const r = LCS.setLegionSquadSelection(st, [depVal, "npc_1"]);
  ok(r.changed === true, "切槽位 changed=true");
  ok(st.combat.squad.pendingNpcIds.length === 1 && st.combat.squad.pendingNpcIds[0] === "npc_1", "npc_0 被顶替");
  ok(st.combat.squad.deployables.length === 1 && st.combat.squad.deployables[0].deployableId === id, "MTU 入队");
}

// =================================================================
//  12b. 拥有门控（修复后）：未制造/未拥有的 MTU 不可经下拉入队
// =================================================================
console.log("\n=== 12b. 拥有门控：未拥有 MTU 下拉选入被拒（not-owned） ===");
{
  const st = makeState(); // 空 deployableStorage / 空 deployables
  const r = LCS.setLegionSquadSelection(st, [depVal]);
  ok(r.changed === true, "返回 changed=true（NPC 选择仍处理，仅 MTU 被拒）");
  ok(st.combat.squad.deployables.length === 0, "未拥有时 deployables 不被写入（漏洞已堵）", st.combat.squad.deployables);
  ok(Array.isArray(r.skipped) && r.skipped.some(x => x.kind === "deployable" && x.reason === "not-owned"), "skipped 含 not-owned", r.skipped);
  // 已部署（生效中）也不算 not-owned：注入 deployables 后重选应保持
  st.combat.squad.deployables = [{ deployableId: id, name: "激光定向打捞单元" }];
  const r2 = LCS.setLegionSquadSelection(st, [depVal]);
  ok(st.combat.squad.deployables.length === 1 && !r2.skipped.some(x => x.reason === "not-owned"), "已部署项重选不报 not-owned", st.combat.squad.deployables);
}

// =================================================================
//  13. MTU_DEPLOYABLE_PREFIX 常量暴露
// =================================================================
console.log("\n=== 13. MTU_DEPLOYABLE_PREFIX 常量对外暴露 ===");
{
  ok(LCS.MTU_DEPLOYABLE_PREFIX === "deployable:", "前缀字符串 === \"deployable:\"", LCS.MTU_DEPLOYABLE_PREFIX);
  ok(LCS.MTU_MAX_DEPLOYED === 1, "MTU_MAX_DEPLOYED === 1", LCS.MTU_MAX_DEPLOYED);
}

console.log("\n结果: " + passed + " 通过 / " + failed + " 失败");
if (failed > 0) {
  console.log("\n失败明细:");
  for (const line of failMessages) console.log(line);
  process.exit(1);
}
