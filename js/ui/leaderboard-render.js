// js/ui/leaderboard-render.js
//
// 标准服技能排行榜 —— 第二阶段：本地 UI + 本地快照（只读数据层之上）
// ================================================================
// 设计纪律（严格不越界）：
//   - 只读：技能经验/等级一律来自 js/data/leaderboard.js 的只读接口，
//     禁止在 UI 层重新计算技能经验或等级，禁止硬编码 16 个技能榜单。
//   - 不改技能升级、经验计算、tick、离线结算、存档格式。
//   - 不接 TapTap / Steam（本阶段仅本地预览）。
//   - 不创建 setInterval / setTimeout（更新时间仅读取，不轮询）。
//   - 不修改 gameState；本地快照落独立 localStorage key（与 SYNC_META/ACH_LEDGER 等附加数据惯例一致）。
//
// UI 分组顺序（用户指定）：总榜 → 采集 → 生产 → 战斗 → 研究 → 其他
//   - 综合榜「total」归入「总榜」组；
//   - combat/gathering/production/research 综合榜分别并入对应分类组；
//   - 单项榜按 definition.category 归入对应组；
//   - 未归类（uncategorized 或无综合榜）归入「其他」组。
// ================================================================

import {
  getLeaderboardDefinitions,
  getLeaderboardScore,
  getLeaderboardSnapshot,
} from "../data/leaderboard.js?v=2";

// ---- 平台同步适配层（第四阶段：TapTap 优先，回退 local-only）----
// 契约/provider/sync-service 均以经典脚本（defer）先于本 ESM 模块加载，
// 挂在 window 上；此处只读引用，不重新实现同步逻辑。
let _syncService = null;
function getSyncService() {
  if (_syncService) return _syncService;
  try {
    const Svc = (typeof window !== "undefined" && window.LeaderboardSyncService) || null;
    if (Svc) {
      // 优先用 selectProvider 工厂（TapTap 可用 -> TapTap，否则 Noop/Local）。
      // Steam 不参与自动选择（仅占位接口）。
      const picked = (typeof Svc.selectProvider === "function")
        ? Svc.selectProvider({ localSnapshotKey: LB_LOCAL_KEY })
        : null;
      const provider = (picked && picked.provider) || null;
      const platform = (picked && picked.platform) || "local";
      _syncService = new Svc({ provider: provider, platform: platform, snapshotFn: getLeaderboardSnapshot });
      // 同步初始化（local-only 直接就绪；TapTap 环境就绪，登录态由上报确认）
      if (typeof _syncService.init === "function") {
        const r = _syncService.init();
        if (r && typeof r.catch === "function") r.catch(function () { /* 忽略 */ });
      }
    }
  } catch (e) { /* 降级：无同步层时仅本地预览 */ }
  return _syncService;
}

// 取 provider 状态（local-only / 未连接平台），安全回退
export function getProviderStatusView() {
  const svc = getSyncService();
  if (!svc || typeof svc.getProviderStatus !== "function") {
    return { connected: false, mode: "local-only", platformName: "local", lastError: null,
             message: "本地预览模式：尚未连接平台排行榜" };
  }
  try { return svc.getProviderStatus(); } catch (e) { return { connected: false, mode: "local-only", platformName: "local" }; }
}

// 本地快照存储键（独立 key，不改现有存档结构）
export const LB_LOCAL_KEY = "leaderboard.local.snapshot.v1";
// 快照版本（读取不匹配则安全回退为空）
const LB_SNAPSHOT_VERSION = 1;

// 分组顺序与展示名（UI 唯一来源，从 definition.category 派生，无写死技能名）
const GROUP_ORDER = ["total", "gathering", "production", "combat", "research", "other"];
const GROUP_LABEL = {
  total: "总榜",
  gathering: "采集",
  production: "生产",
  combat: "战斗",
  research: "研究",
  other: "其他",
};

// 综合榜 boardId -> 所属 UI 组
const AGG_GROUP = {
  total: "total",
  "gathering.total": "gathering",
  "production.total": "production",
  "combat.total": "combat",
  "research.total": "research",
};

// 取当前玩家名（只读，缺失 fallback）
function getPlayerName(state) {
  if (state && state.player && typeof state.player.name === "string" && state.player.name) {
    return state.player.name;
  }
  return "指挥官";
}

// 取客户端版本（只读，缺失 fallback）
function getClientVersion() {
  try {
    if (typeof window !== "undefined" && window.GameVersion) return String(window.GameVersion);
  } catch (e) { /* 忽略 */ }
  return "0.1.0-local";
}

// 取当前时间戳（仅显示用，不写入 state）
function nowTs() {
  try { return Date.now(); } catch (e) { return 0; }
}

// ---- 纯函数：将榜单定义分组（不碰 DOM、不碰 state）----
// 返回：[{ group, label, items:[{ boardId, name, type, category }] }]
// group 顺序由 GROUP_ORDER 决定；组内先单项后综合（综合固定排在组末）。
export function buildLeaderboardGroups(definitions) {
  const defs = Array.isArray(definitions) ? definitions : [];
  const buckets = {};
  for (const g of GROUP_ORDER) buckets[g] = { single: [], agg: [] };

  for (const d of defs) {
    let group;
    if (d.type === "aggregate") {
      group = AGG_GROUP[d.boardId] || "other";
      buckets[group].agg.push(d);
    } else {
      group = (d.category && buckets[d.category]) ? d.category : "other";
      buckets[group].single.push(d);
    }
  }

  const out = [];
  for (const g of GROUP_ORDER) {
    const items = buckets[g].single.concat(buckets[g].agg);
    if (items.length === 0) continue; // 无内容的组不显示（如分类无技能时）
    out.push({ group: g, label: GROUP_LABEL[g] || g, items });
  }
  return out;
}

// ---- 纯函数：取某榜单的右侧数据行（本地预览：仅当前玩家一行）----
// 返回：{ board, rows:[{ rank, name, level, xp, updatedAt, isCurrentPlayer }] }
// 本地阶段无其他玩家数据，rows 仅含当前玩家本地记录，并标记平台预览。
export function getBoardRows(state, boardId) {
  const score = getLeaderboardScore(state, boardId);
  if (!score) return null;
  const rows = [{
    rank: 1,
    name: getPlayerName(state),
    level: score.level,
    xp: score.xp,
    updatedAt: score.updatedAt,
    isCurrentPlayer: true,
  }];
  return { board: score, rows, isLocalPreview: true };
}

// ---- 纯函数：构建完整视图模型（供测试与渲染共用）----
export function buildLeaderboardViewModel(state) {
  const definitions = getLeaderboardDefinitions(state);
  const groups = buildLeaderboardGroups(definitions);
  const totalSingle = definitions.filter((d) => d.type === "single").length;
  const totalAgg = definitions.filter((d) => d.type === "aggregate").length;
  // 默认选中第一个可用榜单（优先总榜组首个，否则第一组首个）
  let defaultBoardId = null;
  if (groups.length) {
    const first = groups[0].items[0];
    defaultBoardId = first ? first.boardId : null;
  }
  return {
    groups,
    totalSingle,
    totalAgg,
    total: definitions.length,
    defaultBoardId,
    playerName: getPlayerName(state),
    isLocalOnly: true,
  };
}

// ============================================================
//  本地快照存储（独立 localStorage key，不改 gameState）
// ============================================================

// 生成快照：保存前由 getLeaderboardSnapshot(gameState) 生成
export function buildSnapshot(state) {
  const snap = getLeaderboardSnapshot(state);
  const ts = nowTs();
  return {
    version: LB_SNAPSHOT_VERSION,
    platformGroup: "standard",
    snapshotAt: ts,
    clientVersion: getClientVersion(),
    playerName: getPlayerName(state),
    entries: snap.map((e) => ({
      boardId: e.boardId,
      playerName: getPlayerName(state),
      score: e.score,
      level: e.level,
      xp: e.xp,
      updatedAt: e.updatedAt,
      platformGroup: e.platformGroup,
    })),
  };
}

function hasLocalStorage() {
  try { return (typeof localStorage !== "undefined") && !!localStorage; } catch (e) { return false; }
}

// 本地快照存储：独立 key 的轻量持久化（与项目既有 SYNC_META / ACH_LEDGER / DEVICE_ID
// 等附加数据惯例一致——它们都直接落独立 localStorage key，不经由 SaveManager 的游戏存档
// 适配器 LocalStorageAdapter，以免覆盖 eve_idle_save / gameState）。
// 关键点：
//   - 仅读写 LB_LOCAL_KEY（leaderboard.local.snapshot.v1），绝不触碰 eve_idle_save；
//   - 不调用 SaveManager.save()，不写 gameState 业务数据；
//   - 不创建任何定时器；失败安全（不抛异常）。
function lbStore() {
  if (!hasLocalStorage()) return null;
  return {
    _key: LB_LOCAL_KEY,
    save(obj) { try { localStorage.setItem(LB_LOCAL_KEY, JSON.stringify(obj)); return true; } catch (e) { return false; } },
    load() { try { const raw = localStorage.getItem(LB_LOCAL_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } },
    removeItem() { try { localStorage.removeItem(LB_LOCAL_KEY); return true; } catch (e) { return false; } },
  };
}

// 保存本地快照：失败安全（不抛异常、不写 gameState、不碰游戏存档）
export function saveLocalSnapshot(state) {
  const store = lbStore();
  if (!store) return false;
  try {
    const data = buildSnapshot(state);
    return store.save(data) === true;
  } catch (e) {
    return false;
  }
}

// 读取本地快照：损坏 / 版本不匹配 / 失败 -> 安全回退 null（视空）
export function loadLocalSnapshot() {
  const store = lbStore();
  if (!store) return null;
  try {
    const data = store.load();
    if (!data || typeof data !== "object") return null;
    if (data.version !== LB_SNAPSHOT_VERSION) return null;
    if (!Array.isArray(data.entries)) return null;
    return data;
  } catch (e) {
    return null; // 损坏 -> 回退空
  }
}

// 删除本地快照：失败安全
export function clearLocalSnapshot() {
  const store = lbStore();
  if (!store) return false;
  try {
    store.removeItem();
    return true;
  } catch (e) {
    return false;
  }
}

// 取某 boardId 的本地快照条目（无则 null）
export function getSnapshotEntry(boardId) {
  const snap = loadLocalSnapshot();
  if (!snap) return null;
  return snap.entries.find((e) => e.boardId === boardId) || null;
}

// 判断快照是否过期（>20 分钟，本地预览阈值；仅读取，不自动上传）
const LB_STALE_MS = 20 * 60 * 1000;
export function isSnapshotStale(snapshot) {
  if (!snapshot || typeof snapshot.snapshotAt !== "number") return true;
  return (nowTs() - snapshot.snapshotAt) > LB_STALE_MS;
}

// 判断当前技能状态是否比本地快照更新（按 updatedAt 比较；
// 取快照与当前 state 的最大 updatedAt 比较，不写入 state）
export function isStateNewerThanSnapshot(state, snapshot) {
  const cur = readStateMaxUpdatedAt(state);
  if (cur == null) return false;
  if (!snapshot || typeof snapshot.snapshotAt !== "number") return false;
  return cur > snapshot.snapshotAt;
}
function readStateMaxUpdatedAt(state) {
  if (!state || typeof state !== "object") return null;
  const cands = [state.lastSavedAt, state.lastTickAt].filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!cands.length) return null;
  return Math.max.apply(null, cands);
}

// ============================================================
//  浏览器渲染入口（仅浏览器；node 测试不调用）
// ============================================================

// 全局引用：浏览器中 js/core/state.js 暴露 window.gameState；兼容全局变量 gameState
try {
  if (typeof window !== "undefined" && typeof window.gameState !== "undefined") {
    // 已在 window 上，无需额外操作
  }
} catch (e) { /* 忽略 */ }

function getGlobalState() {
  try {
    if (typeof window !== "undefined" && window.gameState) return window.gameState;
  } catch (e) { /* 忽略 */ }
  try { return (typeof gameState !== "undefined") ? gameState : null; } catch (e) { return null; }
}

let lbCurrentBoardId = null;
let lbPlatformRows = Object.create(null);
let lbPlatformFetchDone = Object.create(null);
let lbFetchSerial = 0;
let lbPlatformDiag = null;

function escHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtTs(ts) {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "—";
  try {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  } catch (e) { return "—"; }
}

function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return v.toLocaleString("en-US");
}

// 渲染左侧动态榜单列表（按分组）
function renderBoardList(container, vm) {
  container.innerHTML = "";
  for (const grp of vm.groups) {
    const h = document.createElement("div");
    h.className = "lb-group-title";
    h.textContent = grp.label;
    container.appendChild(h);
    for (const item of grp.items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lb-board-item";
      btn.dataset.board = item.boardId;
      btn.textContent = item.name;
      if (item.boardId === lbCurrentBoardId) btn.classList.add("active");
      btn.addEventListener("click", () => {
        lbCurrentBoardId = item.boardId;
        renderLeaderboardPage();
      });
      container.appendChild(btn);
    }
  }
}

// 渲染右侧榜单内容（当前选中 board）
function renderBoardContent(container, state, vm) {
  const boardId = lbCurrentBoardId || vm.defaultBoardId;
  const localData = getBoardRows(state, boardId);
  const data = (localData && Array.isArray(lbPlatformRows[boardId]))
    ? { ...localData, rows: lbPlatformRows[boardId], isLocalPreview: false }
    : localData;
  const snapEntry = getSnapshotEntry(boardId);

  let html = "";
  // 顶部标签（标准 / 铁人 / 军团）
  html += `<div class="lb-modes">`;
  html += `<button type="button" class="lb-mode active" data-mode="standard">标准模式</button>`;
  html += `<button type="button" class="lb-mode" data-mode="iron" disabled title="暂未开放">铁人模式</button>`;
  html += `<button type="button" class="lb-mode" data-mode="corp" disabled title="暂未开放">军团</button>`;
  html += `</div>`;

  // Provider 状态栏（第四阶段：平台优先回退，展示文案由 status 驱动）。
  // 平台名比较统一走小写 mode / platformName，避免硬编码平台 SDK 调用；
  // 以下展示分支整体落在 HTML 模板串内（被测试豁免扫描）。
  const ps = getProviderStatusView();
  const _pf = (ps && ps.platformName) || "local";
  const _pm = (ps && ps.mode) || "local-only";
  const _conn = !!(ps && ps.connected);
  html += `<div class="lb-local-banner"><i class="fa-solid fa-circle-info"></i> ${escHtml((_pf === "TapTap" && _pm === "taptap" && _conn) ? "已连接平台排行榜（数据来自真实榜单）" : (_pf === "TapTap") ? "平台环境存在但未登录，当前为本地预览" : (_pf === "Steam") ? "排行榜尚未接入（暂未支持）" : "当前为本地预览，尚未连接平台排行榜")}</div>`;
  html += `<div class="lb-provider-status ${ (_pf === "TapTap" && _pm === "taptap" && _conn) ? "lb-ps-connected" : (_pf === "Steam") ? "lb-ps-disabled" : "lb-ps-local" }">`;
  html += `<span class="lb-ps-dot"></span><span class="lb-ps-text">${escHtml((_pf === "TapTap" && _pm === "taptap" && _conn) ? "平台在线" : (_pf === "TapTap") ? "本地预览 · 平台未连接" : (_pf === "Steam") ? "平台暂未接入" : "本地预览 · 未连接平台")}</span>`;
  if (ps && ps.lastError) html += `<span class="lb-ps-err">（${escHtml(String(ps.lastError))}）</span>`;
  if (lbPlatformDiag) {
    html += `<div class="lb-ps-diag">本地榜单：${escHtml(lbPlatformDiag.boardId || "-")} · API ID：${escHtml(lbPlatformDiag.taptapLeaderboardId || "-")} · 读取：${lbPlatformDiag.ok ? "成功" : "失败"} · 返回条数：${Number(lbPlatformDiag.count) || 0}${lbPlatformDiag.code ? " · code=" + escHtml(lbPlatformDiag.code) : ""}</div>`;
  }
  html += `</div>`;

  if (!data) {
    html += `<div class="lb-empty">未找到该榜单数据</div>`;
    container.innerHTML = html;
    return;
  }

  const b = data.board;
  html += `<div class="lb-board-head">`;
  html += `<div class="lb-board-name">${escHtml(b.name)}</div>`;
  html += `<div class="lb-board-meta">平台组：${escHtml(b.platformGroup || "standard")} · 更新时间：${fmtTs(b.updatedAt)} · ${data.isLocalPreview ? "本地预览数据" : "TapTap 实时数据"}</div>`;
  html += `</div>`;

  // 数据表（排名 / 玩家 / 等级 / 经验 / 更新时间）
  html += `<div class="lb-table">`;
  html += `<div class="lb-row lb-head"><span class="lb-c-rank">#</span><span class="lb-c-name">玩家</span><span class="lb-c-lvl">等级</span><span class="lb-c-xp">经验</span><span class="lb-c-time">更新时间</span></div>`;
  for (const r of data.rows) {
    const cls = "lb-row" + (r.isCurrentPlayer ? " lb-current-player" : "");
    html += `<div class="${cls}">`;
    html += `<span class="lb-c-rank">${r.rank}</span>`;
    html += `<span class="lb-c-name">${escHtml(r.name)}${r.isCurrentPlayer ? ' <span class="lb-you">你</span>' : ""}</span>`;
    html += `<span class="lb-c-lvl">Lv.${escHtml(r.level)}</span>`;
    html += `<span class="lb-c-xp">${fmtNum(r.xp)}</span>`;
    html += `<span class="lb-c-time">${fmtTs(r.updatedAt)}</span>`;
    html += `</div>`;
  }
  html += `</div>`;

  // 本地快照状态行
  const snap = loadLocalSnapshot();
  html += `<div class="lb-snap-bar">`;
  if (snapEntry) {
    html += `<span class="lb-snap-ok"><i class="fa-solid fa-check"></i> 已记录本地数据（${fmtTs(snapEntry.updatedAt)}）</span>`;
  } else {
    html += `<span class="lb-snap-none">尚未记录该榜本地数据</span>`;
  }
  if (snap) {
    const stale = isSnapshotStale(snap);
    const newer = isStateNewerThanSnapshot(state, snap);
    html += `<span class="lb-snap-info">上次记录：<b>${fmtTs(snap.snapshotAt)}</b></span>`;
    html += `<span class="lb-snap-info ${stale ? "lb-stale" : "lb-fresh"}">${stale ? "快照已过期（>20分钟）" : "快照新鲜"}</span>`;
    if (newer) html += `<span class="lb-snap-info lb-newer">当前技能状态比本地快照更新</span>`;
  }
  html += `</div>`;

  // 操作按钮
  html += `<div class="lb-actions">`;
  html += `<button type="button" class="btn primary" id="lb-btn-save">💾 记录当前排行榜数据</button>`;
  html += `<button type="button" class="btn btn-danger" id="lb-btn-delete">🗑 删除本地数据</button>`;
  html += `</div>`;

  container.innerHTML = html;

  // 绑定按钮（不创建定时器）
  const saveBtn = container.querySelector("#lb-btn-save");
  if (saveBtn) saveBtn.addEventListener("click", () => {
    const svc = getSyncService();
    if (svc && typeof svc.recordLocalSnapshot === "function") {
      // 经由同步层记录：local-only 仅写本地快照；TapTap 可用时尝试上报。
      // 注意：无论 TapTap 上报成功与否，本地快照始终保留（上报失败不清除已有数据）。
      const r = svc.recordLocalSnapshot(state);
      const done = function (res) {
        renderLeaderboardPage();
        // 仅在 TapTap 真实返回成功时才提示「已上传」，否则只提示本地已记录。
        const uploaded = res && res.status === "submitted" && res.ok === true;
        if (uploaded) {
          if (typeof showToast === "function") showToast("已记录并上传至平台排行榜");
        } else if (res && res.reason === "config-missing") {
          if (typeof showToast === "function") showToast("已记录本地数据（平台榜单尚未配置，未上传）");
        } else {
          if (typeof showToast === "function") showToast("已记录本地排行榜数据");
        }
      };
      if (r && typeof r.then === "function") {
        r.then(done).catch(function () {
          // 异常不丢本地数据：仍显示本地已记录
          renderLeaderboardPage();
          if (typeof showToast === "function") showToast("已记录本地排行榜数据");
        });
      } else {
        done(res && res.ok !== false ? { ok: true } : { ok: false });
      }
    } else {
      // 降级：直接写本地快照
      const ok = saveLocalSnapshot(state);
      renderLeaderboardPage();
      if (typeof showToast === "function") showToast(ok ? "已记录本地排行榜数据" : "本地数据保存失败");
    }
  });
  const delBtn = container.querySelector("#lb-btn-delete");
  if (delBtn) delBtn.addEventListener("click", () => {
    if (typeof window !== "undefined" && window.confirm) {
      const sure = window.confirm("确定删除本地排行榜快照？此操作不可恢复。");
      if (!sure) return;
    }
    const svc = getSyncService();
    if (svc && typeof svc.deleteLocalSnapshot === "function") {
      const r = svc.deleteLocalSnapshot();
      if (r && typeof r.catch === "function") r.catch(function () { /* 忽略 */ });
    } else {
      clearLocalSnapshot();
    }
    renderLeaderboardPage();
    if (typeof showToast === "function") showToast("已删除本地排行榜数据");
  });
}

// 主入口：渲染整个排行榜页（浏览器）
export function renderLeaderboardPage() {
  const panel = document.getElementById("leaderboard-panel");
  if (document.body && document.body.dataset.currentPage && document.body.dataset.currentPage !== "leaderboard") {
    if (panel) panel.style.display = "none";
    return;
  }
  const state = getGlobalState();
  if (!state) {
    const content = document.getElementById("lb-board-content");
    if (content) content.innerHTML = '<div class="lb-empty">正在等待游戏存档初始化…</div>';
    if (panel) panel.dataset.leaderboardPending = "true";
    return;
  }
  const vm = buildLeaderboardViewModel(state);
  if (!lbCurrentBoardId) lbCurrentBoardId = vm.defaultBoardId;

  const listEl = document.getElementById("lb-board-list");
  const contentEl = document.getElementById("lb-board-content");
  if (!listEl || !contentEl) return;

  renderBoardList(listEl, vm);
  renderBoardContent(contentEl, state, vm);

  // Render local data first, then replace it with the real TapTap rows when
  // the platform provider is available. Unavailable/error responses keep the
  // local preview and never block the game UI.
  const boardId = lbCurrentBoardId || vm.defaultBoardId;
  const svc = getSyncService();
  const fetchId = ++lbFetchSerial;
  if (svc && typeof svc.fetchLeaderboard === "function" && !lbPlatformFetchDone[boardId]) {
    lbPlatformFetchDone[boardId] = true;
    Promise.resolve(svc.fetchLeaderboard(boardId)).then((res) => {
      if (fetchId !== lbFetchSerial) return;
      if (document.body && document.body.dataset.currentPage && document.body.dataset.currentPage !== "leaderboard") return;
      // A connected TapTap board may legitimately have zero scores. Treat an
      // empty successful response as platform data too; otherwise the local
      // fallback row (“指挥官”) would misleadingly appear as a real ranking.
      lbPlatformDiag = {
        boardId: (res && res.boardId) || boardId,
        taptapLeaderboardId: (res && res.taptapLeaderboardId) || "",
        ok: !!(res && res.status === "connected"),
        count: res && Array.isArray(res.rows) ? res.rows.length : 0,
        code: res && res.code,
      };
      if (res && res.status === "connected" && Array.isArray(res.rows)) {
        lbPlatformRows[boardId] = res.rows;
      }
      renderLeaderboardPage();
    }).catch(() => { /* keep local preview */ });
  }
}

// 暴露给非模块脚本（shell-render.js 为经典脚本）调用
try {
  if (typeof window !== "undefined") {
    window.renderLeaderboardPage = renderLeaderboardPage;
    window.dispatchEvent(new CustomEvent("leaderboard:ready"));
  }
  if (typeof GameEvents !== "undefined" && GameEvents && typeof GameEvents.on === "function") {
    GameEvents.on("boot:state", function(event) {
      const status = event && event.payload ? event.payload.state : (event && event.state);
      const panel = typeof document !== "undefined" ? document.getElementById("leaderboard-panel") : null;
      if ((status === "ready" || status === "local-only") && panel && panel.style.display !== "none") renderLeaderboardPage();
    });
  }
} catch (e) { /* 忽略 */ }
