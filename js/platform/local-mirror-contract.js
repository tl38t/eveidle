/* Device-local backup contract. Shared core never talks to tap/SteamBridge directly. */
(function (root) {
  "use strict";

  class LocalMirrorProvider {
    initialize() { return Promise.resolve(false); }
    isAvailable() { return false; }
    readSlots() { return Promise.resolve([]); }
    writeAtomic(/* encodedEnvelope */) { return Promise.reject(new Error("LocalMirrorProvider.writeAtomic 未实现")); }
    deleteAll() { return Promise.resolve(true); }
  }

  const api = {
    CURRENT_SLOT: "current",
    PREVIOUS_SLOT: "previous",
    FILE_NOT_FOUND: 1300002,
    LocalMirrorProvider
  };
  root.LocalMirrorContract = api;
  if (typeof window !== "undefined") window.LocalMirrorContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
