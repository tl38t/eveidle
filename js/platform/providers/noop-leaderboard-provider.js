/* ================================================================
   NoopLeaderboardProvider — 无平台排行榜同步的本地模式

   普通浏览器 / 未来 Steam 未接入时，排行榜完全由本地快照驱动，
   不向任何平台上报、不访问网络、不依赖 TapTap / Steam / Electron。

   职责边界（严格不越界）：
   - 只读：从 js/ui/leaderboard-render.js 写入的独立 localStorage key
     （leaderboard.local.snapshot.v1）读取本地快照；不写该 key。
   - 不修改 state / gameState / eve_idle_save / skills。
   - 不创建 setInterval / setTimeout。
   - 所有方法安全 no-op / 本地回显，失败结构化返回，绝不抛未处理异常。
   - getProviderStatus 明确返回 mode:"local-only"，供 UI 显示「本地预览 / 未连接平台」。

   复用约定：与项目既有 SYNC_META_KEY / ACH_LEDGER_KEY / DEVICE_ID_KEY 等
   附加数据惯例一致 —— 直接读独立 localStorage key，不经由 SaveManager。
   ================================================================ */
(function (root) {
  "use strict";

  // 与 js/ui/leaderboard-render.js 共享的本地快照 key（独立 key，不改游戏存档）。
  const LB_LOCAL_KEY = "leaderboard.local.snapshot.v1";
  const LB_SNAPSHOT_VERSION = 1;

  function hasLocalStorage() {
    try { return (typeof localStorage !== "undefined") && !!localStorage; } catch (e) { return false; }
  }

  // 只读读取本地快照（不写、不修改 gameState）。
  function readLocalSnapshot() {
    if (!hasLocalStorage()) return null;
    try {
      const raw = localStorage.getItem(LB_LOCAL_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return null;
      if (data.version !== LB_SNAPSHOT_VERSION) return null;
      if (!Array.isArray(data.entries)) return null;
      return data;
    } catch (e) {
      return null; // 损坏 -> 安全回退
    }
  }

  function NoopLeaderboardProvider() {
    this._lastError = null;
    this._mode = "local-only";
  }

  NoopLeaderboardProvider.prototype.isAvailable = function () { return false; };

  NoopLeaderboardProvider.prototype.initialize = function () {
    // 本地模式无需异步初始化，直接就绪。
    return Promise.resolve(false);
  };

  // 提交快照：本地模式不向任何平台上报，仅将传入的快照写入独立 localStorage key。
  // snapshot 由 js/data/leaderboard.js 生成（只读，绝不修改 state），
  // 此处仅持久化到 leaderboard.local.snapshot.v1，不改变 gameState / eve_idle_save。
  NoopLeaderboardProvider.prototype.submitSnapshot = function (snapshot) {
    if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) {
      this._lastError = "invalid-snapshot";
      return Promise.resolve({ ok: false, status: "local-only", reason: "invalid-snapshot" });
    }
    if (!hasLocalStorage()) {
      this._lastError = "localStorage-unavailable";
      return Promise.resolve({ ok: false, status: "error", reason: "localStorage-unavailable" });
    }
    try {
      // 包装为与 leaderboard-render.js 一致的快照结构（version / entries）
      const payload = {
        version: LB_SNAPSHOT_VERSION,
        platformGroup: "standard",
        snapshotAt: (typeof Date.now === "function") ? Date.now() : 0,
        clientVersion: (typeof window !== "undefined" && window.GameVersion) ? String(window.GameVersion) : "0.1.0-local",
        playerName: "指挥官",
        entries: snapshot.map(function (e) {
          return {
            boardId: e.boardId,
            playerName: e.playerName || (typeof window !== "undefined" && window.gameState && window.gameState.player && window.gameState.player.name) || "指挥官",
            score: e.score,
            level: e.level,
            xp: e.xp,
            updatedAt: e.updatedAt,
            platformGroup: e.platformGroup || "standard",
          };
        }),
      };
      localStorage.setItem(LB_LOCAL_KEY, JSON.stringify(payload));
      this._lastError = null;
      return Promise.resolve({
        ok: true,
        status: "local-only",
        submittedAt: payload.snapshotAt,
        entries: payload.entries.length,
        message: "本地快照已保存（未连接平台，不会上传）",
      });
    } catch (e) {
      this._lastError = String(e && e.message ? e.message : e);
      return Promise.resolve({ ok: false, status: "error", reason: "write-failed", error: this._lastError });
    }
  };

  // 拉取某榜单：未连接平台时返回空 rows（不添加假数据）。
  // options 含 { includeLocal: boolean }；本地模式若 includeLocal=true，
  // 仅从本地快照中透传当前玩家的一条记录（与 UI「本地预览」一致）。
  NoopLeaderboardProvider.prototype.fetchLeaderboard = function (boardId, options) {
    options = options || {};
    const snap = readLocalSnapshot();
    const rows = [];

    if (snap && options.includeLocal) {
      const entry = snap.entries.find(function (e) { return e.boardId === boardId; }) || null;
      if (entry) {
        rows.push({
          rank: 1,
          name: entry.playerName || (snap.playerName || "指挥官"),
          level: entry.level,
          xp: entry.xp,
          updatedAt: entry.updatedAt,
          isCurrentPlayer: true,
          isLocalPreview: true,
        });
      }
    }

    return Promise.resolve({
      boardId: boardId || null,
      rows: rows,
      status: "local-only",
      connected: false,
      reason: "no-platform-connected",
      message: "未连接平台，仅显示本地预览",
    });
  };

  // 删除本地快照：委托 localStorage.removeItem（与 leaderboard-render.js 一致）。
  NoopLeaderboardProvider.prototype.deleteLocalSnapshot = function () {
    if (!hasLocalStorage()) {
      this._lastError = "localStorage-unavailable";
      return Promise.resolve({ ok: false, status: "error", reason: "localStorage-unavailable" });
    }
    try {
      localStorage.removeItem(LB_LOCAL_KEY);
      this._lastError = null;
      return Promise.resolve({ ok: true, status: "local-only", removed: true });
    } catch (e) {
      this._lastError = String(e && e.message ? e.message : e);
      return Promise.resolve({ ok: false, status: "error", reason: "remove-failed", error: this._lastError });
    }
  };

  // 当前状态：明确 local-only，供 UI 显示「本地预览 / 未连接平台」。
  NoopLeaderboardProvider.prototype.getProviderStatus = function () {
    return {
      connected: false,
      mode: "local-only",
      lastError: this._lastError,
      platformName: "local",
      message: "本地预览模式：尚未连接 TapTap / Steam 排行榜",
    };
  };

  root.NoopLeaderboardProvider = NoopLeaderboardProvider;
  if (typeof window !== "undefined") window.NoopLeaderboardProvider = NoopLeaderboardProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = NoopLeaderboardProvider;
})(typeof window !== "undefined" ? window : globalThis);
