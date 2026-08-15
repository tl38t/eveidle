/* Web fallback: localStorage remains the only device-local writer. */
(function (root) {
  "use strict";
  function NoopLocalMirrorProvider() { this.platform = "web"; }
  NoopLocalMirrorProvider.prototype.initialize = function () { return Promise.resolve(false); };
  NoopLocalMirrorProvider.prototype.isAvailable = function () { return false; };
  NoopLocalMirrorProvider.prototype.readSlots = function () { return Promise.resolve([]); };
  NoopLocalMirrorProvider.prototype.writeAtomic = function () { return Promise.resolve({ ok: false, reason: "unavailable" }); };
  NoopLocalMirrorProvider.prototype.deleteAll = function () { return Promise.resolve(true); };
  root.NoopLocalMirrorProvider = NoopLocalMirrorProvider;
  if (typeof window !== "undefined") window.NoopLocalMirrorProvider = NoopLocalMirrorProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = NoopLocalMirrorProvider;
})(typeof window !== "undefined" ? window : globalThis);
