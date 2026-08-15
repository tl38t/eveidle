// 机器测试：P1-4 冲突选择浮层（js/core/bootstrap-launch.js showConflictChoice）UI 行为验收。
//
// 目标（决定·六 / P1-4）：
//   1) 浮层含本地/云端存档明细（时间/游玩/技能/舰船/资产）+ 导出本地/云端备份按钮 + 选择按钮 + 错误提示。
//   2) 点击选择 → 按钮禁用 + 显示「处理中」；仅在 resolve 成功后才移除遮罩。
//   3) resolve 失败 → 恢复按钮、显示错误、遮罩保留（不静默覆盖）。
//   4) Escape 被捕获并 preventDefault（绝不静默关闭）；无 backdrop 关闭逻辑。
//   5) 导出按钮：真实点击后显示「已导出 ✓」。
//
// 本测试以可控 DOM 桩在 vm 中加载 bootstrap-launch.js（不触发 launch()），
// 通过 bootstatechange 监听回调手动驱动 showConflictChoice，再模拟点击与键盘事件。
//
// 用法：node tools/test-conflict-popup.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");

let failures = 0;
function ok(cond, label) {
  if (cond) console.log("  PASS  " + label);
  else { console.log("  FAIL  " + label); failures++; }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---- 可控 DOM 桩：真实节点树，记录子节点 / 监听 / 文本 ----
function makeNode(tag) {
  const node = {
    tagName: tag, id: "", children: [], parentNode: null,
    attributes: {}, _listeners: {}, _text: "", disabled: false, style: {}, title: "", className: "",
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
    removeEventListener(t, f) { if (this._listeners[t]) this._listeners[t] = this._listeners[t].filter((x) => x !== f); },
    focus() {}, click() { (this._listeners.click || []).forEach((f) => f({})); },
    set textContent(v) { this._text = String(v); }, get textContent() { return this._text; },
    querySelector() { return null; }
  };
  return node;
}
function searchById(node, id) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    if (c.id === id) return c;
    const r = searchById(c, id);
    if (r) return r;
  }
  return null;
}
function searchByText(node, text) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    if (c._text === text) return c;
    const r = searchByText(c, text);
    if (r) return r;
  }
  return null;
}
function allButtons(node, acc) {
  acc = acc || [];
  if (!node || !node.children) return acc;
  for (const c of node.children) {
    if (c.tagName === "button") acc.push(c);
    allButtons(c, acc);
  }
  return acc;
}

function buildContext() {
  const docListeners = {};
  const body = makeNode("body");
  const document = {
    readyState: "loading", // 阻止 bootstrap-launch 自动 launch()
    body,
    _created: [],
    createElement(tag) { const n = makeNode(tag); document._created.push(n); return n; },
    getElementById(id) { return searchById(body, id); },
    addEventListener(t, f, cap) { (docListeners[t] = docListeners[t] || []).push({ f, cap }); },
    removeEventListener(t, f) {
      if (docListeners[t]) docListeners[t] = docListeners[t].filter((x) => x.f !== f);
    },
    dispatchKey(type, ev) { (docListeners[type] || []).forEach((x) => x.f(ev)); }
  };

  const winListeners = {};
  const ctx = {
    console, Date, JSON, Math, Promise, Object, Array, String, Number, Boolean,
    isFinite, Error, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
    Blob: function () {}, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    document,
    alert() {}
  };
  ctx.window = ctx;
  ctx.addEventListener = (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); };
  ctx.dispatchBootState = (state) => { (winListeners["bootstatechange"] || []).forEach((f) => f({ detail: { state } })); };

  // 可控 SaveManager：resolveCloudConflict 行为由测试注入；_pendingCloudEnvelope 提供云端摘要来源。
  let _resolveMode = "success";
  ctx.SaveManager = {
    _pendingCloudEnvelope: {
      status: "ok",
      meta: { slotName: "auto_save", archiveId: "arch_1", updatedAt: 1700000000000 },
      envelope: { checksum: "cloud-xyz", savedAt: 1700000000000, payload: { skills: { mining: { lvl: 5 }, refining: { lvl: 3 } }, resources: { isk: 42000, minerals: { "凡晶石": 12, "灼烧岩": 5 } }, inventory: { ships: [{ shipId: "rifter" }] }, statistics: { lifecycle: { onlineSeconds: 3661 } } } }
    },
    resolveCloudConflict(choice) {
      if (_resolveMode === "success") return Promise.resolve(true);
      if (_resolveMode === "fail") return Promise.reject(new Error("injected resolve failure"));
      return Promise.resolve(false);
    },
    _setResolveMode(m) { _resolveMode = m; }
  };

  ctx.gameState = {
    lastSaveTime: 1699990000000,
    skills: { mining: { lvl: 4 }, refining: { lvl: 2 }, gasHarvesting: { lvl: 1 } },
    resources: { isk: 88000, minerals: { "凡晶石": 30, "灼烧岩": 9, "三钛合金": 0 } },
    inventory: { ships: [{ shipId: "rifter" }, { shipId: "miner_frigate" }] },
    statistics: { lifecycle: { onlineSeconds: 7200 } }
  };

  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(repo, "js/core/bootstrap-launch.js"), "utf8"), ctx, { filename: "js/core/bootstrap-launch.js" });
  return { ctx, document, body, SaveManager: ctx.SaveManager };
}

// ===================== P1-4 验收 =====================
console.log("[P1-4] 冲突浮层结构 + 行为验收");
{
  const { ctx, document, body, SaveManager } = buildContext();
  // 通过 bootstatechange → awaiting-choice 驱动 showConflictChoice
  ctx.dispatchBootState("awaiting-choice");

  const overlay = document.getElementById("boot-conflict-choice");
  ok(!!overlay, "awaiting-choice 触发后浮层已创建（id=boot-conflict-choice）");

  const localSec = searchByText(overlay, "本地存档");
  const cloudSec = searchByText(overlay, "云端存档");
  ok(!!localSec, "明细含「本地存档」区块");
  ok(!!cloudSec, "明细含「云端存档」区块");

  const errNote = document.getElementById("boot-conflict-error");
  ok(!!errNote, "含错误提示节点（id=boot-conflict-error）");

  const buttons = allButtons(overlay, []);
  const expLocal = buttons.find((b) => (b._text || "").indexOf("导出本地备份") === 0);
  const expCloud = buttons.find((b) => (b._text || "").indexOf("导出云端备份") === 0);
  const useLocal = buttons.find((b) => (b._text || "").indexOf("使用本地存档") === 0);
  const useCloud = buttons.find((b) => (b._text || "").indexOf("使用云端存档") === 0);
  ok(!!expLocal, "含「导出本地备份」按钮");
  ok(!!expCloud, "含「导出云端备份」按钮");
  ok(!!useLocal && !!useCloud, "含「使用本地存档」「使用云端存档」选择按钮");

  // ---- 5) 导出本地备份：点击后显示「已导出 ✓」 ----
  expLocal.click();
  ok((expLocal._text || "").indexOf("已导出") !== -1, "点击导出本地备份 → 显示「已导出」");

  // ---- 4) Escape 被 preventDefault（不静默关闭） ----
  let escapePrevented = false;
  document.dispatchKey("keydown", { key: "Escape", preventDefault() { escapePrevented = true; }, stopPropagation() {} });
  ok(escapePrevented === true, "Escape 键被捕获并 preventDefault（浮层不会因 Escape 关闭）");
  ok(!!document.getElementById("boot-conflict-choice"), "Escape 后浮层仍存在（未关闭）");

  // ---- 2) 成功路径：点击选择 → 禁用+处理中 → 成功移除遮罩 ----
  SaveManager._setResolveMode("success");
  useLocal.click();
  ok(useLocal.disabled === true, "点击后「使用本地存档」按钮被禁用");
  ok((useLocal._text || "").indexOf("处理中") !== -1, "点击后按钮显示「处理中…」");
  await flush();
  ok(!document.getElementById("boot-conflict-choice"), "resolve 成功后遮罩被移除（hideConflictChoice）");

  // ---- 3) 失败路径：点击选择 → 失败恢复按钮 + 显示错误 + 遮罩保留 ----
  ctx.dispatchBootState("awaiting-choice"); // 重新弹出（上一次已被移除）
  const overlay2 = document.getElementById("boot-conflict-choice");
  const useLocal2 = allButtons(overlay2, []).find((b) => (b._text || "").indexOf("使用本地存档") === 0);
  SaveManager._setResolveMode("fail");
  useLocal2.click();
  ok(useLocal2.disabled === true, "失败路径：点击后按钮先被禁用");
  await flush();
  ok(useLocal2.disabled === false, "resolve 失败后按钮已恢复（重新可用）");
  ok((useLocal2._text || "").indexOf("使用本地存档") !== -1 && (useLocal2._text || "").indexOf("处理中") === -1, "失败后按钮文案恢复为「使用本地存档」");
  const errNote2 = document.getElementById("boot-conflict-error");
  ok(!!errNote2 && (errNote2._text || "").indexOf("处理失败") !== -1, "失败后错误提示已显示（处理失败…）");
  ok(!!document.getElementById("boot-conflict-choice"), "失败后遮罩保留（不静默覆盖、保持阻塞重试）");
}

console.log("\n" + (failures === 0 ? "测试通过 (0 失败)" : ("测试失败 (" + failures + " 失败)")));
process.exit(failures === 0 ? 0 : 1);
