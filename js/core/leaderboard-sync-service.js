/* ================================================================
   LeaderboardSyncService — 平台无关的排行榜同步服务

   职责：
   - 把 js/data/leaderboard.js 生成的只读快照，经 LeaderboardProvider 契约
     同步到平台（本阶段仅 Noop/Local provider，不接真实 TapTap/Steam API）。
   - 拉取榜单时委托 provider；未连接平台安全返回空（不添加假数据）。
   - 删除本地快照委托 provider.deleteLocalSnapshot()。
   - 暴露 getProviderStatus() 供 UI 显示「本地预览 / 未连接平台」。

   设计纪律（严格不越界）：
   - 只读：服务仅消费 getLeaderboardSnapshot(state) 的输出，绝不调用
     addSkillXpToState / 写 state.skills / 改 gameState / 写 eve_idle_save。
   - 不创建 setInterval / setTimeout 定时器，不自动上传，不做后台轮询。
   - 不调用 TapTap / Steam / Electron 真实 SDK。
   - provider 异常一律结构化返回（catch -> { ok:false, status:"error" }），
     绝不向上抛出未处理异常，确保游戏主流程不受影响。
   - 不修改生产 / 战斗 / 教程 / 空间站 / 考古 / 3D 任何逻辑。
   ================================================================ */
(function (root) {
  "use strict";

  // 快照生成只读接口（浏览器走 ESM import；node 测试走 require 兜底）。
  let getLeaderboardSnapshot = null;
  try {
    if (typeof require !== "undefined") {
      // CommonJS 环境（node 测试）
      const mod = require("../data/leaderboard.js");
      getLeaderboardSnapshot = mod && mod.getLeaderboardSnapshot;
    }
  } catch (e) { /* 浏览器环境走全局 import，下面 window 分支处理 */ }

  function resolveSnapshotFn() {
    if (getLeaderboardSnapshot) return getLeaderboardSnapshot;
    // 浏览器：leaderboard.js 被 index.html 以 type="module" 引入，函数挂在 window
    try {
      if (typeof window !== "undefined" && window.getLeaderboardSnapshot) {
        getLeaderboardSnapshot = window.getLeaderboardSnapshot;
      }
    } catch (e) { /* ignore */ }
    return getLeaderboardSnapshot;
  }

  function LeaderboardSyncService(opts) {
    opts = opts || {};
    this.provider = opts.provider || null;
    this.platform = opts.platform || "local"; // "local" | "taptap" | "steam"
    // 优先使用调用方显式注入的快照函数（浏览器 ESM 场景）；
    // 否则回退到 require / window.getLeaderboardSnapshot（node / 经典脚本场景）。
    this._snapshotFn = (typeof opts.snapshotFn === "function") ? opts.snapshotFn : null;
    this._status = {
      connected: false,
      mode: "local-only",
      lastError: null,
      platformName: "local",
    };
    this._lastError = null;
    this._initialized = false;
  }

  // 初始化：委托 provider.initialize()；安全捕获异常。
  LeaderboardSyncService.prototype.init = function () {
    const self = this;
    if (!this.provider || typeof this.provider.initialize !== "function") {
      this._updateStatus();
      return Promise.resolve(false);
    }
    return Promise.resolve(this.provider.initialize()).then(function (ok) {
      self._initialized = true;
      self._updateStatus();
      return !!(self.provider && self.provider.isAvailable && self.provider.isAvailable());
    }).catch(function (err) {
      self._lastError = err;
      self._status.lastError = String(err && err.message ? err.message : err);
      self._status.mode = "error";
      return false;
    });
  };

  LeaderboardSyncService.prototype._updateStatus = function () {
    if (this.provider && typeof this.provider.getProviderStatus === "function") {
      const ps = this.provider.getProviderStatus();
      this._status = {
        connected: !!(ps && ps.connected),
        mode: (ps && ps.mode) || "local-only",
        lastError: (ps && ps.lastError) || null,
        platformName: (ps && ps.platformName) || "local",
      };
    } else {
      this._status = { connected: false, mode: "local-only", lastError: null, platformName: "local" };
    }
    if (this._lastError) this._status.lastError = this._lastError;
  };

  LeaderboardSyncService.prototype.getProviderStatus = function () {
    this._updateStatus();
    return this._status;
  };

  LeaderboardSyncService.prototype.getLastError = function () { return this._lastError; };
  LeaderboardSyncService.prototype.isInitialized = function () { return this._initialized; };
  LeaderboardSyncService.prototype.isConnected = function () {
    this._updateStatus();
    return this._status.connected;
  };

  // 生成只读快照（来自 js/data/leaderboard.js），绝不修改 state。
  LeaderboardSyncService.prototype.buildSnapshot = function (state) {
    let fn = this._snapshotFn;
    if (!fn || typeof fn !== "function") fn = resolveSnapshotFn();
    if (!fn || typeof fn !== "function") {
      this._lastError = "snapshot-fn-unavailable";
      return null;
    }
    try {
      return fn(state);
    } catch (e) {
      this._lastError = String(e && e.message ? e.message : e);
      return null;
    }
  };

  // 提交快照：委托 provider.submitSnapshot（不修改 state / gameState）。
  // 返回结构化结果；provider 异常时捕获为 status:"error"，不抛出。
  LeaderboardSyncService.prototype.submitSnapshot = function (snapshot) {
    const self = this;
    if (!this.provider || typeof this.provider.submitSnapshot !== "function") {
      this._lastError = "provider-unavailable";
      return Promise.resolve({ ok: false, status: "error", reason: "provider-unavailable" });
    }
    return Promise.resolve(this.provider.submitSnapshot(snapshot)).then(function (res) {
      self._lastError = null;
      return res || { ok: false, status: "error", reason: "empty-response" };
    }).catch(function (err) {
      self._lastError = err;
      return { ok: false, status: "error", reason: "provider-error", error: String(err && err.message ? err.message : err) };
    });
  };

  // 拉取某榜单：未连接平台安全返回空 rows（不添加假数据）。
  LeaderboardSyncService.prototype.fetchLeaderboard = function (boardId, options) {
    const self = this;
    if (!this.provider || typeof this.provider.fetchLeaderboard !== "function") {
      return Promise.resolve({
        boardId: boardId || null,
        rows: [],
        status: "local-only",
        connected: false,
        reason: "provider-unavailable",
      });
    }
    return Promise.resolve(this.provider.fetchLeaderboard(boardId, options)).then(function (res) {
      self._lastError = null;
      if (!res || typeof res !== "object") {
        return { boardId: boardId || null, rows: [], status: "local-only", connected: false };
      }
      // 保证 rows 是数组（provider 异常返回非数组时安全回退）
      if (!Array.isArray(res.rows)) res.rows = [];
      return res;
    }).catch(function (err) {
      self._lastError = err;
      // 结构化错误返回，不抛出未处理异常
      return {
        boardId: boardId || null,
        rows: [],
        status: "error",
        connected: false,
        reason: "provider-error",
        error: String(err && err.message ? err.message : err),
      };
    });
  };

  // 删除本地快照：委托 provider.deleteLocalSnapshot。
  LeaderboardSyncService.prototype.deleteLocalSnapshot = function () {
    const self = this;
    if (!this.provider || typeof this.provider.deleteLocalSnapshot !== "function") {
      this._lastError = "provider-unavailable";
      return Promise.resolve({ ok: false, status: "error", reason: "provider-unavailable" });
    }
    return Promise.resolve(this.provider.deleteLocalSnapshot()).then(function (res) {
      self._lastError = null;
      return res || { ok: false, status: "error", reason: "empty-response" };
    }).catch(function (err) {
      self._lastError = err;
      return { ok: false, status: "error", reason: "provider-error", error: String(err && err.message ? err.message : err) };
    });
  };

  // 便捷方法：一键「记录当前排行榜数据」流程
  //  1. 由 state 生成只读快照（不修改 state）
  //  2. 委托 provider.submitSnapshot（local-only）
  // 返回结构化结果。
  LeaderboardSyncService.prototype.recordLocalSnapshot = function (state) {
    const snap = this.buildSnapshot(state);
    if (!snap) {
      return Promise.resolve({ ok: false, status: "error", reason: "snapshot-build-failed" });
    }
    return this.submitSnapshot(snap);
  };

  const api = LeaderboardSyncService;
  root.LeaderboardSyncService = api;
  if (typeof window !== "undefined") window.LeaderboardSyncService = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // ---- Provider 自动选择（优先级）----
  //   1) TapTap 可用且已登录 -> TapTap Provider
  //   2) TapTap 不可用 -> Noop/Local Provider
  //   3) Steam 永远不参与自动选择，只保留占位接口（由调用方显式 new）。
  // 该函数只读探测 window.tap / window.LeaderboardPlatformConfig，不调用 SDK、
  // 不修改状态、不抛未处理异常。返回 { provider, platform }。
  LeaderboardSyncService.selectProvider = function (opts) {
    opts = opts || {};
    try {
      const Tap = (typeof window !== "undefined" && window.TaptapLeaderboardProvider) || null;
      const Noop = (typeof window !== "undefined" && window.NoopLeaderboardProvider) || null;
      const Config = (typeof window !== "undefined" && window.LeaderboardPlatformConfig) || null;

      // 探测 TapTap 环境是否具备接入条件（tap 全局对象 + 管理器可取）
      let tapUsable = false;
      if (Tap && Config && typeof Config.detectTapTapAvailable === "function") {
        tapUsable = Config.detectTapTapAvailable();
      } else if (Tap) {
        try {
          const tap = window.tap;
          tapUsable = !!(tap && typeof tap.getLeaderboardManager === "function");
        } catch (e) { tapUsable = false; }
      }

      if (tapUsable && Tap) {
        // TapTap 环境可用：交由 provider 在调用时确认登录态。
        // 注意：真实「已登录」需由 submitScores 的回调确认；此处仅代表
        // 具备接入条件，不提前乐观判定为 connected。
        const provider = new Tap(opts);
        return { provider: provider, platform: "taptap" };
      }

      // 回退 Noop / Local
      if (Noop) {
        const provider = new Noop(opts);
        return { provider: provider, platform: "local" };
      }
      return { provider: null, platform: "local" };
    } catch (e) {
      // 任何异常都安全回退本地
      try {
        const Noop = (typeof window !== "undefined" && window.NoopLeaderboardProvider) || null;
        if (Noop) return { provider: new Noop(opts), platform: "local" };
      } catch (e2) { /* ignore */ }
      return { provider: null, platform: "local" };
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
