/* ================================================================
   LeaderboardProvider 统一契约（平台无关）

   共享核心只认识本契约定义的结构，绝不直接出现 tap / SteamBridge
   / 任何平台 SDK 调用。排行榜权威事实仍为 getLeaderboardSnapshot(state)
   （js/data/leaderboard.js），本契约仅负责把已生成的快照同步到平台，
   永不反向成为「技能等级/经验」的事实来源。

   接口方法（全部异步，返回 Promise，便于未来真实平台接入）：
   - submitSnapshot(snapshot)
       -> { ok, status: "local-only" | "submitted" | "error", ... }
   - fetchLeaderboard(boardId, options)
       -> { boardId, rows: [], status: "local-only" | "connected" | "error", ... }
   - deleteLocalSnapshot()
       -> { ok, status: "local-only" | "error" }
   - getProviderStatus()
       -> { connected: boolean, mode: "local-only" | "taptap" | "steam" | "error",
            lastError: string|null, platformName: string }

   设计纪律（本文件与所有 provider 不可越界）：
   - 不修改 state.skills / 技能等级 / 经验 / gameState / eve_idle_save。
   - 不创建 setInterval / setTimeout 定时器，不自动上传，不做后台轮询。
   - 不调用 TapTap / Steam / Electron 真实 SDK（仅定义结构）。
   - provider 异常一律结构化返回，不向上抛出未处理异常。
   ================================================================ */
(function (root) {
  "use strict";

  class LeaderboardProvider {
    // 该 provider 是否已连接到真实平台（local-only 时为 false）。
    isAvailable() { return false; }

    // 初始化（local-only 时直接 resolve(false)）。
    initialize() { return Promise.resolve(false); }

    // 提交本地快照到平台。local-only 时仅确认本地已存在。
    submitSnapshot(/* snapshot */) {
      return Promise.resolve({ ok: false, status: "local-only", reason: "no-provider" });
    }

    // 拉取某榜单排行数据。未连接平台时返回空 rows。
    fetchLeaderboard(/* boardId, options */) {
      return Promise.resolve({ boardId: null, rows: [], status: "local-only", reason: "no-provider" });
    }

    // 删除本地快照。
    deleteLocalSnapshot() {
      return Promise.resolve({ ok: false, status: "local-only", reason: "no-provider" });
    }

    // 当前 provider 状态（供 UI 显示「本地预览 / 未连接平台」）。
    getProviderStatus() {
      return {
        connected: false,
        mode: "local-only",
        lastError: null,
        platformName: "local",
      };
    }
  }

  const api = { LeaderboardProvider };

  root.LeaderboardProviderContract = api;
  if (typeof window !== "undefined") window.LeaderboardProviderContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
