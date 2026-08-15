/* ================================================================
   AchievementSyncService — 平台无关的成就同步服务

   职责：
   - 监听现有 achievement:unlocked 事件（权威事实仍来自 gameState）。
   - 将内部成就 ID 经 PlatformAchievementMap 映射到平台 ID 后上报。
   - 平台失败不回滚本地成就与奖励；仅写入重试队列。
   - 启动后遍历 gameState.achievements.unlockedAtById 做补发对账。
   - 同一平台成就已成功上报后不重复调用（平台同步账本只记录“已上报”，
     绝不成为第二套“是否解锁”事实）。
   - 未配置平台映射的内部成就直接跳过，不报致命错误。

   普通浏览器使用 NoopAchievementProvider：unlock 安全 no-op，不影响本地。
   ================================================================ */
(function (root) {
  "use strict";

  const EVENT_BUS = (typeof GameEvents !== "undefined") ? GameEvents
    : (root.GameEvents || null);

  function InMemoryLedgerStore() { this._data = null; }
  InMemoryLedgerStore.prototype.load = function () { return this._data; };
  InMemoryLedgerStore.prototype.save = function (obj) { this._data = obj; return true; };

  function AchievementSyncService(opts) {
    opts = opts || {};
    this.provider = opts.provider || null;
    this.map = opts.map || (typeof PlatformAchievementMap !== "undefined" ? PlatformAchievementMap : null);
    this.platform = opts.platform || "taptap"; // 读取映射的哪一列
    this.metaStore = opts.metaStore || new InMemoryLedgerStore();
    this._available = false;
    this._ledger = this._loadLedger();   // internalId -> { syncedAt }
    this._retryQueue = [];               // [{ internalId, platformId }]
    this._subscribed = false;
    this._lastError = null;
    this._unsub = null;
  }

  AchievementSyncService.prototype._loadLedger = function () {
    const raw = (this.metaStore && typeof this.metaStore.load === "function") ? this.metaStore.load() : null;
    if (raw && typeof raw === "object" && raw.ledger && typeof raw.ledger === "object") return raw.ledger;
    return {};
  };

  AchievementSyncService.prototype._persistLedger = function () {
    try {
      if (this.metaStore && typeof this.metaStore.save === "function") {
        this.metaStore.save({ ledger: this._ledger });
      }
    } catch (e) { /* 非致命 */ }
  };

  AchievementSyncService.prototype.init = function () {
    const self = this;
    if (this.provider && typeof this.provider.initialize === "function") {
      return Promise.resolve(this.provider.initialize()).then(function (ok) {
        self._available = !!(self.provider && self.provider.isAvailable && self.provider.isAvailable());
        if (self._available) self._subscribe();
        return self._available;
      }).catch(function () { self._available = false; return false; });
    }
    this._available = false;
    return Promise.resolve(false);
  };

  AchievementSyncService.prototype.isAvailable = function () { return this._available; };
  AchievementSyncService.prototype.getLastError = function () { return this._lastError; };
  AchievementSyncService.prototype.getLedger = function () { return this._ledger; };
  AchievementSyncService.prototype.getRetryQueue = function () { return this._retryQueue.slice(); };

  AchievementSyncService.prototype._subscribe = function () {
    if (this._subscribed || !EVENT_BUS) return;
    const self = this;
    this._unsub = EVENT_BUS.on("achievement:unlocked", function (event) {
      try {
        const payload = (event && event.payload) || {};
        self.handleUnlock(payload.achievementId, payload.unlockedAt);
      } catch (e) { /* 监听回调不得影响游戏 */ }
    });
    this._subscribed = true;
  };

  // 读取某内部成就在当前平台对应的平台 ID；未配置返回 null（调用方跳过）。
  AchievementSyncService.prototype.getPlatformId = function (internalId) {
    if (!this.map) return null;
    const entry = (typeof this.map.get === "function") ? this.map.get(internalId) : this.map[internalId];
    if (!entry || typeof entry !== "object") return null;
    return (this.platform === "steam") ? (entry.steam || null) : (entry.taptap || null);
  };

  // 处理一次解锁事实：映射 → 上报 → 成功记账 / 失败入队。绝不回滚本地。
  AchievementSyncService.prototype.handleUnlock = function (internalId, unlockedAt) {
    if (!internalId) return { skipped: true, reason: "no-id" };
    if (!this._available || !this.provider) return { skipped: true, reason: "unavailable" };
    const platformId = this.getPlatformId(internalId);
    if (!platformId) return { skipped: true, reason: "no-mapping" }; // 未配置映射 → 跳过
    if (this._ledger[internalId]) return { skipped: true, reason: "already-synced" }; // 已上报 → 不重复
    return this._pushToProvider(internalId, platformId, unlockedAt);
  };

  AchievementSyncService.prototype._pushToProvider = function (internalId, platformId, unlockedAt) {
    const self = this;
    return Promise.resolve(this.provider.unlock(platformId)).then(function (ok) {
      if (ok) {
        self._ledger[internalId] = { syncedAt: (typeof unlockedAt === "number" ? unlockedAt : Date.now()) };
        self._persistLedger();
        return { ok: true };
      }
      // 平台明确未成功：入重试队列
      self._enqueueRetry(internalId, platformId);
      return { ok: false, reason: "provider-rejected" };
    }).catch(function (err) {
      self._lastError = err;
      self._enqueueRetry(internalId, platformId); // 失败入队，不回滚本地
      return { ok: false, reason: "error", error: err };
    });
  };

  AchievementSyncService.prototype._enqueueRetry = function (internalId, platformId) {
    const exists = this._retryQueue.some(function (e) { return e.internalId === internalId; });
    if (!exists) this._retryQueue.push({ internalId: internalId, platformId: platformId });
  };

  // 启动补发对账：遍历本地已解锁事实，对“有映射且未上报”的成就尝试补发。
  // unlockedById: { [internalId]: unlockedAt }
  AchievementSyncService.prototype.reconcileAll = function (unlockedById) {
    if (!unlockedById || typeof unlockedById !== "object") return 0;
    let attempted = 0;
    const self = this;
    Object.keys(unlockedById).forEach(function (internalId) {
      if (self._ledger[internalId]) return; // 已上报跳过
      const platformId = self.getPlatformId(internalId);
      if (!platformId) return; // 无映射跳过
      attempted++;
      self._pushToProvider(internalId, platformId, unlockedById[internalId]);
    });
    return attempted;
  };

  // 重试队列排空（由调用方在合适时机触发，例如网络恢复后）。
  AchievementSyncService.prototype.flushRetries = function () {
    const queue = this._retryQueue.slice();
    this._retryQueue = [];
    const self = this;
    queue.forEach(function (e) {
      self._pushToProvider(e.internalId, e.platformId, undefined);
    });
    return queue.length;
  };

  const api = AchievementSyncService;
  root.AchievementSyncService = api;
  if (typeof window !== "undefined") window.AchievementSyncService = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
