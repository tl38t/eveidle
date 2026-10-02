/* ================================================================
   steam-leaderboard-provider.js — Steam 排行榜 Provider（原生接入）

   实现 LeaderboardProvider 契约：
     submitSnapshot(snapshot)
     fetchLeaderboard(boardId, options)
     deleteLocalSnapshot()
     getProviderStatus()

   接入路径（原生，非 Web API）：
   - 原生层（electron/steam-leaderboards.js + 原生 addon）调用 ISteamUserStats
     （FindLeaderboard / UploadLeaderboardScore / DownloadLeaderboardEntries）。
   - 渲染进程（沙箱隔离）经 window.SteamBridge.submitLeaderboard(name, score) /
     fetchLeaderboard(name, opts) 走 IPC 到主进程，由原生层执行。
   - 原生层复用 steamworks.js 已初始化的 SteamAPI 实例（绝不二次 init）。
     原生 addon 未构建时（steam-native-not-built）自动降级为本地预览，不阻塞游戏。

   设计纪律（严格不越界，与 TapTap provider 一致）：
   - 不修改 state.skills / 技能等级 / 经验 / gameState / eve_idle_save。
   - 不持有任何密钥 / AppId / Web API key。
   - 所有方法安全捕获异常，失败结构化返回，绝不抛未处理异常。
   - 不创建 setInterval / setTimeout，不自动上传，不做后台轮询。
   - 上报数据只能来自 getLeaderboardSnapshot(state)（由 sync service 注入）。
   - 只允许上报已有本地映射的榜单（config.resolveSteamLeaderboardName 返回非 null，
     且非 drones / unknown）；未配置 / 未创建 -> 记录 config-missing，不伪造成功。
   - 未发现 window.SteamBridge / 原生未构建 / Steam 未初始化 -> 本地预览，
     并保留本地快照（上报失败不丢本地数据）。

   自动选择（见 leaderboard-sync-service.js selectProvider）：
   - 当 window.SteamBridge 存在时，Steam 桌面端自动启用（mode:"steam"）。
   - Steam 与 TapTap 互斥：同一运行环境只会有一个 provider 被选中。
   ================================================================ */
(function (root) {
  "use strict";

  // 运行时解析 config：优先 window.LeaderboardPlatformConfig（浏览器/测试注入），
  // 否则回退 require（node CommonJS）。测试可在运行期注入真实映射变体。
  function getConfig() {
    try {
      if (typeof window !== "undefined" && window.LeaderboardPlatformConfig)
        return window.LeaderboardPlatformConfig;
    } catch (e) { /* ignore */ }
    try {
      if (typeof require !== "undefined") return require("./leaderboard-platform-config.js");
    } catch (e) { /* ignore */ }
    return null;
  }

  function getSteamBridge() {
    try {
      if (typeof window !== "undefined" && window.SteamBridge) return window.SteamBridge;
    } catch (e) { /* ignore */ }
    return null;
  }

  // Steam 是否可用：window.SteamBridge 存在且暴露 submitLeaderboard（IPC 通道就绪）。
  // 真正的「Steam 已初始化 + 原生已构建」需由上报/拉取结果确认，所以这里只代表
  // 环境具备接入条件（非最终成功保证），与 TapTap 的 isAvailable 语义一致。
  function detectSteamAvailable() {
    try {
      const sb = getSteamBridge();
      if (!sb) return false;
      if (typeof sb.submitLeaderboard !== "function") return false;
      if (typeof sb.fetchLeaderboard !== "function") return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // 本地回退快照 key（与 Noop / TapTap provider 一致，独立 key 不改游戏存档）
  const LB_LOCAL_KEY = "leaderboard.local.snapshot.v1";
  const LB_SNAPSHOT_VERSION = 1;

  function hasLocalStorage() {
    try { return (typeof localStorage !== "undefined") && !!localStorage; } catch (e) { return false; }
  }

  function SteamLeaderboardProvider(opts) {
    opts = opts || {};
    this._lastError = null;
    this._mode = "unavailable"; // 初始化前未知；initialize 后改为 "steam"
    this._connected = false;
    this._available = false;
    // 可选注入的同步快照 key（来自 getLeaderboardSnapshot），上报时用于写本地回退。
    this._fallbackLocalKey = opts.localSnapshotKey || LB_LOCAL_KEY;
    this._noLocalProvider = null; // 延迟持有 Noop 实例用于回退写本地
  }

  SteamLeaderboardProvider.prototype.isAvailable = function () {
    return detectSteamAvailable();
  };

  SteamLeaderboardProvider.prototype.initialize = function () {
    this._available = detectSteamAvailable();
    this._mode = this._available ? "steam" : "unavailable";
    this._connected = false; // 真正连接态由首次上报/拉取确认
    if (this._available) this._lastError = null;
    return Promise.resolve(this._available);
  };

  // 把快照安全地写入本地备用 key（上报失败也保留本地数据，不清除已有）。
  SteamLeaderboardProvider.prototype._writeLocalFallback = function (snapshot) {
    if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) return false;
    try {
      if (!hasLocalStorage()) return false;
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
      localStorage.setItem(this._fallbackLocalKey, JSON.stringify(payload));
      return true;
    } catch (e) {
      return false;
    }
  };

  // 上报快照：遍历 snapshot，按 boardId 解析 Steam 排行榜名，仅上报已配置且非占位
  // 的榜单；分数整数化；无 SteamBridge / 原生未构建 / Steam 未初始化 -> 本地预览。
  SteamLeaderboardProvider.prototype.submitSnapshot = function (snapshot) {
    const self = this;
    const bridge = getSteamBridge();

    // 1) 环境不可用（无 SteamBridge）-> 立即回退本地预览，并保留本地数据
    if (!bridge || typeof bridge.submitLeaderboard !== "function") {
      self._lastError = "steam-bridge-unavailable";
      self._mode = "unavailable";
      self._writeLocalFallback(snapshot);
      return Promise.resolve({
        ok: false,
        status: "local-only",
        mode: "unavailable",
        reason: "steam-bridge-unavailable",
        message: "Steam 桌面端未就绪（SteamBridge 不存在），已回退本地预览",
      });
    }

    if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) {
      self._lastError = "invalid-snapshot";
      return Promise.resolve({ ok: false, status: "local-only", mode: "steam", reason: "invalid-snapshot" });
    }

    const cfg = getConfig();

    // 2) 逐条上报；未配置 / 未创建的跳过（不算失败，但记录 skipped）
    const results = [];
    let pending = 0;
    let done = false;
    let anySuccess = false;
    let anyConfigMissing = false;
    let anyFailure = false;

    return new Promise(function (resolve) {
      function settle() {
        if (done) return;
        if (pending > 0) return;
        done = true;
        // 保留本地数据（无论成功与否）
        self._writeLocalFallback(snapshot);
        if (anySuccess) {
          self._connected = true;
          self._mode = "steam";
          self._lastError = null;
          return resolve({
            ok: true,
            status: "submitted",
            mode: "steam",
            submittedAt: (typeof Date.now === "function") ? Date.now() : 0,
            entries: results.length,
            message: "已上报 Steam 排行榜",
          });
        }
        // 未出现真正成功：若全是配置缺失（榜单未在 Steamworks 后台创建）-> config-missing
        if (anyConfigMissing && !anyFailure) {
          self._lastError = "config-missing";
          self._mode = "steam";
          return resolve({
            ok: false,
            status: "local-only",
            mode: "steam",
            reason: "config-missing",
            message: "Steam 排行榜尚未在 Steamworks 后台创建，请先创建对应名称的排行榜",
          });
        }
        // 调用失败（原生未构建 / Steam 未初始化等）-> 结构化 unavailable，本地预览保留
        // 不再吞掉真实原因：把各榜单返回的 reason 去重后带进 lastError 与 message，
        // UI 状态行即可显示如 steam-submit-failed(steam-unavailable) 而非笼统失败。
        const failReasons = [];
        const failMessages = [];
        for (let r = 0; r < results.length; r++) {
          const fr = results[r];
          if (fr && fr.ok === false) {
            const rs = fr.reason || fr.error || "unknown";
            if (failReasons.indexOf(rs) < 0) failReasons.push(rs);
            if (fr.message && failMessages.indexOf(fr.message) < 0) failMessages.push(fr.message);
          }
        }
        const reasonSuffix = failReasons.length ? "(" + failReasons.join(",") + ")" : "";
        self._lastError = "steam-submit-failed" + reasonSuffix;
        self._mode = "steam";
        return resolve({
          ok: false,
          status: "local-only",
          mode: "steam",
          reason: "unavailable",
          reasons: failReasons,
          message: "Steam 上报失败" + (reasonSuffix ? "（" + reasonSuffix + "）" : "") + "，已保留本地数据",
        });
      }

      for (let i = 0; i < snapshot.length; i++) {
        const entry = snapshot[i];
        if (!entry || !entry.boardId) continue;
        // 仅上报已配置且非占位的榜单；drones / unknown 一律跳过
        if (!cfg || !cfg.isBoardReportable || !cfg.isBoardReportable(entry.boardId)) {
          continue;
        }
        const lbName = cfg.resolveSteamLeaderboardName
          ? cfg.resolveSteamLeaderboardName(entry.boardId)
          : null;
        if (!lbName || (cfg.isPlaceholderLeaderboardName && cfg.isPlaceholderLeaderboardName(lbName))) {
          anyConfigMissing = true;
          continue; // 配置缺失 / 占位：跳过，不伪造
        }
        const score = cfg.sanitizeScore
          ? cfg.sanitizeScore(entry.score)
          : (Math.floor(Number(entry.score) || 0));
        pending++;
        try {
          const p = Promise.resolve(bridge.submitLeaderboard(lbName, score));
          p.then(function (res) {
            res = res || {};
            if (res.ok === true && res.found !== false) {
              anySuccess = true;
              results.push({ boardId: entry.boardId, ok: true });
            } else if (res.reason === "not-found") {
              // 排行榜名在 Steamworks 后台尚未创建
              anyConfigMissing = true;
              results.push({ boardId: entry.boardId, ok: false, reason: "not-found" });
            } else {
              // native-not-built / steam-unavailable / call-failed 等
              anyFailure = true;
              results.push({ boardId: entry.boardId, ok: false, reason: res.reason || "submit-failed", message: res.message || null });
            }
            pending--;
            settle();
          }).catch(function (err) {
            anyFailure = true;
            results.push({ boardId: entry.boardId, ok: false, error: String(err && err.message ? err.message : err) });
            pending--;
            settle();
          });
        } catch (e) {
          anyFailure = true;
          pending--;
          self._lastError = String(e && e.message ? e.message : e);
          settle();
        }
      }
      settle();
    });
  };

  // 拉取某榜单：尝试从 Steam 读取；不可用 / 配置缺失 -> 本地预览空结果。
  SteamLeaderboardProvider.prototype.fetchLeaderboard = function (boardId, options) {
    options = options || {};
    const self = this;
    const bridge = getSteamBridge();

    if (!bridge || typeof bridge.fetchLeaderboard !== "function") {
      return Promise.resolve({
        boardId: boardId || null,
        rows: [],
        status: "local-only",
        mode: "unavailable",
        connected: false,
        reason: "steam-bridge-unavailable",
        message: "Steam 桌面端未就绪",
      });
    }
    const cfg = getConfig();
    if (!boardId || !cfg || !cfg.isBoardReportable || !cfg.isBoardReportable(boardId)) {
      return Promise.resolve({
        boardId: boardId || null,
        rows: [],
        status: "local-only",
        mode: "steam",
        connected: false,
        reason: "board-not-reportable",
      });
    }
    const lbName = cfg.resolveSteamLeaderboardName ? cfg.resolveSteamLeaderboardName(boardId) : null;
    if (!lbName || (cfg.isPlaceholderLeaderboardName && cfg.isPlaceholderLeaderboardName(lbName))) {
      return Promise.resolve({
        boardId: boardId || null,
        rows: [],
        status: "local-only",
        mode: "steam",
        connected: false,
        reason: "config-missing",
        message: "Steam 排行榜尚未配置名称",
      });
    }

    return Promise.resolve(
      bridge.fetchLeaderboard(lbName, {
        limit: (typeof options.limit === "number" && options.limit > 0) ? options.limit : 50,
      })
    ).then(function (res) {
      res = res || {};
      if (res.ok === true && Array.isArray(res.entries)) {
        const rows = res.entries.map(function (item, idx) {
          return {
            rank: (typeof item.rank === "number") ? item.rank : (idx + 1),
            name: item.name || ("玩家" + (idx + 1)),
            level: (item.level != null) ? item.level : null,
            xp: (item.score != null) ? item.score : null,
            score: (item.score != null) ? item.score : null,
            updatedAt: item.updatedAt || null,
            isCurrentPlayer: !!item.isCurrentPlayer,
            isLocalPreview: false,
          };
        });
        self._connected = true;
        self._mode = "steam";
        self._lastError = null;
        return {
          boardId: boardId || null,
          steamLeaderboardName: lbName,
          rows: rows,
          status: "connected",
          mode: "steam",
          connected: true,
          message: "已从 Steam 获取榜单",
        };
      }
      if (res.reason === "not-found") {
        self._lastError = "config-missing";
        self._mode = "steam";
        return {
          boardId: boardId || null,
          rows: [],
          status: "local-only",
          mode: "steam",
          connected: false,
          reason: "config-missing",
          message: "Steam 排行榜尚未在后台创建",
        };
      }
      // native-not-built / steam-unavailable / call-failed 等：结构化为本地预览
      self._lastError = (res && res.reason) || "steam-fetch-failed";
      self._mode = "steam";
      return {
        boardId: boardId || null,
        rows: [],
        status: "local-only",
        mode: "steam",
        connected: false,
        reason: "unavailable",
        message: "Steam 读取失败，已回退本地预览",
      };
    }).catch(function (err) {
      self._lastError = String(err && err.message ? err.message : err);
      self._mode = "steam";
      return {
        boardId: boardId || null,
        rows: [],
        status: "local-only",
        mode: "steam",
        connected: false,
        reason: "provider-error",
        error: self._lastError,
      };
    });
  };

  // 删除本地快照：Steam 端无等价操作（榜单纯累加），仅清本地备用 key。
  SteamLeaderboardProvider.prototype.deleteLocalSnapshot = function () {
    try {
      if (hasLocalStorage()) {
        localStorage.removeItem(this._fallbackLocalKey);
      }
      this._lastError = null;
      return Promise.resolve({ ok: true, status: "local-only", removed: true });
    } catch (e) {
      this._lastError = String(e && e.message ? e.message : e);
      return Promise.resolve({ ok: false, status: "error", reason: "remove-failed", error: this._lastError });
    }
  };

  // 当前状态：SteamBridge 可用且已初始化 -> steam；否则 unavailable / 本地预览。
  SteamLeaderboardProvider.prototype.getProviderStatus = function () {
    const avail = detectSteamAvailable();
    if (!avail) {
      return {
        connected: false,
        mode: "unavailable",
        lastError: this._lastError || "steam-bridge-unavailable",
        platformName: "Steam",
        message: "本地预览模式：Steam 桌面端未连接",
      };
    }
    return {
      connected: this._connected,
      mode: this._mode,
      lastError: this._lastError,
      platformName: "Steam",
      available: true,
      message: this._connected ? "Steam 排行榜在线" : "Steam 已就绪，等待上报确认",
    };
  };

  root.SteamLeaderboardProvider = SteamLeaderboardProvider;
  if (typeof window !== "undefined") window.SteamLeaderboardProvider = SteamLeaderboardProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = SteamLeaderboardProvider;
})(typeof window !== "undefined" ? window : globalThis);
