/* ================================================================
   CloudSaveService — 平台无关的云存档同步状态机

   职责：
   - 持有统一 CloudSaveProvider，封装列表 / 下载 / 上传 / 删除。
   - 冲突判断（decideResolution）：依据本地、云端、上次云端 checksum 三方关系决策。
   - 上传频控：create/update 共用 60 秒严格门禁（dirty + debounce）。
   - 并发：同一时刻只允许一个 create/update/download 操作。
   - 错误分类与有限退避；任何错误都不得清空本地档。
   - 本地存档仍由 SaveManager 负责；本服务只管“云”与“同步元数据”。

   本地同步元数据（sync_meta）结构（由 persistence 持久化到
   localStorage["deep_space_idle_sync_meta"]，与 eve_idle_save 分离）：
   {
     deviceId,
     localRevision,
     localSavedAt,
     localChecksum,
     lastCloudChecksum,
     lastCloudArchiveId,
     lastSuccessfulSyncAt
   }
   ================================================================ */
(function (root) {
  "use strict";

  const Contract = (typeof CloudSaveContract !== "undefined") ? CloudSaveContract
    : (root.CloudSaveContract || { AUTO_SAVE_SLOT: "auto_save", CLOUD_UPLOAD_INTERVAL_MS: 60000 });
  const Envelope = (typeof SaveEnvelope !== "undefined") ? SaveEnvelope
    : (root.SaveEnvelope || null);

  // 默认内存元数据存储器（测试 / 无注入时使用）。生产由 persistence 注入 localStorage 实现。
  function InMemoryMetaStore() {
    this._data = null;
  }
  InMemoryMetaStore.prototype.load = function () { return this._data; };
  InMemoryMetaStore.prototype.save = function (obj) { this._data = obj; return true; };

  function CloudSaveService(opts) {
    opts = opts || {};
    this.provider = opts.provider || null;
    this.deviceId = opts.deviceId || "";
    this.metaStore = opts.metaStore || new InMemoryMetaStore();
    this.slotName = Contract.AUTO_SAVE_SLOT;
    this._uploadGateMs = Contract.CLOUD_UPLOAD_INTERVAL_MS;
    this._available = false;
    this._busy = false;        // 并发锁：同一时刻仅一个云操作
    this._dirty = false;       // 本地有未同步变更
    this._dirtyVersion = 0;    // saves occurring during an upload must remain dirty
    this._pendingSummary = null;
    this._lastUploadAt = 0;    // 最近一次“发起”上传的时刻（门禁基准）
    this._lastError = null;
    this._cloudArchiveMeta = null; // 最近一次成功查询到的云端 auto_save 元信息
    this._cloudRevision = 0;
    this._syncMeta = this._emptyMeta();
    this._state = "idle";      // idle | uploading | conflict | error | local-only
    this._gameSaveVersion = (typeof opts.gameSaveVersion === "number") ? opts.gameSaveVersion : 1;
  }

  CloudSaveService.prototype._emptyMeta = function () {
    return {
      deviceId: this.deviceId || "",
      localRevision: 0,
      localSavedAt: 0,
      localChecksum: "",
      lastCloudChecksum: "",
      lastCloudArchiveId: "",
      lastSuccessfulSyncAt: 0
    };
  };

  // 初始化 provider 并载入本地同步元数据。返回是否可用。
  CloudSaveService.prototype.init = function () {
    const self = this;
    this._syncMeta = this._mergeMeta(this.metaStore.load());
    if (this.provider && typeof this.provider.initialize === "function") {
      return Promise.resolve(this.provider.initialize()).then(function (ok) {
        self._available = !!(self.provider && self.provider.isAvailable && self.provider.isAvailable());
        self._state = self._available ? "idle" : "local-only";
        return self._available;
      }).catch(function () {
        self._available = false;
        self._state = "local-only";
        return false;
      });
    }
    self._available = false;
    self._state = "local-only";
    return Promise.resolve(false);
  };

  CloudSaveService.prototype._mergeMeta = function (raw) {
    const base = this._emptyMeta();
    if (!raw || typeof raw !== "object") return base;
    if (typeof raw.deviceId === "string") base.deviceId = raw.deviceId;
    if (typeof raw.localRevision === "number") base.localRevision = raw.localRevision;
    if (typeof raw.localSavedAt === "number") base.localSavedAt = raw.localSavedAt;
    if (typeof raw.localChecksum === "string") base.localChecksum = raw.localChecksum;
    if (typeof raw.lastCloudChecksum === "string") base.lastCloudChecksum = raw.lastCloudChecksum;
    if (typeof raw.lastCloudArchiveId === "string") base.lastCloudArchiveId = raw.lastCloudArchiveId;
    if (typeof raw.lastSuccessfulSyncAt === "number") base.lastSuccessfulSyncAt = raw.lastSuccessfulSyncAt;
    return base;
  };

  CloudSaveService.prototype.isAvailable = function () { return this._available; };
  CloudSaveService.prototype.getState = function () { return this._state; };
  CloudSaveService.prototype.getLastError = function () { return this._lastError; };
  CloudSaveService.prototype.getSyncMeta = function () { return this._syncMeta; };
  CloudSaveService.prototype.setSyncMeta = function (meta) { this._syncMeta = this._mergeMeta(meta); return this._syncMeta; };
  CloudSaveService.prototype.getCloudArchiveMeta = function () { return this._cloudArchiveMeta; };

  CloudSaveService.prototype.status = function () {
    return {
      available: this._available,
      state: this._state,
      platform: (this.provider && this.provider.platform) || "none",
      lastSuccessfulSyncAt: this._syncMeta.lastSuccessfulSyncAt,
      lastCloudChecksum: this._syncMeta.lastCloudChecksum,
      lastCloudArchiveId: this._syncMeta.lastCloudArchiveId,
      dirty: this._dirty,
      busy: this._busy
    };
  };

  // ===================== P1-2：错误分类与有限退避（真正落地） =====================
  // 可重试错误码：400001（频控，需等待 ≥上传门禁）/ 400006（瞬时）/ 400007（并发，当前操作完成后重试）/ 400008（重试）。
  // 不可重试或达到上限 → 向上抛出，由 fetchCloudEnvelope / uploadNow 转显式失败。绝不会无限循环。
  CloudSaveService.prototype._retryableCodes = { "400001": true, "400006": true, "400007": true, "400008": true };
  CloudSaveService.prototype._maxAttempts = 5;
  CloudSaveService.prototype._baseBackoffMs = 1000;
  // 退避等待默认走真实 setTimeout；测试可覆盖 this._sleep 为可控时钟（无真实等待）。
  CloudSaveService.prototype._sleep = function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  };
  CloudSaveService.prototype._errorCode = function (err) {
    if (err && (typeof err.code === "string" || typeof err.code === "number")) return String(err.code);
    return "";
  };
  CloudSaveService.prototype._executeWithRetry = function (fn, label) {
    const self = this;
    label = label || "op";
    let attempt = 0;
    function run() {
      attempt += 1;
      return Promise.resolve(fn()).catch(function (err) {
        const code = self._errorCode(err);
        const retryable = !!self._retryableCodes[code];
        if (!retryable || attempt >= self._maxAttempts) throw err; // 不可重试或已达上限 → 抛出
        // 退避：400001 等待 ≥上传门禁；其余指数退避（1s,2s,4s,8s…）。重试期间保留 dirty / busy。
        let delay = self._baseBackoffMs * Math.pow(2, attempt - 1);
        if (code === "400001") delay = Math.max(delay, self._uploadGateMs);
        return self._sleep(delay).then(function () { return run(); });
      });
    }
    return run();
  };

  // 列出云端存档（统一 ArchiveMeta 结构）。
  CloudSaveService.prototype.listCloudArchives = function () {
    if (!this._available || !this.provider) return Promise.resolve([]);
    return Promise.resolve(this.provider.listArchives());
  };

  // P0-6：查询并下载解码云端 auto_save，返回显式状态对象：
  //   { status:"none" }                       —— 云端列表成功但无该 slot 存档（允许开新档）
  //   { status:"ok", meta, envelope }         —— 下载 + 解码 + 校验成功
  //   { status:"error", error }               —— 网络/超时/损坏/校验失败（明确区别于 none）
  // 任何失败一律不抛错、绝不覆盖本地；显式 error 让调用方区分「无云档」与「查询失败」。
  CloudSaveService.prototype.fetchCloudEnvelope = function () {
    const self = this;
    if (!this._available || !this.provider) return Promise.resolve({ status: "none" });
    return this._executeWithRetry(function () {
      return Promise.resolve(self.provider.listArchives());
    }, "listArchives").then(function (archives) {
      const list = Array.isArray(archives) ? archives : [];
      const meta = list.filter(function (a) { return a && a.slotName === self.slotName; })[0] || null;
      if (!meta) {
        self._cloudArchiveMeta = null;
        self._state = "idle";
        self._lastError = null;
        return { status: "none" };
      }
      self._cloudArchiveMeta = meta;
      if (typeof meta.revision === "number") self._cloudRevision = meta.revision;
      return self._executeWithRetry(function () {
        return Promise.resolve(self.provider.downloadArchive(meta));
      }, "downloadArchive").then(function (envelope) {
        let parsed = null;
        try {
          parsed = (typeof envelope === "string") ? Envelope.decode(envelope) : Envelope.verify(envelope);
        } catch (e) {
          return { status: "error", error: e };
        }
        if (!parsed) return { status: "error", error: new Error("云端存档解码或校验失败") };
        if (typeof parsed.revision === "number") self._cloudRevision = parsed.revision;
        self._state = "idle";
        self._lastError = null;
        return { status: "ok", meta: meta, envelope: parsed };
      });
    }).catch(function (err) {
      self._lastError = err;
      self._state = "error";
      return { status: "error", error: err }; // 明确 error，而非 null / none
    });
  };

  // 冲突决策（纯函数，便于直接单测）。
  // ctx: { hasLocal, hasCloud, localChecksum, cloudChecksum, lastCloudChecksum }
  CloudSaveService.decideResolution = function (ctx) {
    const c = ctx || {};
    const hasLocal = !!c.hasLocal;
    const hasCloud = !!c.hasCloud;
    const localChecksum = c.localChecksum;
    const cloudChecksum = c.cloudChecksum;
    const lastCloudChecksum = c.lastCloudChecksum;

    if (!hasLocal && !hasCloud) return { decision: "new" };
    if (hasLocal && !hasCloud) return { decision: "use-local" };
    if (!hasLocal && hasCloud) return { decision: "use-cloud" };

    // 两侧都有
    if (localChecksum === cloudChecksum) return { decision: "identical" };
    if (cloudChecksum === lastCloudChecksum && localChecksum !== lastCloudChecksum) {
      return { decision: "use-local" }; // 只有本地变化
    }
    if (localChecksum === lastCloudChecksum && cloudChecksum !== lastCloudChecksum) {
      return { decision: "use-cloud" }; // 只有云端变化
    }
    // 双边都不等于 lastCloudChecksum（含无 lastCloudChecksum 且两边不同）→ 真实冲突
    return { decision: "conflict" };
  };

  CloudSaveService.prototype.decideResolution = CloudSaveService.decideResolution;

  // 标记本地有未同步变更（供 debounce 上传使用）。
  CloudSaveService.prototype.markDirty = function (summary) {
    this._dirty = true;
    this._dirtyVersion += 1;
    if (summary) this._pendingSummary = summary;
  };

  // debounce 上传：受 60s 门禁与并发锁约束；命中门禁/锁则仅置脏并返回 reason。
  CloudSaveService.prototype.maybeUpload = function (payload, summary) {
    if (!this._available || !this.provider) return Promise.resolve({ ok: false, reason: "unavailable" });
    if (!this._dirty) return Promise.resolve({ ok: true, reason: "clean" });
    const now = Date.now();
    if (this._busy) { this._dirty = true; this._pendingSummary = summary || this._pendingSummary; return Promise.resolve({ ok: false, reason: "concurrency" }); }
    if (now - this._lastUploadAt < this._uploadGateMs) { this._dirty = true; this._pendingSummary = summary || this._pendingSummary; return Promise.resolve({ ok: false, reason: "rate-limited" }); }
    return this.uploadNow(payload, summary);
  };

  // 立即上传（忽略 debounce 门禁，但仍受并发锁约束）。返回 { ok, meta?, reason?, error? }。
  CloudSaveService.prototype.uploadNow = function (payload, summary) {
    const self = this;
    if (!this._available || !this.provider) return Promise.resolve({ ok: false, reason: "unavailable" });
    if (this._busy) return Promise.resolve({ ok: false, reason: "concurrency" });
    this._busy = true;
    const uploadDirtyVersion = this._dirtyVersion;
    this._state = "uploading";
    this._lastUploadAt = Date.now(); // 门禁基准：发起即计时
    const revision = Math.max(this._syncMeta.localRevision || 0, this._cloudRevision || 0) + 1;
    const savedAt = Date.now();
    const envelope = Envelope.create({
      payload: payload,
      revision: revision,
      deviceId: this.deviceId,
      savedAt: savedAt,
      gameSaveVersion: this._gameSaveVersion
    });
    const doUpload = function () {
      return Promise.resolve(self.provider.uploadArchive({
        slotName: self.slotName,
        envelope: envelope,
        summary: summary || self._pendingSummary || ""
      }));
    };
    // P1-2：上传同样走有限退避；重试期间保持 _busy，最终成功/失败才释放锁（绝不无限循环）。
    return this._executeWithRetry(doUpload, "uploadArchive")
      .then(function (resultMeta) {
        const meta = resultMeta || {};
        self._cloudArchiveMeta = meta;
        if (typeof meta.archiveId === "string") self._syncMeta.lastCloudArchiveId = meta.archiveId;
        self._syncMeta.lastCloudChecksum = envelope.checksum;
        self._syncMeta.lastSuccessfulSyncAt = savedAt;
        self._cloudRevision = revision;
        self._dirty = self._dirtyVersion !== uploadDirtyVersion;
        self._state = "idle";
        self._lastError = null;
        self._busy = false; // 成功：释放锁
        self._persistMeta();
        return { ok: true, meta: meta, envelope: envelope };
      })
      .catch(function (err) {
        self._lastError = err;
        self._state = "error";
        self._dirty = true;
        self._busy = false; // 最终失败才释放锁（_executeWithRetry 已耗尽重试）
        return { ok: false, reason: (err && err.code) || "error", error: err };
      });
  };

  CloudSaveService.prototype._persistMeta = function () {
    try {
      if (this.metaStore && typeof this.metaStore.save === "function") this.metaStore.save(this._syncMeta);
    } catch (e) { /* 元数据持久化失败不致命，由调用方决定宣布同步成功与否 */ }
  };

  // 将本地校验信息写入 sync_meta（由 persistence 在本地保存成功后调用）。
  CloudSaveService.prototype.recordLocal = function (localChecksum, savedAt, revision) {
    if (typeof localChecksum === "string") this._syncMeta.localChecksum = localChecksum;
    if (typeof savedAt === "number") this._syncMeta.localSavedAt = savedAt;
    if (typeof revision === "number") this._syncMeta.localRevision = revision;
    if (this.deviceId && !this._syncMeta.deviceId) this._syncMeta.deviceId = this.deviceId;
    this._persistMeta();
  };

  CloudSaveService.prototype.recordCloudBaseline = function (checksum, archiveId) {
    if (typeof checksum === "string") this._syncMeta.lastCloudChecksum = checksum;
    if (typeof archiveId === "string") this._syncMeta.lastCloudArchiveId = archiveId;
    this._persistMeta();
    return this._syncMeta;
  };

  // 永久删除云端存档。规则：先成功删除云端，不得因本地删除逻辑而误删本地。
  // 删除失败 → 抛错，调用方不得继续删除本地。
  CloudSaveService.prototype.deleteCloud = function () {
    const self = this;
    if (!this._available || !this.provider) return Promise.reject(new Error("云端不可用，无法删除"));
    const meta = this._cloudArchiveMeta;
    if (!meta) return Promise.reject(new Error("没有可删除的云端存档"));
    return Promise.resolve(this.provider.deleteArchive(meta)).then(function () {
      self._cloudArchiveMeta = null;
      self._cloudRevision = 0;
      self._syncMeta.lastCloudChecksum = "";
      self._syncMeta.lastCloudArchiveId = "";
      self._persistMeta();
      return true;
    });
  };

  const api = CloudSaveService;
  root.CloudSaveService = api;
  if (typeof window !== "undefined") window.CloudSaveService = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
