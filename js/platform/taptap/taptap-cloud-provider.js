/* ================================================================
   TapTapCloudProvider — TapTap 小游戏云存档官方适配器

   严格依据 TapTap 小游戏官方云存档 API（基础库 2.0.0+）实现，
   不凭经验猜测接口。官方要点：
   - 数据须先写入本地文件系统（FileSystemManager.writeFile），
     再把本地文件路径传给 createArchive / updateArchive 的 archiveFilePath。
   - createArchive 成功返回 { uuid, fileId }；uuid 永久不变，fileId 每次更新后变。
   - updateArchive 必传 archiveUUID（=create 返回的 uuid）。
   - getArchiveList 成功返回 { saves: [ArchiveDetailData] }，每项含
     uuid / fileId / name / summary / extra / saveSize / modifiedTime(秒级) 等。
   - getArchiveData({ archiveUUID, archiveFileId }) 成功返回 { filePath }（本地临时/指定文件）。
   - deleteArchive({ archiveUUID }) 成功返回 { uuid }。
   - 所有 fail 回调统一返回 { errMsg, errno }；错误码见 CloudSaveContract.TAPTAP_CLOUD_ERRORS。
   - create / update 共享“每分钟至多 1 次”频控（由 CloudSaveService 统一门禁），
     且不允许并发（本适配器再加 _opInFlight 防御，命中时以 400007 拒绝供上层重试）。

   本适配器只负责“云”与“平台文件”，绝不触碰 localStorage / gameState。
   ================================================================ */
(function (root) {
  "use strict";

  const Contract = (typeof CloudSaveContract !== "undefined") ? CloudSaveContract
    : (root.CloudSaveContract || { TAPTAP_CLOUD_ERRORS: {}, AUTO_SAVE_SLOT: "auto_save" });
  const ERRORS = Contract.TAPTAP_CLOUD_ERRORS || {};
  const Base = (Contract.CloudSaveProvider) ? Contract.CloudSaveProvider : null;

  // 存档名：≤60 字节、不允许空、不允许汉字 → 固定 ASCII。
  const ARCHIVE_NAME = "deep_space_idle_autosave";
  // 默认存档描述（英文，避免中文字节/平台限制问题；传入 summary 会做 ASCII 安全化）。
  const DEFAULT_SUMMARY = "Deep Space Idle auto-save";
  const LOCAL_FILE_NAME = "deep_space_idle_archive.json";

  function TapTapCloudProvider(opts) {
    opts = opts || {};
    this.platform = "taptap";
    this._tap = null;
    this._cloud = null;     // CloudSaveManager
    this._fs = null;        // FileSystemManager
    this._localPath = "";
    this._archiveUUID = null;   // 当前 auto_save 的 uuid（create 后固定）
    this._currentFileId = null; // 当前文件 fileId（update 后变化）
    this._lastSize = 0;
    this._available = false;
    this._lastError = null;
    this._opInFlight = false;   // create/update 并发防御
  }
  if (Base) {
    TapTapCloudProvider.prototype = Object.create(Base.prototype);
    TapTapCloudProvider.prototype.constructor = TapTapCloudProvider;
  }

  TapTapCloudProvider.prototype.isAvailable = function () { return this._available; };
  TapTapCloudProvider.prototype.getLastError = function () { return this._lastError; };

  // 规范化错误：统一暴露 code（errno）与 errMsg，供上层分类与真机诊断。
  function normError(err, op) {
    err = err || {};
    const code = (typeof err.errno === "number") ? err.errno
      : (typeof err.code === "number" ? err.code : (err.code || 0));
    const msg = err.errMsg || err.message || (op + " failed");
    const e = new Error(msg);
    e.code = code;
    e.errno = code;
    e.errMsg = msg;
    e.op = op;
    return e;
  }

  // 取得全局 tap 对象（与 PlatformRuntime 检测口径一致）。
  function getTap() {
    if (typeof globalThis !== "undefined" && globalThis.tap) return globalThis.tap;
    if (typeof window !== "undefined" && window.tap) return window.tap;
    return null;
  }

  // 初始化：检测能力 → 取管理器 → 解析已有存档 uuid（避免每次会话重复创建）。
  TapTapCloudProvider.prototype.initialize = function () {
    const self = this;
    return Promise.resolve().then(function () {
      const tap = getTap();
      if (!tap || typeof tap.getCloudSaveManager !== "function" || typeof tap.getFileSystemManager !== "function") {
        self._available = false;
        return false;
      }
      self._tap = tap;
      self._cloud = tap.getCloudSaveManager();
      self._fs = tap.getFileSystemManager();
      if (!self._cloud || !self._fs) { self._available = false; return false; }
      const base = (tap.env && tap.env.USER_DATA_PATH) ? tap.env.USER_DATA_PATH : ".";
      self._localPath = base.replace(/\/$/, "") + "/" + LOCAL_FILE_NAME;
      self._available = true;
      // 解析已有存档（按 name 匹配），使首次上传走 update 而非重复 create。
      return self._resolveExistingArchive().then(function () { return true; }, function () { return true; });
    }).catch(function (e) {
      self._lastError = e;
      self._available = false;
      return false;
    });
  };

  // 列出云端存档并锁定本游戏 auto_save 的 uuid/fileId。
  TapTapCloudProvider.prototype._resolveExistingArchive = function () {
    const self = this;
    return this.listArchives().then(function (metas) {
      const m = metas && metas[0];
      if (m) {
        self._archiveUUID = m.archiveId;
        self._currentFileId = m.platformMeta && m.platformMeta.fileId;
      }
    });
  };

  // 统一 ArchiveMeta：CloudSaveService 据此过滤 slotName 与下载。
  TapTapCloudProvider.prototype.listArchives = function () {
    const self = this;
    return new Promise(function (resolve, reject) {
      if (!self._cloud) { reject(normError({ errno: ERRORS.SDK_INIT_FAILED || 400100 }, "getArchiveList")); return; }
      self._cloud.getArchiveList({
        success: function (res) {
          const saves = (res && res.saves) || [];
          const metas = saves
            .filter(function (s) { return s && s.name === ARCHIVE_NAME; })
            .map(function (s) {
              return {
                slotName: Contract.AUTO_SAVE_SLOT,
                archiveId: s.uuid,
                modifiedAt: (typeof s.modifiedTime === "number") ? s.modifiedTime * 1000
                  : (typeof s.createdTime === "number" ? s.createdTime * 1000 : 0),
                size: (typeof s.saveSize === "number") ? s.saveSize : 0,
                platformMeta: { archiveUUID: s.uuid, fileId: s.fileId }
              };
            });
          resolve(metas);
        },
        fail: function (err) { reject(normError(err, "getArchiveList")); }
      });
    });
  };

  // 写本地文件（FileSystemManager.writeFile 回调式，官方云存档教程同款）。
  TapTapCloudProvider.prototype._writeLocal = function (json) {
    const self = this;
    return new Promise(function (resolve, reject) {
      if (!self._fs) { reject(normError({ errno: ERRORS.SDK_INIT_FAILED || 400100 }, "writeFile")); return; }
      const doWrite = function (fn) {
        fn({
          filePath: self._localPath,
          data: json,
          encoding: "utf-8",
          success: function () { resolve(self._localPath); },
          fail: function (err) { reject(normError(err, "writeFile")); }
        });
      };
      try {
        if (typeof self._fs.writeFile === "function") doWrite(self._fs.writeFile.bind(self._fs));
        else if (typeof self._fs.writeFileSync === "function") {
          // 防御性兼容：个别运行时仅暴露同步写。
          self._fs.writeFileSync(self._localPath, json, "utf-8");
          resolve(self._localPath);
        } else {
          reject(normError({ errno: ERRORS.SDK_INIT_FAILED || 400100 }, "writeFile"));
        }
      } catch (e) { reject(normError(e, "writeFile")); }
    });
  };

  // 读本地文件（getArchiveData 下载后的 filePath）。
  TapTapCloudProvider.prototype._readLocal = function (path) {
    const self = this;
    return new Promise(function (resolve, reject) {
      if (!self._fs) { reject(normError({ errno: ERRORS.SDK_INIT_FAILED || 400100 }, "readFile")); return; }
      const doRead = function (fn) {
        fn({
          filePath: path,
          encoding: "utf-8",
          success: function (res) {
            const data = (res && typeof res.data === "string") ? res.data : "";
            resolve(data);
          },
          fail: function (err) { reject(normError(err, "readFile")); }
        });
      };
      try {
        if (typeof self._fs.readFile === "function") doRead(self._fs.readFile.bind(self._fs));
        else if (typeof self._fs.readFileSync === "function") {
          const buf = self._fs.readFileSync(path, "utf-8");
          resolve(typeof buf === "string" ? buf : "");
        } else {
          reject(normError({ errno: ERRORS.SDK_INIT_FAILED || 400100 }, "readFile"));
        }
      } catch (e) { reject(normError(e, "readFile")); }
    });
  };

  // 安全化 summary：保留可打印 ASCII，截断至 500 字节，绝不为空。
  TapTapCloudProvider.prototype._safeSummary = function (summary) {
    let s = (typeof summary === "string") ? summary : "";
    s = s.replace(/[^\x20-\x7E]/g, "").trim();
    if (!s) s = DEFAULT_SUMMARY;
    if (s.length > 500) s = s.slice(0, 500);
    return s;
  };

  // 自定义扩展（≤1000 字节）：记录 schema 版本与设备，便于后台版本识别与清理。
  TapTapCloudProvider.prototype._extra = function (deviceId) {
    try {
      const obj = {
        v: (typeof SaveEnvelope !== "undefined") ? SaveEnvelope.GAME_SAVE_SCHEMA_VERSION : 1,
        d: (typeof deviceId === "string" && deviceId) ? deviceId : ""
      };
      const str = JSON.stringify(obj);
      return str.length > 1000 ? "" : str;
    } catch (e) { return ""; }
  };

  // 上传：先把 envelope 序列化写入本地文件，再 create（首传）或 update（续传）。
  TapTapCloudProvider.prototype.uploadArchive = function (req) {
    const self = this;
    req = req || {};
    const envelope = req.envelope;
    const summary = self._safeSummary(req.summary);
    const deviceId = envelope && typeof envelope.deviceId === "string" ? envelope.deviceId : "";
    const json = JSON.stringify(envelope);
    self._lastSize = (typeof json === "string") ? json.length : 0;

    return self._writeLocal(json).then(function (localPath) {
      if (self._opInFlight) {
        return Promise.reject(normError({ errno: ERRORS.CONCURRENCY_NOT_ALLOWED || 400007 }, "uploadArchive"));
      }
      self._opInFlight = true;
      const clear = function () { self._opInFlight = false; };
      const meta = {
        name: ARCHIVE_NAME,
        summary: summary,
        extra: self._extra(deviceId)
      };
      if (!self._archiveUUID) {
        return self._create(localPath, meta).then(function (r) { clear(); return r; }, function (e) { clear(); throw e; });
      }
      return self._update(localPath, meta).then(function (r) { clear(); return r; }, function (e) { clear(); throw e; });
    }).then(function (resultMeta) {
      // resultMeta: { uuid, fileId }
      return {
        slotName: Contract.AUTO_SAVE_SLOT,
        archiveId: resultMeta.uuid,
        modifiedAt: Date.now(),
        size: self._lastSize,
        platformMeta: { archiveUUID: resultMeta.uuid, fileId: resultMeta.fileId, archiveFileId: resultMeta.fileId }
      };
    });
  };

  TapTapCloudProvider.prototype._create = function (localPath, meta) {
    const self = this;
    return new Promise(function (resolve, reject) {
      self._cloud.createArchive({
        archiveMetaData: meta,
        archiveFilePath: localPath,
        success: function (res) {
          self._archiveUUID = res.uuid;
          self._currentFileId = res.fileId;
          resolve({ uuid: res.uuid, fileId: res.fileId });
        },
        fail: function (err) { reject(normError(err, "createArchive")); }
      });
    });
  };

  TapTapCloudProvider.prototype._update = function (localPath, meta) {
    const self = this;
    return new Promise(function (resolve, reject) {
      self._cloud.updateArchive({
        archiveUUID: self._archiveUUID,
        archiveMetaData: meta,
        archiveFilePath: localPath,
        success: function (res) {
          // uuid 不变，fileId 更新
          self._currentFileId = res.fileId;
          resolve({ uuid: self._archiveUUID, fileId: res.fileId });
        },
        fail: function (err) {
          const e = normError(err, "updateArchive");
          // 400002 存档不存在：清空引用，下次上传回退到 create（自愈）。
          if (e.code === (ERRORS.ARCHIVE_NOT_FOUND || 400002)) {
            self._archiveUUID = null;
            self._currentFileId = null;
          }
          reject(e);
        }
      });
    });
  };

  // 下载：getArchiveData → 读取返回 filePath 的本地文件 → 返回原始 JSON 字符串
  // （由 CloudSaveService 统一交给 SaveEnvelope.decode/verify 校验）。
  TapTapCloudProvider.prototype.downloadArchive = function (meta) {
    const self = this;
    const uuid = (meta && meta.archiveId) || (meta && meta.platformMeta && meta.platformMeta.archiveUUID);
    const fileId = (meta && meta.platformMeta && meta.platformMeta.fileId);
    if (!uuid || !fileId) {
      return Promise.reject(normError({ errno: ERRORS.ARCHIVE_UUID_EMPTY || 400201 }, "downloadArchive"));
    }
    return new Promise(function (resolve, reject) {
      self._cloud.getArchiveData({
        archiveUUID: uuid,
        archiveFileId: fileId,
        success: function (res) {
          const path = res && res.filePath;
          if (!path) { reject(normError({ errno: ERRORS.ARCHIVE_FILE_PATH_EMPTY || 400200 }, "getArchiveData")); return; }
          self._readLocal(path).then(resolve, reject);
        },
        fail: function (err) { reject(normError(err, "getArchiveData")); }
      });
    });
  };

  // 删除：deleteArchive({ archiveUUID })；成功后清空本地引用（不触碰本地 localStorage）。
  TapTapCloudProvider.prototype.deleteArchive = function (meta) {
    const self = this;
    const uuid = (meta && meta.archiveId) || (meta && meta.platformMeta && meta.platformMeta.archiveUUID);
    if (!uuid) {
      return Promise.reject(normError({ errno: ERRORS.ARCHIVE_UUID_EMPTY || 400201 }, "deleteArchive"));
    }
    return new Promise(function (resolve, reject) {
      self._cloud.deleteArchive({
        archiveUUID: uuid,
        success: function (res) {
          self._archiveUUID = null;
          self._currentFileId = null;
          resolve({ uuid: (res && res.uuid) || uuid });
        },
        fail: function (err) { reject(normError(err, "deleteArchive")); }
      });
    });
  };

  root.TapTapCloudProvider = TapTapCloudProvider;
  if (typeof window !== "undefined") window.TapTapCloudProvider = TapTapCloudProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = TapTapCloudProvider;
})(typeof window !== "undefined" ? window : globalThis);
