/* ================================================================
   NoopCloudProvider — 无云服务的本地模式

   纪律（第一阶段交付决定·三）：
   - 现有 SaveManager 是唯一的本地存档写入者。
   - NoopCloudProvider 只表示“当前无云服务”，绝不接管 localStorage。
   - 它不实现一套本地保存逻辑；CloudSaveService 调用 Noop 时返回 unavailable / local-only。
   - 禁止出现 SaveManager 与 NoopProvider 两个本地写入者。
   ================================================================ */
(function (root) {
  "use strict";

  function NoopCloudProvider() {
    this._lastError = "local-only";
  }

  NoopCloudProvider.prototype.isAvailable = function () { return false; };
  NoopCloudProvider.prototype.initialize = function () { return Promise.resolve(false); };
  NoopCloudProvider.prototype.listArchives = function () { return Promise.resolve([]); };
  NoopCloudProvider.prototype.downloadArchive = function () {
    return Promise.reject(new Error("NoopCloudProvider: 无云服务，无法下载"));
  };
  NoopCloudProvider.prototype.uploadArchive = function () {
    return Promise.reject(new Error("NoopCloudProvider: 无云服务，无法上传"));
  };
  NoopCloudProvider.prototype.deleteArchive = function () {
    return Promise.reject(new Error("NoopCloudProvider: 无云服务，无法删除"));
  };
  NoopCloudProvider.prototype.getLastError = function () { return this._lastError; };

  root.NoopCloudProvider = NoopCloudProvider;
  if (typeof window !== "undefined") window.NoopCloudProvider = NoopCloudProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = NoopCloudProvider;
})(typeof window !== "undefined" ? window : globalThis);
