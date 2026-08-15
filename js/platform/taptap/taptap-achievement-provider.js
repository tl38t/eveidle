/* ================================================================
   TapTapAchievementProvider — TapTap 小游戏成就官方适配器

   严格依据 TapTap 小游戏成就官方 API（基础库 1.5.0+）实现：
   - tap.createAchievementManager({ toastEnable })：全局单例，不以 Promise 风格调用。
   - manager.registerListener({ onAchievementSuccess(code, achievement),
       onAchievementFailure(id, code, msg) })：结果经监听器异步回调。
   - manager.unlockAchievement({ achievementId })：不以 Promise 风格调用，
     解锁结果通过监听器通知（成功/失败）。重复解锁已解锁成就可能不再回调。
   - 成就 ID 必须是 TapTap 开发者平台已配置的 ID。

   设计纪律（第一阶段交付决定·九）：首版 toastEnable:true 保留游戏内 Toast，
   真机观测重复提示问题归为“真机手动测试项”，机器阶段不改。

   本适配器只负责把已确定的解锁事实上报平台，永不反向成为“是否解锁”的事实来源
   （权威事实仍为 gameState.achievements.unlockedAtById）。
   ================================================================ */
(function (root) {
  "use strict";

  const Contract = (typeof AchievementProviderContract !== "undefined") ? AchievementProviderContract
    : (root.AchievementProviderContract || {});
  const Base = (Contract.AchievementProvider) ? Contract.AchievementProvider : null;

  function TapTapAchievementProvider(opts) {
    opts = opts || {};
    this.platform = "taptap";
    this._manager = null;
    this._available = false;
    this._lastError = null;
    this._pending = {};        // platformId -> { resolve, reject, timer }
    this._timeoutMs = (typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) ? opts.timeoutMs : 8000;
  }
  if (Base) {
    TapTapAchievementProvider.prototype = Object.create(Base.prototype);
    TapTapAchievementProvider.prototype.constructor = TapTapAchievementProvider;
  }

  TapTapAchievementProvider.prototype.isAvailable = function () { return this._available; };
  TapTapAchievementProvider.prototype.getLastError = function () { return this._lastError; };

  function getTap() {
    if (typeof globalThis !== "undefined" && globalThis.tap) return globalThis.tap;
    if (typeof window !== "undefined" && window.tap) return window.tap;
    return null;
  }

  function normError(err, op) {
    err = err || {};
    const e = new Error(err.msg || err.errMsg || err.message || (op + " failed"));
    e.code = (typeof err.code === "number") ? err.code : (typeof err.errno === "number" ? err.errno : 0);
    e.errno = (typeof err.errno === "number") ? err.errno : e.code;
    e.errMsg = err.msg || err.errMsg || e.message;
    e.op = op;
    return e;
  }

  // 初始化：创建（或取回单例）成就管理器并注册全局监听器。
  TapTapAchievementProvider.prototype.initialize = function () {
    const self = this;
    return new Promise(function (resolve) {
      try {
        const tap = getTap();
        if (!tap || typeof tap.createAchievementManager !== "function") {
          self._available = false;
          resolve(false);
          return;
        }
        // 全局单例：多次调用返回同一实例。
        self._manager = tap.createAchievementManager({ toastEnable: true });
        if (!self._manager || typeof self._manager.registerListener !== "function"
            || typeof self._manager.unlockAchievement !== "function") {
          self._available = false;
          resolve(false);
          return;
        }
        self._registerListener();
        self._available = true;
        resolve(true);
      } catch (e) {
        self._lastError = e;
        self._available = false;
        resolve(false);
      }
    });
  };

  // 注册全局监听器，把异步结果路由到对应 platformId 的 pending Promise。
  TapTapAchievementProvider.prototype._registerListener = function () {
    const self = this;
    this._manager.registerListener({
      onAchievementSuccess: function (code, achievement) {
        const id = achievement && achievement.achievementId;
        self._settle(id, true, achievement);
      },
      onAchievementFailure: function (id, code, msg) {
        self._settle(id, false, { code: code, msg: msg });
      }
    });
  };

  TapTapAchievementProvider.prototype._settle = function (id, ok, payload) {
    const entry = (id != null) ? this._pending[id] : null;
    if (!entry) return; // 无对应 pending（如非本服务发起）→ 忽略
    delete this._pending[id];
    if (entry.timer) { try { clearTimeout(entry.timer); } catch (e) {} }
    // 明确失败 → resolve(false) 让上层入重试队列；成功 → resolve(true)。
    entry.resolve(ok ? true : false);
  };

  // 上报解锁：调用 unlockAchievement，结果经监听器回调；
  // 超时（如“已解锁不再回调”）按成功处理，避免重试队列死锁（真机观测重复提示归手动测试项）。
  TapTapAchievementProvider.prototype.unlock = function (platformAchievementId) {
    const self = this;
    if (!this._available || !this._manager) return Promise.resolve(false);
    if (!platformAchievementId) return Promise.resolve(false);
    return new Promise(function (resolve, reject) {
      try {
        const entry = { resolve: resolve, reject: reject, timer: null };
        self._pending[platformAchievementId] = entry;
        entry.timer = setTimeout(function () {
          if (self._pending[platformAchievementId] === entry) {
            delete self._pending[platformAchievementId];
            resolve(true); // 超时最优解：视为成功，防止无限重试
          }
        }, self._timeoutMs);
        self._manager.unlockAchievement({ achievementId: platformAchievementId });
      } catch (e) {
        if (self._pending[platformAchievementId] === entry) {
          delete self._pending[platformAchievementId];
        }
        if (entry.timer) { try { clearTimeout(entry.timer); } catch (er) {} }
        reject(normError(e, "unlockAchievement"));
      }
    });
  };

  // 设置进度（增量成就）。第一阶段子集 G01–G06 均为非进度型铜杯，
  // 若运行时支持 incrementAchievement 则透传，否则安全 no-op。
  TapTapAchievementProvider.prototype.setProgress = function (platformAchievementId, current, max) {
    if (!this._available || !this._manager) return Promise.resolve(false);
    if (!platformAchievementId) return Promise.resolve(false);
    if (typeof this._manager.incrementAchievement === "function") {
      const self = this;
      return new Promise(function (resolve) {
        try {
          self._manager.incrementAchievement({ achievementId: platformAchievementId, steps: current });
          resolve(true);
        } catch (e) { resolve(false); }
      });
    }
    return Promise.resolve(false);
  };

  // 批量对账：逐项 unlock，返回 [{ internalId, platformId, ok }]。
  TapTapAchievementProvider.prototype.reconcile = function (entries) {
    const self = this;
    if (!Array.isArray(entries)) return Promise.resolve([]);
    const tasks = entries.map(function (e) {
      const pid = e && (e.platformId || e.achievementId);
      return self.unlock(pid).then(function (ok) {
        return { internalId: (e && e.internalId) || null, platformId: pid, ok: !!ok };
      });
    });
    return Promise.all(tasks);
  };

  root.TapTapAchievementProvider = TapTapAchievementProvider;
  if (typeof window !== "undefined") window.TapTapAchievementProvider = TapTapAchievementProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = TapTapAchievementProvider;
})(typeof window !== "undefined" ? window : globalThis);
