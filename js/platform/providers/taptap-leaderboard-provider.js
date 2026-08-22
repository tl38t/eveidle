/* ================================================================
   taptap-leaderboard-provider.js — TapTap 排行榜 Provider（优先接入）

   实现 LeaderboardProvider 契约：
     submitSnapshot(snapshot)
     fetchLeaderboard(boardId, options)
     deleteLocalSnapshot()
     getProviderStatus()

   平台接入事实（来自 TapTap 小游戏官方文档）：
   - 全局对象：tap（无需 SDK，直接使用）
   - 管理器：const mgr = tap.getLeaderboardManager()
   - 上报：mgr.submitScores({ scores:[{leaderboardId, score}], callback:{onSuccess,onFailure} })
            onFailure(code, message) —— 回调式，不抛异常
   - 读取：mgr.loadLeaderboardScores({ leaderboardId, maxSize, nextPage, periodToken, callback })
            mgr.loadCurrentPlayerLeaderboardScore({ leaderboardId, callback })
   - 榜单 ID：开发者中心「游戏服务→游戏排行」创建后获取的字符串（排行榜ID），
             而非名称；未创建 -> 500001 "leaderboard not found"
   - 错误：onFailure(code, message) 回调

   设计纪律（严格不越界）：
   - 不修改 state.skills / 技能等级 / 经验 / gameState / eve_idle_save。
   - 不把 AppKey / Secret / MasterKey 等敏感信息写入前端；仅经 window.tap 调用。
   - 所有方法安全捕获异常，失败结构化返回，绝不抛未处理异常。
   - 不创建 setInterval / setTimeout，不自动上传，不做后台轮询。
   - 上报数据只能来自 getLeaderboardSnapshot(state)（由 sync service 注入）。
   - 分数必须转换为 TapTap 接受的安全整数（见 config.sanitizeScore）。
   - 只允许上报已有平台榜单（配置中的 leaderboardId 已存在且非占位符）；
     配置缺失或占位符 -> 返回配置缺失，不得伪造成功。
   - 未发现 tap 对象 / 未登录 / API 不可用时 -> { ok:false, status:"local-only", mode:"local-only", reason:"unavailable" }。

   回退纪律：本 provider 在「真实不可用」时由 sync service 选择 Noop/Local，
   但 provider 自身也保证任何异常都降级为 local-only，绝不阻塞游戏。
   ================================================================ */
(function (root) {
  "use strict";

  // 运行时解析 config：优先 window.LeaderboardPlatformConfig（浏览器/测试注入），
  // 否则回退 require（node CommonJS）。这样测试可在运行期注入真实 ID 变体。
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

  function tlog() { /* 占位：避免 console 噪声，真实接入可放开 */ }

  function getTap() {
    try {
      if (typeof window !== "undefined" && window.tap) return window.tap;
    } catch (e) { /* ignore */ }
    return null;
  }

  // 取管理器；不可用时返回 null（调用方据此回退 local-only）。
  function getManager() {
    const tap = getTap();
    if (!tap) return null;
    if (typeof tap.getLeaderboardManager !== "function") return null;
    try {
      return tap.getLeaderboardManager();
    } catch (e) {
      return null;
    }
  }

  function TaptapLeaderboardProvider(opts) {
    opts = opts || {};
    this._lastError = null;
    this._mode = "local-only";
    this._connected = false;
    this._available = false;
    // 可选注入的同步快照（来自 getLeaderboardSnapshot），仅用于在 submit 时
    // 把本地快照写入备用 localStorage（上报失败也不丢本地数据）。
    this._fallbackLocalKey = opts.localSnapshotKey || "leaderboard.local.snapshot.v1";
    this._noLocalProvider = null; // 延迟持有 Noop 实例用于回退写本地
  }

  // 是否可用：tap 存在 + 管理器可取。真正的「已登录」需由上报回调确认，
  // 因此 isAvailable 只代表环境具备接入条件（非最终成功保证）。
  TaptapLeaderboardProvider.prototype.isAvailable = function () {
    return !!getManager();
  };

  TaptapLeaderboardProvider.prototype.initialize = function () {
    const mgr = getManager();
    this._available = !!mgr;
    this._connected = !!mgr;
    this._mode = mgr ? "taptap" : "local-only";
    if (mgr) this._lastError = null;
    return Promise.resolve(this._available);
  };

  // 把快照安全地写入本地备用 key（上报失败时也能保留本地数据，不清除已有）。
  TaptapLeaderboardProvider.prototype._writeLocalFallback = function (snapshot) {
    if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) return false;
    try {
      if (typeof localStorage === "undefined" || !localStorage) return false;
      const payload = {
        version: 1,
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

  // 上报快照：遍历 snapshot 中每个 entry，按 boardId 解析 TapTap leaderboardId，
  // 仅上报配置存在且非占位的榜单；分数整数化；未登录/不可用 -> local-only unavailable。
  TaptapLeaderboardProvider.prototype.submitSnapshot = function (snapshot) {
    const self = this;
    // 1) 环境不可用（无 tap / 无管理器）-> 立即回退 local-only，并保留本地数据
    const mgr = getManager();
    if (!mgr) {
      self._lastError = "tap-unavailable";
      self._mode = "local-only";
      // 仍写入本地备用，确保上报失败也保留数据
      self._writeLocalFallback(snapshot);
      return Promise.resolve({
        ok: false,
        status: "local-only",
        mode: "local-only",
        reason: "unavailable",
        message: "TapTap 环境不可用（tap 对象不存在），已回退本地预览",
      });
    }

    if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) {
      self._lastError = "invalid-snapshot";
      return Promise.resolve({ ok: false, status: "local-only", mode: "local-only", reason: "invalid-snapshot" });
    }

    // 2) 逐条上报；未配置 / 占位的跳过（不算失败，但记录 skipped）
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
          self._mode = "taptap";
          self._lastError = null;
          return resolve({
            ok: true,
            status: "submitted",
            mode: "taptap",
            submittedAt: (typeof Date.now === "function") ? Date.now() : 0,
            entries: results.length,
            message: "已上报 TapTap 排行榜",
          });
        }
        // 未出现真正成功：若全是配置缺失 -> config-missing；否则未登录/unavailable
        if (anyConfigMissing && !anyFailure) {
          self._lastError = "config-missing";
          self._mode = "local-only";
          return resolve({
            ok: false,
            status: "local-only",
            mode: "local-only",
            reason: "config-missing",
            message: "TapTap 榜单尚未在开发者中心创建，请先配置排行榜ID",
          });
        }
        // 调用失败（未登录等）-> 结构化 unavailable
        self._lastError = "taptap-submit-failed";
        self._mode = "local-only";
        return resolve({
          ok: false,
          status: "local-only",
          mode: "local-only",
          reason: "unavailable",
          message: "TapTap 上报失败（可能未登录），已保留本地数据",
        });
      }

      // 防御：同步遍历，逐条异步上报
      for (let i = 0; i < snapshot.length; i++) {
        const entry = snapshot[i];
        if (!entry || !entry.boardId) continue;
        if (!getConfig().isBoardReportable || !getConfig().isBoardReportable(entry.boardId)) {
          continue; // drones / unknown：绝不报
        }
        const lbId = getConfig().resolveTapTapLeaderboardId(entry.boardId);
        if (!lbId || (getConfig().isPlaceholderLeaderboardId && getConfig().isPlaceholderLeaderboardId(lbId))) {
          anyConfigMissing = true;
          continue; // 配置缺失：跳过，不伪造
        }
        const score = getConfig().sanitizeScore
          ? getConfig().sanitizeScore(entry.score)
          : (Math.floor(Number(entry.score) || 0));
        pending++;
        try {
          mgr.submitScores({
            scores: [{ leaderboardId: lbId, score: score }],
            callback: {
              onSuccess: function () {
                anySuccess = true;
                results.push({ boardId: entry.boardId, ok: true });
                pending--;
                settle();
              },
              onFailure: function (code, message) {
                // 500001 = leaderboard not found（未创建）；其他视为未登录/错误
                if (code === 500001) anyConfigMissing = true;
                else anyFailure = true;
                results.push({ boardId: entry.boardId, ok: false, code: code, message: message });
                pending--;
                settle();
              },
            },
          });
        } catch (e) {
          // 调用本身抛错（极端环境）-> 结构化 unavailable
          anyFailure = true;
          pending--;
          self._lastError = String(e && e.message ? e.message : e);
          settle();
        }
      }
      // 若没有任何可上报条目（全 drones/unknown 或全配置缺失）
      settle();
    });
  };

  // 拉取某榜单：尝试从 TapTap 读取；不可用 / 配置缺失 -> local-only 空结果。
  // options.includeLocal：若平台无数据，可透传本地单条预览（与 UI 一致）。
  TaptapLeaderboardProvider.prototype.fetchLeaderboard = function (boardId, options) {
    options = options || {};
    const self = this;
    const mgr = getManager();
    if (!mgr) {
      return Promise.resolve({
        boardId: boardId || null,
        taptapLeaderboardId: lbId || null,
        rows: [],
        status: "local-only",
        mode: "local-only",
        connected: false,
        reason: "unavailable",
        message: "TapTap 环境不可用",
      });
    }
    if (!boardId || !getConfig().isBoardReportable || !getConfig().isBoardReportable(boardId)) {
      return Promise.resolve({
        boardId: boardId || null,
        rows: [],
        status: "local-only",
        mode: "local-only",
        connected: false,
        reason: "board-not-reportable",
      });
    }
    const lbId = getConfig().resolveTapTapLeaderboardId(boardId);
    if (!lbId || (getConfig().isPlaceholderLeaderboardId && getConfig().isPlaceholderLeaderboardId(lbId))) {
      return Promise.resolve({
        boardId: boardId || null,
        rows: [],
        status: "local-only",
        mode: "local-only",
        connected: false,
        reason: "config-missing",
        message: "TapTap 榜单尚未配置排行榜ID",
      });
    }

    return new Promise(function (resolve) {
      let settled = false;
      function fail(reason, code) {
        if (settled) return;
        settled = true;
        self._lastError = reason;
        self._mode = "local-only";
        // 不抛异常：结构化返回空（UI 继续显示本地预览）
        resolve({
          boardId: boardId || null,
          taptapLeaderboardId: lbId,
          rows: [],
          status: "local-only",
          mode: "local-only",
          connected: false,
          reason: reason,
          code: code,
          message: "TapTap 读取失败，已回退本地预览",
        });
      }
      try {
        mgr.loadLeaderboardScores({
          leaderboardId: lbId,
          maxSize: (typeof options.limit === "number" && options.limit > 0) ? options.limit : 50,
          continuationToken: (options && options.continuationToken) || "",
          collection: (options && options.collection) || "public",
          periodToken: undefined,
          callback: {
            onSuccess: function (res) {
              if (settled) return;
              settled = true;
              const list = (res && Array.isArray(res.scores)) ? res.scores : [];
              const rows = list.map(function (item, idx) {
                return {
                  rank: idx + 1,
                  name: (item.user && item.user.name) || item.name || item.nickname || ("玩家" + (idx + 1)),
                  level: item.level != null ? item.level : null,
                  xp: item.score != null ? item.score : null,
                  score: item.score != null ? item.score : null,
                  updatedAt: item.updatedAt || null,
                  isCurrentPlayer: !!item.isCurrentPlayer,
                  isLocalPreview: false,
                };
              });
              self._connected = true;
              self._mode = "taptap";
              self._lastError = null;
              resolve({
                boardId: boardId || null,
                taptapLeaderboardId: lbId,
                rows: rows,
                status: "connected",
                mode: "taptap",
                connected: true,
                message: "已从 TapTap 获取榜单",
              });
            },
            onFailure: function (code, message) {
              // 500001 = 未创建 -> config-missing；其余 -> unavailable
              if (code === 500001) return fail("config-missing", code);
              return fail("unavailable", code);
            },
          },
        });
      } catch (e) {
        return fail("taptap-fetch-error", String(e && e.message ? e.message : e));
      }
    });
  };

  // 删除本地快照：TapTap 端无等价操作（榜单纯累加），仅清本地备用 key。
  TaptapLeaderboardProvider.prototype.deleteLocalSnapshot = function () {
    try {
      if (typeof localStorage !== "undefined" && localStorage) {
        localStorage.removeItem(this._fallbackLocalKey);
      }
      this._lastError = null;
      return Promise.resolve({ ok: true, status: "local-only", removed: true });
    } catch (e) {
      this._lastError = String(e && e.message ? e.message : e);
      return Promise.resolve({ ok: false, status: "error", reason: "remove-failed", error: this._lastError });
    }
  };

  // 当前状态：tap 可用且已初始化 -> taptap；否则 local-only。
  TaptapLeaderboardProvider.prototype.getProviderStatus = function () {
    const mgr = getManager();
    if (!mgr) {
      return {
        connected: false,
        mode: "local-only",
        lastError: this._lastError || "tap-unavailable",
        platformName: "TapTap",
        message: "本地预览模式：TapTap 未连接",
      };
    }
    return {
      connected: this._connected,
      mode: this._mode,
      lastError: this._lastError,
      platformName: "TapTap",
      available: true,
      message: this._connected ? "TapTap 在线" : "TapTap 可用但未确认登录",
    };
  };

  root.TaptapLeaderboardProvider = TaptapLeaderboardProvider;
  if (typeof window !== "undefined") window.TaptapLeaderboardProvider = TaptapLeaderboardProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = TaptapLeaderboardProvider;
})(typeof window !== "undefined" ? window : globalThis);
