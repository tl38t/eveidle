/* ================================================================
   CloudSaveProvider 统一契约（平台无关）

   共享核心只认识本契约定义的结构，绝不直接出现 tap / SteamBridge。
   所有平台适配器（TapTap / 未来 Steam）必须实现以下接口。

   统一 archive 元结构（provider 返回 / 接收）：
   {
     slotName,        // 固定 "auto_save"
     archiveId,       // 平台存档唯一 ID（TapTap 为 uuid）
     modifiedAt,      // 数字时间戳（毫秒）
     size,            // 字节
     platformMeta     // 平台私有扩展（如 fileId）
   }

   接口方法（全部异步，返回 Promise）：
   - isAvailable()
   - initialize()
   - listArchives()
   - downloadArchive(meta)
   - uploadArchive({ slotName, envelope, summary })
   - deleteArchive(meta)
   - getLastError()
   ================================================================ */
(function (root) {
  "use strict";

  const AUTO_SAVE_SLOT = "auto_save";

  // create/update 共用上传频控：同一玩家任意一次成功或发起后，至少间隔该毫秒数。
  const CLOUD_UPLOAD_INTERVAL_MS = 60000;

  // 小游戏云存档基础库最低版本。
  const TAPTAP_MIN_BASE_LIB = "2.0.0";

  // TapTap 云存档错误码（官方文档）：优先读取 errno / errMsg。
  const TAPTAP_CLOUD_ERRORS = Object.freeze({
    FILE_ILLEGAL: 400000,          // 文件/封面大小非法：永久失败
    UPLOAD_RATE_LIMIT: 400001,     // 上传频率超限：延迟重试
    ARCHIVE_NOT_FOUND: 400002,     // 存档不存在：重新拉列表
    ARCHIVE_COUNT_LIMIT: 400003,   // 存档数量超限：提示玩家
    CLOUD_SPACE_LIMIT: 400005,     // 云空间超限：提示玩家
    TOKEN_EXPIRED: 400006,         // 操作令牌失效/网络耗时过长：可重试
    CONCURRENCY_NOT_ALLOWED: 400007, // 不允许并发：串行化后重试
    NO_OSS: 400008,                // 无可用OSS：网络/平台失败，可重试
    NAME_ILLEGAL: 400009,          // 名称非法：代码配置错误，不循环重试
    SDK_INIT_FAILED: 400100,       // 云存档SDK初始化失败：本次会话降级本地
    ARCHIVE_FILE_NOT_FOUND: 400101, // archiveFilePath文件不存在：代码/文件写入错误
    ARCHIVE_FILE_PATH_EMPTY: 400200, // archiveFilePath为空：代码错误
    ARCHIVE_UUID_EMPTY: 400201,    // archiveUUID为空：代码错误
    ARCHIVE_FILE_ID_EMPTY: 400202  // archiveFileId为空：代码错误
  });

  // 基础抽象类：所有具体 provider 继承并实现接口。
  class CloudSaveProvider {
    isAvailable() { return false; }
    initialize() { return Promise.resolve(false); }
    listArchives() { return Promise.resolve([]); }
    downloadArchive(/* meta */) { return Promise.reject(new Error("CloudSaveProvider.downloadArchive 未实现")); }
    uploadArchive(/* { slotName, envelope, summary } */) { return Promise.reject(new Error("CloudSaveProvider.uploadArchive 未实现")); }
    deleteArchive(/* meta */) { return Promise.reject(new Error("CloudSaveProvider.deleteArchive 未实现")); }
    getLastError() { return null; }
  }

  const api = {
    AUTO_SAVE_SLOT,
    CLOUD_UPLOAD_INTERVAL_MS,
    TAPTAP_MIN_BASE_LIB,
    TAPTAP_CLOUD_ERRORS,
    CloudSaveProvider
  };

  root.CloudSaveContract = api;
  if (typeof window !== "undefined") window.CloudSaveContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
