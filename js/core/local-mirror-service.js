/* Platform-neutral device mirror service. Envelopes are validated before selection. */
(function (root) {
  "use strict";
  const Envelope = root.SaveEnvelope;

  function LocalMirrorService(opts) {
    opts = opts || {};
    this.provider = opts.provider || null;
    this._available = false;
    this._initError = null;
    this._lastError = null;
    this._lastWriteAt = 0;
    this._pendingEnvelope = null;
    this._writePromise = null;
  }

  LocalMirrorService.prototype.init = function () {
    const self = this;
    if (!this.provider || typeof this.provider.initialize !== "function") return Promise.resolve(false);
    return Promise.resolve(this.provider.initialize()).then(function (ok) {
      self._available = !!ok && !!self.provider.isAvailable && self.provider.isAvailable();
      if (!self._available && self.provider.getLastError) self._initError = self.provider.getLastError();
      return self._available;
    }).catch(function (err) {
      self._initError = err;
      self._available = false;
      return false;
    });
  };
  LocalMirrorService.prototype.isAvailable = function () { return this._available; };
  LocalMirrorService.prototype.getLastError = function () { return this._lastError || this._initError; };
  LocalMirrorService.prototype.status = function () {
    // initError: provider initialization failure (when available===false).
    // lastError: most recent write/recovery failure (when available===true).
    // error: the most relevant of the two for UI display.
    const last = this.getLastError();
    return {
      available: this._available,
      busy: !!this._writePromise,
      lastWriteAt: this._lastWriteAt,
      initError: this._initError || null,
      lastError: this._lastError || null,
      error: last
    };
  };

  LocalMirrorService.prototype.readBest = function () {
    const self = this;
    if (!this._available || !this.provider) {
      return Promise.resolve(this._initError ? { status: "error", error: this._initError } : { status: "unavailable" });
    }
    return Promise.resolve(this.provider.readSlots()).then(function (slots) {
      const valid = [];
      const errors = [];
      let noneCount = 0;
      (Array.isArray(slots) ? slots : []).forEach(function (entry) {
        if (!entry || entry.status === "none") { noneCount += 1; return; }
        if (entry.status === "error") { errors.push(entry.error || new Error("设备镜像读取失败")); return; }
        try {
          const envelope = Envelope.decode(entry.data);
          valid.push({ slot: entry.slot || "unknown", envelope: envelope });
        } catch (e) { errors.push(e); }
      });
      if (valid.length) {
        valid.sort(function (a, b) {
          return (b.envelope.revision - a.envelope.revision) || (b.envelope.savedAt - a.envelope.savedAt) ||
            (a.slot === "current" ? -1 : 1);
        });
        return { status: "ok", slot: valid[0].slot, envelope: valid[0].envelope, warnings: errors };
      }
      if (errors.length) return { status: "error", error: errors[0], errors: errors };
      return { status: "none", checked: noneCount };
    }).catch(function (err) {
      self._lastError = err;
      return { status: "error", error: err };
    });
  };

  LocalMirrorService.prototype.scheduleWrite = function (envelope) {
    if (!this._available || !this.provider) return Promise.resolve({ ok: false, reason: "unavailable" });
    this._pendingEnvelope = Envelope.verify(envelope);
    if (this._writePromise) return this._writePromise;
    const self = this;
    function drain() {
      if (!self._pendingEnvelope) return Promise.resolve({ ok: true, idle: true });
      const next = self._pendingEnvelope;
      self._pendingEnvelope = null;
      return Promise.resolve(self.provider.writeAtomic(Envelope.encode(next))).then(function (result) {
        self._lastWriteAt = next.savedAt || Date.now();
        self._lastError = null;
        return self._pendingEnvelope ? drain() : result;
      }).catch(function (err) {
        self._lastError = err;
        // Keep the newest failed generation queued for an explicit/next-save retry.
        if (!self._pendingEnvelope) self._pendingEnvelope = next;
        throw err;
      });
    }
    this._writePromise = drain().finally(function () { self._writePromise = null; });
    return this._writePromise;
  };

  LocalMirrorService.prototype.retryPending = function () {
    if (this._writePromise) return this._writePromise;
    if (!this._pendingEnvelope) return Promise.resolve({ ok: true, idle: true });
    const queued = this._pendingEnvelope;
    this._pendingEnvelope = null;
    return this.scheduleWrite(queued);
  };

  LocalMirrorService.prototype.deleteAll = function () {
    const self = this;
    this._pendingEnvelope = null;
    const wait = this._writePromise ? this._writePromise.catch(function () {}) : Promise.resolve();
    return wait.then(function () {
      if (!self._available || !self.provider || typeof self.provider.deleteAll !== "function") return true;
      return self.provider.deleteAll();
    });
  };

  root.LocalMirrorService = LocalMirrorService;
  if (typeof window !== "undefined") window.LocalMirrorService = LocalMirrorService;
  if (typeof module !== "undefined" && module.exports) module.exports = LocalMirrorService;
})(typeof window !== "undefined" ? window : globalThis);
