/* Steam achievement adapter. The shared game code talks only to window.SteamBridge. */
(function (root) {
  "use strict";

  const Contract = (typeof AchievementProviderContract !== "undefined") ? AchievementProviderContract
    : (root.AchievementProviderContract || {});
  const Base = Contract.AchievementProvider || null;

  function SteamAchievementProvider(opts) {
    opts = opts || {};
    this.platform = "steam";
    this._available = false;
    this._lastError = null;
    this._timeoutMs = (typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) ? opts.timeoutMs : 8000;
  }
  if (Base) {
    SteamAchievementProvider.prototype = Object.create(Base.prototype);
    SteamAchievementProvider.prototype.constructor = SteamAchievementProvider;
  }

  SteamAchievementProvider.prototype.isAvailable = function () { return this._available; };
  SteamAchievementProvider.prototype.getLastError = function () { return this._lastError; };

  function getBridge() {
    const g = (typeof globalThis !== "undefined") ? globalThis : root;
    return g && g.SteamBridge ? g.SteamBridge : null;
  }

  function invoke(bridge, method, args, timeoutMs) {
    if (!bridge || typeof bridge[method] !== "function") return Promise.resolve(false);
    return new Promise(function (resolve) {
      let settled = false;
      const finish = function (ok) { if (!settled) { settled = true; resolve(ok !== false); } };
      const timer = setTimeout(function () { finish(true); }, timeoutMs);
      try {
        const result = bridge[method].apply(bridge, args.concat(function (ok) {
          clearTimeout(timer); finish(ok);
        }));
        if (result && typeof result.then === "function") {
          result.then(function (value) { clearTimeout(timer); finish(value); }, function () {
            clearTimeout(timer); finish(false);
          });
        } else if (result === true || result === false) {
          clearTimeout(timer); finish(result);
        }
      } catch (e) {
        clearTimeout(timer); finish(false);
      }
    });
  }

  SteamAchievementProvider.prototype.initialize = function () {
    const self = this;
    return new Promise(function (resolve) {
      const bridge = getBridge();
      if (!bridge) { self._available = false; resolve(false); return; }
      const ready = (typeof bridge.init === "function") ? invoke(bridge, "init", [], self._timeoutMs) : Promise.resolve(true);
      ready.then(function (ok) { self._available = ok !== false; resolve(self._available); });
    }).catch(function (err) {
      self._lastError = err; self._available = false; return false;
    });
  };

  SteamAchievementProvider.prototype.unlock = function (platformAchievementId) {
    if (!this._available || !platformAchievementId) return Promise.resolve(false);
    return invoke(getBridge(), "unlockAchievement", [platformAchievementId], this._timeoutMs);
  };

  SteamAchievementProvider.prototype.setProgress = function (platformStatId, current, max) {
    if (!this._available || !platformStatId) return Promise.resolve(false);
    const value = Math.max(0, Number(current) || 0);
    const limit = Math.max(0, Number(max) || 0);
    return invoke(getBridge(), "setStat", [platformStatId, value, limit], this._timeoutMs);
  };

  SteamAchievementProvider.prototype.reconcile = function (entries) {
    const self = this;
    if (!Array.isArray(entries)) return Promise.resolve([]);
    return Promise.all(entries.map(function (entry) {
      const id = entry && (entry.platformId || entry.achievementId);
      return self.unlock(id).then(function (ok) {
        return { internalId: entry && entry.internalId || null, platformId: id, ok: !!ok };
      });
    }));
  };

  root.SteamAchievementProvider = SteamAchievementProvider;
  if (typeof window !== "undefined") window.SteamAchievementProvider = SteamAchievementProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = SteamAchievementProvider;
})(typeof window !== "undefined" ? window : globalThis);
