/*
 * TapTap durable device mirror.
 *
 * Files are deliberately separate from deep_space_idle_archive.json, which is only
 * the cloud-upload staging file. A write is: tmp write -> tmp read-back -> rotate
 * current to previous -> rename tmp to current. Both generations are retained.
 */
(function (root) {
  "use strict";
  const Contract = root.LocalMirrorContract || {};
  const Base = Contract.LocalMirrorProvider || null;
  const NOT_FOUND = Contract.FILE_NOT_FOUND || 1300002;
  const NAMES = {
    current: "deep_space_idle_device_backup.json",
    previous: "deep_space_idle_device_backup.previous.json",
    temporary: "deep_space_idle_device_backup.tmp.json"
  };

  // Map the async options object onto the positional argument list that the
  // synchronous FileSystemManager method expects. Without this, renameSync
  // would receive (filePath, data) and break the dual-slot rotation.
  function syncArgsFor(opts, syncName) {
    switch (syncName) {
      case "renameSync": return [opts.oldPath, opts.newPath];
      case "unlinkSync": return [opts.filePath];
      case "writeFileSync": return [opts.filePath, opts.data, opts.encoding];
      case "readFileSync": return [opts.filePath, opts.encoding];
      default: return [];
    }
  }

  function normalizeError(err, op, path) {
    err = err || {};
    const rawCode = (err.errno !== undefined) ? err.errno : err.code;
    const code = Number(rawCode) || rawCode || 0;
    const message = err.errMsg || err.message || (op + " failed");
    const out = new Error(message);
    out.code = code;
    out.errno = code;
    out.errMsg = message;
    out.op = op;
    out.path = path || "";
    return out;
  }

  // Decide whether a FileSystemManager failure means "the file is absent"
  // (a normal state for a missing current/previous generation), rather than a
  // real I/O error. TapTap H5 does NOT always return errno=1300002; it may only
  // surface a human-readable errMsg such as "readFile fail: File does not exist".
  // permission denied / I/O error / system error must NEVER be treated as missing.
  function isFileNotFound(err) {
    if (!err) return false;
    const rawCode = (err.errno !== undefined && err.errno !== null) ? err.errno
      : (err.code !== undefined && err.code !== null ? err.code : undefined);
    if (rawCode === 1300002 || rawCode === "1300002") return true;
    const raw = err.errMsg || err.message || "";
    if (typeof raw !== "string" || !raw) return false;
    const cleaned = raw.toLowerCase()
      .replace(/^(?:readfile|unlink|writefile|rename)\s*fail\s*:\s*/, "")
      .trim();
    return cleaned === "file does not exist" || cleaned === "no such file or directory";
  }

  function getTap() {
    if (typeof globalThis !== "undefined" && globalThis.tap) return globalThis.tap;
    if (typeof window !== "undefined" && window.tap) return window.tap;
    return null;
  }

  function TapTapLocalMirrorProvider() {
    this.platform = "taptap";
    this._fs = null;
    this._paths = null;
    this._available = false;
    this._lastError = null;
  }
  if (Base) {
    TapTapLocalMirrorProvider.prototype = Object.create(Base.prototype);
    TapTapLocalMirrorProvider.prototype.constructor = TapTapLocalMirrorProvider;
  }

  TapTapLocalMirrorProvider.prototype.initialize = function () {
    try {
      const tap = getTap();
      if (!tap || typeof tap.getFileSystemManager !== "function") {
        this._available = false;
        this._lastError = new Error("tap.getFileSystemManager 不可用");
        return Promise.resolve(false);
      }
      const fs = tap.getFileSystemManager();
      const canRead = fs && (typeof fs.readFile === "function" || typeof fs.readFileSync === "function");
      const canWrite = fs && (typeof fs.writeFile === "function" || typeof fs.writeFileSync === "function");
      const canRename = fs && (typeof fs.rename === "function" || typeof fs.renameSync === "function");
      const canUnlink = fs && (typeof fs.unlink === "function" || typeof fs.unlinkSync === "function");
      if (!canRead || !canWrite || !canUnlink) {
        this._available = false;
        this._lastError = new Error("文件能力 read=" + canRead + " write=" + canWrite +
          " rename=" + canRename + " unlink=" + canUnlink +
          " [async:" + [typeof fs.readFile, typeof fs.writeFile, typeof fs.rename, typeof fs.unlink].join(",") +
          "; sync:" + [typeof fs.readFileSync, typeof fs.writeFileSync, typeof fs.renameSync, typeof fs.unlinkSync].join(",") + "]");
        return Promise.resolve(false);
      }
      // TapTap H5 compatibility builds may omit tap.env while still exposing a
      // working FileSystemManager (the cloud adapter already supports this case).
      const base = String(tap.env && tap.env.USER_DATA_PATH ? tap.env.USER_DATA_PATH : ".").replace(/\/$/, "");
      this._fs = fs;
      this._canRename = !!canRename;
      this._paths = {
        current: base + "/" + NAMES.current,
        previous: base + "/" + NAMES.previous,
        temporary: base + "/" + NAMES.temporary
      };
      this._available = true;
      return Promise.resolve(true);
    } catch (e) {
      this._lastError = normalizeError(e, "initialize");
      this._available = false;
      return Promise.resolve(false);
    }
  };
  TapTapLocalMirrorProvider.prototype.isAvailable = function () { return this._available; };
  TapTapLocalMirrorProvider.prototype.getLastError = function () { return this._lastError; };
  TapTapLocalMirrorProvider.prototype.getPaths = function () { return this._paths ? Object.assign({}, this._paths) : null; };

  // Invoke a FileSystemManager method, settling via EITHER the success/fail
  // callbacks OR a returned Promise (TapTap H5 exposes some methods as
  // AsyncFunctions that resolve a Promise and never call the callbacks). A
  // once-guard guarantees the provider promise settles at most once even if the
  // implementation fires both paths. Sync methods are the last-resort fallback.
  TapTapLocalMirrorProvider.prototype._invoke = function (asyncName, syncName, opts, op, path) {
    const self = this;
    return new Promise(function (resolve, reject) {
      let done = false;
      function settle(ok, value) {
        if (done) return;
        done = true;
        if (ok) resolve(value); else reject(normalizeError(value, op, path));
      }
      const o = Object.assign({}, opts);
      o.success = function (res) { settle(true, res); };
      o.fail = function (err) { settle(false, err); };
      const asyncFn = self._fs && typeof self._fs[asyncName] === "function" ? self._fs[asyncName] : null;
      const syncFn = self._fs && typeof self._fs[syncName] === "function" ? self._fs[syncName] : null;
      if (asyncFn) {
        let returned;
        try { returned = asyncFn.call(self._fs, o); }
        catch (e) { settle(false, e); return; }
        // A returned thenable is the authoritative completion. The callback path
        // is still wired in case the implementation calls it instead.
        if (returned && typeof returned.then === "function") {
          returned.then(function (res) { settle(true, res); }, function (err) { settle(false, err); });
        }
        return;
      }
      if (syncFn) {
        try { resolve(syncFn.apply(self._fs, syncArgsFor(opts, syncName))); }
        catch (e) { reject(normalizeError(e, op, path)); }
        return;
      }
      reject(normalizeError(new Error("FileSystemManager 缺少 " + asyncName + " / " + syncName), op, path));
    });
  };

  TapTapLocalMirrorProvider.prototype._read = function (path, op) {
    op = op || "readFile";
    const self = this;
    return self._invoke("readFile", "readFileSync", { filePath: path, encoding: "utf8" }, op, path)
      .then(function (res) {
        let data;
        if (typeof res === "string") data = res;
        else data = res && typeof res.data === "string" ? res.data : (res && res.data != null ? String(res.data) : "");
        return { status: "ok", data: data };
      })
      .catch(function (err) {
        const n = normalizeError(err, op, path);
        return isFileNotFound(n) ? { status: "none" } : { status: "error", error: n };
      });
  };

  TapTapLocalMirrorProvider.prototype._write = function (path, data, op) {
    op = op || "writeFile";
    return this._invoke("writeFile", "writeFileSync", { filePath: path, data: data, encoding: "utf8" }, op, path)
      .then(function () { return true; })
      .catch(function (err) { throw normalizeError(err, op, path); });
  };

  TapTapLocalMirrorProvider.prototype._unlink = function (path, missingIsSuccess, op) {
    op = op || "unlink";
    const self = this;
    return self._invoke("unlink", "unlinkSync", { filePath: path }, op, path)
      .then(function () { return true; })
      .catch(function (err) {
        const n = normalizeError(err, op, path);
        if (missingIsSuccess && isFileNotFound(n)) return true;
        throw n;
      });
  };

  TapTapLocalMirrorProvider.prototype._rename = function (oldPath, newPath, op) {
    op = op || "rename";
    return this._invoke("rename", "renameSync", { oldPath: oldPath, newPath: newPath }, op, oldPath)
      .then(function () { return true; })
      .catch(function (err) { throw normalizeError(err, op, oldPath); });
  };

  TapTapLocalMirrorProvider.prototype.readSlots = function () {
    if (!this._available || !this._paths) return Promise.resolve([]);
    const self = this;
    return Promise.all([
      self._read(self._paths.current, "read-current").then(function (r) { r.slot = Contract.CURRENT_SLOT || "current"; return r; }),
      self._read(self._paths.previous, "read-previous").then(function (r) { r.slot = Contract.PREVIOUS_SLOT || "previous"; return r; })
    ]);
  };

  TapTapLocalMirrorProvider.prototype.writeAtomic = function (encodedEnvelope) {
    if (!this._available || !this._paths) return Promise.reject(normalizeError(new Error("TapTap 本地镜像不可用"), "writeAtomic", ""));
    const self = this;
    const paths = self._paths;
    let currentExists = false;
    let currentData = "";
    // Best effort only: a failed step must never delete a valid current/previous
    // generation, and the reported error keeps its originating op.
    function fail(err, fallbackOp, p) {
      const op = (err && err.op) ? err.op : fallbackOp;
      const path = p || (err && err.path) || paths.temporary;
      self._lastError = normalizeError(err, op, path);
      return self._unlink(paths.temporary, true, "unlink-temporary").catch(function () {}).then(function () { throw self._lastError; });
    }
    return self._write(paths.temporary, encodedEnvelope, "write-temporary")
      .then(function () { return self._read(paths.temporary, "verify-temporary"); })
      .then(function (verifyRead) {
        if (!verifyRead || verifyRead.status !== "ok" || verifyRead.data !== encodedEnvelope) {
          throw normalizeError(new Error("TapTap 本地镜像临时文件回读不一致"), "verify-temporary", paths.temporary);
        }
        return self._read(paths.current, "read-current");
      })
      .then(function (current) {
        if (current.status === "error") throw current.error;
        currentExists = current.status === "ok";
        currentData = currentExists ? current.data : "";
        if (!currentExists) return true;
        if (self._canRename) {
          return self._unlink(paths.previous, true, "unlink-previous")
            .then(function () { return self._rename(paths.current, paths.previous, "rename-to-previous"); });
        }
        // TapTap H5 currently exposes read/write/unlink but no rename. Copy the
        // validated current generation into previous and verify it before the
        // current slot is overwritten. A crash at any step leaves at least one
        // valid generation.
        return self._write(paths.previous, currentData, "copy-previous")
          .then(function () { return self._read(paths.previous, "verify-previous"); })
          .then(function (previousVerify) {
            if (!previousVerify || previousVerify.status !== "ok" || previousVerify.data !== currentData) {
              throw normalizeError(new Error("TapTap 本地镜像上一代回读不一致"), "verify-previous", paths.previous);
            }
            return true;
          });
      })
      .then(function () {
        if (self._canRename) return self._rename(paths.temporary, paths.current, "rename-to-current");
        return self._write(paths.current, encodedEnvelope, "write-current")
          .then(function () { return self._read(paths.current, "verify-current"); })
          .then(function (currentVerify) {
            if (!currentVerify || currentVerify.status !== "ok" || currentVerify.data !== encodedEnvelope) {
              throw normalizeError(new Error("TapTap 本地镜像当前代回读不一致"), "verify-current", paths.current);
            }
            return self._unlink(paths.temporary, true, "unlink-temporary");
          });
      })
      .then(function () { return { ok: true, rotated: currentExists }; })
      .catch(function (err) {
        return fail(err, "writeAtomic");
      });
  };

  TapTapLocalMirrorProvider.prototype.deleteAll = function () {
    if (!this._available || !this._paths) return Promise.resolve(true);
    const self = this;
    return self._unlink(self._paths.temporary, true)
      .then(function () { return self._unlink(self._paths.previous, true); })
      .then(function () { return self._unlink(self._paths.current, true); });
  };

  root.TapTapLocalMirrorProvider = TapTapLocalMirrorProvider;
  if (typeof window !== "undefined") window.TapTapLocalMirrorProvider = TapTapLocalMirrorProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = TapTapLocalMirrorProvider;
})(typeof window !== "undefined" ? window : globalThis);
