// 行星自动续期一键诊断（可打包进正式构建）
// 用途：玩家/客服在「研究 → 行星维护自动化」面板点「🔍 一键诊断」即可自查为何基地不续期，
//       并把报告复制发回。控制台亦可直接 window.diagnosePlanauto() 调用。
// 覆盖：总开关解锁/启用、逐基地开关、星币是否够、储备线、以及「系统时间被改导致时间锚点冻结」。
(function () {
  "use strict";

  function getNow() { return Date.now(); }

  function fmtMs(ms) {
    if (!isFinite(ms) || ms <= 0) return "0秒";
    const s = Math.round(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    let out = "";
    if (d) out += d + "天";
    if (h) out += h + "时";
    if (m) out += m + "分";
    if (!d && !h && !m) out += ss + "秒";
    return out;
  }

  function isUnlocked(state) {
    return !!(state && state.research && state.research.completedLevels && state.research.completedLevels.planauto >= 1);
  }
  function isMasterEnabled(state) {
    return !!(state && state.research && state.research.protocolSettings &&
      state.research.protocolSettings.planauto && state.research.protocolSettings.planauto.enabled === true);
  }
  function getRenewCost(state, planetType) {
    if (typeof getPlanetRenewCostISK === "function" && typeof PLANET_TYPES !== "undefined") {
      const cfg = PLANET_TYPES.find(function (p) { return p.id === planetType; });
      if (cfg) return getPlanetRenewCostISK(state, cfg);
    }
    return null;
  }
  function getISK(state) {
    if (typeof ResourceRegistry !== "undefined" && ResourceRegistry && typeof ResourceRegistry.get === "function") {
      return Number(ResourceRegistry.get(state, "currency:isk")) || 0;
    }
    return Number((state && state.resources && state.resources.isk) || 0);
  }

  // 主入口：返回结构化报告并打 console 表。opts.state 可传入（测试用），否则读全局 gameState。
  function runPlanautoDiagnostics(opts) {
    opts = opts || {};
    const state = (typeof gameState !== "undefined" && gameState) ? gameState : (opts.state || null);
    if (!state) return { error: "no gameState" };
    const now = getNow();
    const report = {
      generatedAt: new Date(now).toISOString(),
      now: now,
      masterUnlocked: isUnlocked(state),
      masterEnabled: isMasterEnabled(state),
      isk: getISK(state),
      rows: [],
      summary: ""
    };
    const deployments = (state.planetary && Array.isArray(state.planetary.deployments)) ? state.planetary.deployments : [];
    for (let i = 0; i < deployments.length; i++) {
      const dep = deployments[i];
      if (!dep || typeof dep !== "object") continue;
      const planetType = dep.planetType;
      const cost = getRenewCost(state, planetType);
      const ar = (dep.autoRenew && typeof dep.autoRenew === "object") ? dep.autoRenew : null;
      const arEnabled = !!(ar && ar.enabled === true);
      const reserve = (ar && typeof ar.minIskReserve === "number" && isFinite(ar.minIskReserve) && ar.minIskReserve >= 0) ? ar.minIskReserve : 0;
      const isk = report.isk;
      // 时间锚点异常检测（疑似改过系统时间：deployedAt/lastTick 落在未来）
      const depFuture = Number(dep.deployedAt) > now;
      const tickFuture = Number(dep.lastTick) > now;
      let freeze = "NONE", freezeDelta = 0;
      if (depFuture) { freeze = "FROZEN_DEPLOYED_AT_FUTURE"; freezeDelta = Number(dep.deployedAt) - now; }
      else if (tickFuture) { freeze = "FROZEN_LASTTICK_FUTURE"; freezeDelta = Number(dep.lastTick) - now; }

      let verdict, reason;
      if (!report.masterUnlocked) { verdict = "FAIL"; reason = "总开关未解锁（需先在研究树点亮「行星维护自动化」）"; }
      else if (!report.masterEnabled) { verdict = "FAIL"; reason = "协议总开关未启用"; }
      else if (!arEnabled) { verdict = "FAIL"; reason = "该基地「自动续期」开关未开（总开关开了 ≠ 此基地开了）"; }
      else if (cost == null) { verdict = "WARN"; reason = "无法计算续期费（未知星球类型）"; }
      else if (isk < cost) { verdict = "FAIL"; reason = "星币不足（需 " + cost.toLocaleString("zh-CN") + "，现有 " + Math.floor(isk).toLocaleString("zh-CN") + "）"; }
      else if (isk - cost < reserve) { verdict = "FAIL"; reason = "最低星币储备卡住（需续期后留 " + reserve.toLocaleString("zh-CN") + "，续期后仅剩 " + Math.floor(isk - cost).toLocaleString("zh-CN") + "）"; }
      else if (freeze !== "NONE") { verdict = "FAIL"; reason = "时间锚点冻结（疑似改过系统时间，时间戳落在未来 " + fmtMs(freezeDelta) + " 后才会恢复续期）"; }
      else if (!dep.active) { verdict = "INFO"; reason = "基地已过期未激活，但续期条件已全部满足，下次 tick/结算将自动补续期"; }
      else { verdict = "OK"; reason = "条件满足，到期那一刻应自动续期"; }

      report.rows.push({
        id: dep.id, planetType: planetType, active: !!dep.active,
        masterUnlocked: report.masterUnlocked, masterEnabled: report.masterEnabled,
        autoRenewEnabled: arEnabled, minIskReserve: reserve,
        isk: Math.floor(isk), renewCost: (cost == null ? null : Math.round(cost)),
        iskEnough: cost == null ? null : isk >= cost,
        reserveMet: cost == null ? null : (isk - cost) >= reserve,
        deployedAt: Number(dep.deployedAt) || 0, lastTick: Number(dep.lastTick) || 0,
        freeze: freeze, freezeDelta: freezeDelta, verdict: verdict, reason: reason
      });
    }
    const ok = report.rows.filter(function (r) { return r.verdict === "OK"; }).length;
    const fails = report.rows.filter(function (r) { return r.verdict === "FAIL"; }).length;
    const frozen = report.rows.filter(function (r) { return r.freeze !== "NONE"; }).length;
    report.summary = "基地 " + report.rows.length + " 个 ｜ 正常 " + ok + " ｜ 异常 " + fails +
      (frozen ? " ｜ 冻结(疑似改系统时间) " + frozen : "");
    if (typeof console !== "undefined") {
      console.log("[行星自动续期诊断] " + report.summary);
      for (let j = 0; j < report.rows.length; j++) {
        const r = report.rows[j];
        console.log("  ·", r.id, r.planetType, "[" + r.verdict + "]", r.reason,
          "| 逐基地开关=" + r.autoRenewEnabled, "续期费=" + r.renewCost, "星币=" + r.isk,
          r.freeze !== "NONE" ? "freeze=" + r.freeze : "");
      }
    }
    return report;
  }

  function buildReportText(report) {
    const lines = [];
    lines.push("=== 行星自动续期诊断 " + report.generatedAt + " ===");
    lines.push("总开关解锁：" + report.masterUnlocked + " ｜ 总开关启用：" + report.masterEnabled + " ｜ 星币：" + Math.floor(report.isk).toLocaleString("zh-CN"));
    lines.push(report.summary);
    lines.push("");
    if (!report.rows.length) lines.push("（当前没有行星基地）");
    for (let i = 0; i < report.rows.length; i++) {
      const r = report.rows[i];
      lines.push("# " + r.id + " (" + r.planetType + ") [" + r.verdict + "] " + r.reason);
      lines.push("   逐基地开关=" + r.autoRenewEnabled + " ｜ 最低储备=" + r.minIskReserve +
        " ｜ 续期费=" + (r.renewCost == null ? "?" : r.renewCost.toLocaleString("zh-CN")) + " ｜ 星币=" + r.isk.toLocaleString("zh-CN"));
      lines.push("   deployedAt=" + r.deployedAt + " ｜ lastTick=" + r.lastTick +
        (r.freeze !== "NONE" ? " ｜ 冻结=" + r.freeze + " 差值=" + r.freezeDelta + "ms(" + fmtMs(r.freezeDelta) + ")" : ""));
    }
    return lines.join("\n");
  }

  function renderModal(report) {
    if (typeof document === "undefined") return;
    const text = buildReportText(report);
    let overlay = document.getElementById("planauto-diag-overlay");
    if (overlay) overlay.parentNode && overlay.parentNode.removeChild(overlay);
    overlay = document.createElement("div");
    overlay.id = "planauto-diag-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;z-index:99999;";
    const box = document.createElement("div");
    box.style.cssText = "background:#15171c;color:#e8e8e8;max-width:92vw;width:560px;max-height:82vh;overflow:auto;padding:16px 18px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);font-family:ui-monospace,Menlo,Consolas,monospace;";
    const title = document.createElement("div");
    title.textContent = "🔍 行星自动续期诊断";
    title.style.cssText = "font-size:15px;font-weight:700;margin-bottom:8px;";
    const pre = document.createElement("pre");
    pre.textContent = text;
    pre.style.cssText = "white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;margin:0 0 12px;max-height:60vh;overflow:auto;";
    const bar = document.createElement("div");
    const copy = document.createElement("button");
    copy.textContent = "复制报告";
    copy.style.cssText = "margin-right:8px;padding:6px 12px;cursor:pointer;";
    copy.onclick = function () {
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
        } else if (typeof document !== "undefined" && document.execCommand) {
          const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
          ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
        }
        copy.textContent = "已复制 ✓";
      } catch (e) { copy.textContent = "复制失败"; }
      setTimeout(function () { copy.textContent = "复制报告"; }, 1500);
    };
    const close = document.createElement("button");
    close.textContent = "关闭";
    close.style.cssText = "padding:6px 12px;cursor:pointer;";
    close.onclick = function () { overlay.parentNode && overlay.parentNode.removeChild(overlay); };
    bar.appendChild(copy); bar.appendChild(close);
    box.appendChild(title); box.appendChild(pre); box.appendChild(bar);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  if (typeof window !== "undefined") {
    window.diagnosePlanauto = function (showModal) {
      const report = runPlanautoDiagnostics();
      if (showModal) renderModal(report);
      return report;
    };
    window.diagnosePlanautoReport = function () { return buildReportText(runPlanautoDiagnostics()); };
    window.openPlanautoDiagnostics = function () { renderModal(runPlanautoDiagnostics()); };
  }
})();

/* ================================================================
   云存档 / 存档链路一键诊断（玩家侧，不依赖控制台）

   背景：TapTap 小游戏沙盒 / 真机容器内无法打开控制台，客服与玩家都无法读取
        SaveManager 内部状态。此模块把关键诊断信息渲染成可复制的纯文本报告，
        入口是游戏内按钮（设置 → 存档管理，以及启动冲突浮层），全程不依赖
        URL 参数与控制台。

   覆盖：
   - 本地写盘是否失败（真实异常名/消息，含配额超限）
   - 存档体积与 localStorage 各键占用（判断是否撞 5MB 配额）
   - 设备镜像（设备文件备份）可用性与失败原因
   - 云同步状态机、syncMeta（revision / 云端校验和 / 上次成功同步时间）
   - 云端归档列表（数量 + 时间 + 体积）→ 检测「多档 / 读旧写新」
   - 启动冲突现场（本地与云端信封的保存时间、内容摘要、校验和前缀）

   隐私：只输出 uuid / checksum 前 8 位与路径 basename；
        绝不输出存档内容、玩家 ID、Token、deviceId、完整路径。
   ================================================================ */
(function () {
  "use strict";

  const ARCHIVE_FETCH_TIMEOUT_MS = 8000;
  const SIZE_WARN_CHARS = 2500000;   // 本地存档字符数预警线
  const SIZE_FAIL_CHARS = 3500000;   // 接近 localStorage 常规配额
  const LOCAL_QUOTA_BYTES = 5 * 1024 * 1024;
  const CLOUD_LAG_WARN_MS = 15 * 60 * 1000;

  function num(v) { return (typeof v === "number" && isFinite(v)) ? v : 0; }
  function p8(s) { return (typeof s === "string" && s.length) ? s.slice(0, 8) : ""; }
  // 注意：SaveEnvelope.checksum 是「规范化 payload 全量 JSON」，不是哈希。
  // 直接截前 8 位无意义（永远是 "{\"_dirty" 之类），且会带出存档内容片段。
  // 这里改为长度 + 32 位 djb2 摘要，既能比较两侧是否一致，又不泄露内容。
  function digestOf(s) {
    if (typeof s !== "string" || !s.length) return "";
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return "#" + (h >>> 0).toString(16) + "(len=" + s.length + ")";
  }
  function fmtTime(ts) {
    if (!num(ts)) return "—";
    try { return new Date(ts).toLocaleString("zh-CN", { hour12: false }); } catch (e) { return String(ts); }
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(num(sec)));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return d + " 天 " + h + " 时";
    if (h) return h + " 时 " + m + " 分";
    return m + " 分";
  }
  function fmtIsk(v) { return (v == null || !isFinite(v)) ? "未知" : Math.floor(v).toLocaleString("zh-CN"); }
  function fmtBytes(n) {
    n = num(n);
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }
  function describeErr(e) {
    if (!e) return "（无）";
    const name = e.name || "Error";
    const code = (e.code !== undefined && e.code !== null && e.code !== "") ? String(e.code) : ((e.errno !== undefined && e.errno !== null && e.errno !== 0) ? String(e.errno) : "");
    const msg = e.errMsg || e.message || String(e);
    return name + (code ? " code=" + code : "") + ": " + msg;
  }
  function basenameOf(p) {
    if (typeof p !== "string") return "";
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return i >= 0 ? p.slice(i + 1) : p;
  }
  function stateOf(SM) {
    if (typeof gameState !== "undefined" && gameState) return gameState;
    return null;
  }
  function summarizePayload(payload) {
    const s = payload || {};
    const skills = s.skills || {};
    let skillsN = 0, skillsLvl = 0;
    Object.keys(skills).forEach(function (k) {
      const v = skills[k];
      if (v && typeof v === "object") { skillsN += 1; skillsLvl += num(v.lvl); }
    });
    const ships = Array.isArray(s.ships) ? s.ships.length : (s.ships && typeof s.ships === "object" ? Object.keys(s.ships).length : 0);
    // 星币一律经 ResourceRegistry 读取（禁止直接访问旧资源池），取不到时返回 null 由展示层显示「未知」。
    let isk = null;
    try {
      if (typeof ResourceRegistry !== "undefined" && ResourceRegistry && typeof ResourceRegistry.get === "function") {
        isk = num(ResourceRegistry.get(s, "currency:isk"));
      }
    } catch (e) { isk = null; }
    return {
      lastSaveTime: num(s.lastSaveTime),
      playSeconds: num(s.stats && (s.stats.playSeconds || s.stats.totalPlaySeconds)),
      skillsN: skillsN, skillsLvl: skillsLvl, shipsN: ships, isk: (isk == null ? null : Math.floor(isk))
    };
  }

  // localStorage 各键占用（UTF-16 下 1 字符 ≈ 2 字节）。
  function scanStorage() {
    const out = { supported: false, entries: [], totalBytes: 0, totalChars: 0, error: null };
    try {
      if (typeof localStorage === "undefined" || !localStorage) return out;
      out.supported = true;
      const len = localStorage.length || 0;
      for (let i = 0; i < len; i++) {
        let k = null;
        try { k = localStorage.key(i); } catch (e) { continue; }
        if (k == null) continue;
        let v = null;
        try { v = localStorage.getItem(k); } catch (e) { v = null; }
        const chars = (typeof v === "string") ? v.length : 0;
        out.entries.push({ key: k, chars: chars, bytes: chars * 2 });
      }
      out.entries.sort(function (a, b) { return b.bytes - a.bytes; });
      out.totalChars = out.entries.reduce(function (s, e) { return s + e.chars; }, 0);
      out.totalBytes = out.entries.reduce(function (s, e) { return s + e.bytes; }, 0);
    } catch (e) {
      out.error = describeErr(e);
    }
    return out;
  }

  // 同步采集（不发起网络）：本地 / 存储 / 镜像 / 云状态机 / 冲突现场。
  function collectSync() {
    const SM = (typeof window !== "undefined") ? window.SaveManager : undefined;
    const state = stateOf(SM);
    const rep = {
      generatedAt: new Date().toISOString(),
      appVersion: (function () {
        // 版本标记：index.html 头部占位声明 / 构建时注入（tools/build-taptap-h5.mjs 写入 window.GAME_VERSION）。
        try {
          if (typeof window !== "undefined" && window.GAME_VERSION) return String(window.GAME_VERSION).slice(0, 40);
        } catch (e) {}
        return "";
      })(),
      env: {}, local: {}, storage: null, storageError: null,
      mirror: null, cloud: null, conflict: null, verdicts: []
    };

    // ---- 环境 ----
    let url = "";
    try { url = (window.location && window.location.origin ? window.location.origin : "") + (window.location && window.location.pathname ? window.location.pathname : ""); } catch (e) {}
    const provider = SM && SM._cloudSave ? SM._cloudSave.provider : null;
    rep.env = {
      platform: (provider && provider.platform) || (typeof window !== "undefined" && window.tap ? "taptap(未初始化)" : "desktop-or-web"),
      url: url,
      viewport: (typeof window !== "undefined" && window.innerWidth) ? (window.innerWidth + "x" + window.innerHeight) : "?",
      ua: (typeof navigator !== "undefined" && navigator.userAgent) ? String(navigator.userAgent).slice(0, 120) : "?",
      elapsedSec: (typeof performance !== "undefined" && performance.now) ? Math.round(performance.now() / 1000) : -1,
      bootState: (SM && typeof SM.getBootState === "function") ? String(SM.getBootState()) : "?"
    };

    // ---- 本地存档 ----
    let payloadChars = -1, payloadErr = null;
    if (state) {
      try { payloadChars = JSON.stringify(state).length; } catch (e) { payloadErr = describeErr(e); }
    }
    rep.local = {
      hasState: !!state,
      lastSaveTime: state ? num(state.lastSaveTime) : 0,
      lastSaveTimeText: state ? fmtTime(state.lastSaveTime) : "—",
      dirty: !!(SM && SM._dirty),
      payloadChars: payloadChars,
      payloadSerializeError: payloadErr,
      managerPresent: !!SM
    };
    rep.storage = scanStorage();
    const saveEntry = rep.storage.entries.filter(function (e) { return e.key === "eve_idle_save"; })[0];
    rep.local.saveKeyChars = saveEntry ? saveEntry.chars : -1;

    const se = SM && SM._lastStorageError;
    rep.storageError = se ? { name: se.name || "Error", code: (se.code !== undefined && se.code !== null) ? String(se.code) : "", message: se.message || String(se) } : null;

    // ---- 设备镜像（设备文件备份） ----
    const mirror = SM && SM._localMirror;
    let mStatus = null;
    try { mStatus = (mirror && typeof mirror.status === "function") ? mirror.status() : null; } catch (e) {}
    rep.mirror = {
      present: !!mirror,
      available: !!(mStatus && mStatus.available),
      busy: !!(mStatus && mStatus.busy),
      lastWriteAt: mStatus ? num(mStatus.lastWriteAt) : 0,
      lastWriteAtText: mStatus ? fmtTime(mStatus.lastWriteAt) : "—",
      syncFailed: !!(SM && SM._mirrorSyncFailed),
      error: (function () {
        const err = (mStatus && (mStatus.error || mStatus.initError)) || (mirror && typeof mirror.getLastError === "function" ? mirror.getLastError() : null) || (SM && SM._lastMirrorError);
        if (!err) return null;
        return { op: err.op || "?", code: (err.code !== undefined && err.code !== null) ? String(err.code) : "", message: String(err.errMsg || err.message || ""), file: basenameOf(err.path) };
      })()
    };

    // ---- 云端 ----
    const cs = SM && SM._cloudSave;
    if (!cs) {
      rep.cloud = { present: false };
    } else {
      let st = {}, meta = null;
      try { st = (typeof cs.status === "function") ? cs.status() : {}; } catch (e) {}
      try { meta = (typeof cs.getSyncMeta === "function") ? cs.getSyncMeta() : null; } catch (e) {}
      let lastErr = null;
      try { lastErr = (typeof cs.getLastError === "function") ? cs.getLastError() : null; } catch (e) {}
      rep.cloud = {
        present: true,
        available: !!st.available,
        state: st.state || "?",
        platform: st.platform || "?",
        dirty: !!st.dirty,
        busy: !!st.busy,
        syncFailedFlag: !!(SM && SM._cloudSyncFailed),
        lastSuccessfulSyncAt: num(st.lastSuccessfulSyncAt),
        lastSuccessfulSyncAtText: fmtTime(st.lastSuccessfulSyncAt),
        lastCloudArchiveIdPrefix: p8(st.lastCloudArchiveId),
        lastCloudChecksumDigest: digestOf(st.lastCloudChecksum),
        localRevision: meta ? num(meta.localRevision) : 0,
        providerArchiveUUIDPrefix: provider ? p8(provider._archiveUUID) : "",
        providerFileIdPrefix: provider ? p8(provider._currentFileId) : "",
        lastError: lastErr ? { name: lastErr.name || "Error", code: (lastErr.code !== undefined && lastErr.code !== null) ? String(lastErr.code) : "", message: String(lastErr.errMsg || lastErr.message || lastErr) } : null
      };
    }

    // ---- 启动冲突现场 ----
    try {
      const dev = SM && SM._pendingDeviceCandidate && SM._pendingDeviceCandidate.envelope ? SM._pendingDeviceCandidate.envelope : null;
      const clo = SM && SM._pendingCloudEnvelope && SM._pendingCloudEnvelope.envelope ? SM._pendingCloudEnvelope.envelope : null;
      if (dev || clo) {
        const summarize = function (env) {
          if (!env) return null;
          const s = summarizePayload(env.payload);
          return {
            savedAt: num(env.savedAt), savedAtText: fmtTime(env.savedAt),
            revision: num(env.revision), checksumDigest: digestOf(env.checksum),
            lastSaveTime: s.lastSaveTime, lastSaveTimeText: fmtTime(s.lastSaveTime),
            playSeconds: s.playSeconds, skillsN: s.skillsN, skillsLvl: s.skillsLvl, shipsN: s.shipsN, isk: s.isk,
            chars: (function () { try { return JSON.stringify(env.payload).length; } catch (e) { return -1; } })()
          };
        };
        rep.conflict = { local: summarize(dev), cloud: summarize(clo) };
      }
    } catch (e) {}

    return rep;
  }

  // 云端归档列表（异步；带超时，避免启动阻塞态下永久等待）。
  function collectArchives() {
    const SM = (typeof window !== "undefined") ? window.SaveManager : undefined;
    const cs = SM && SM._cloudSave;
    if (!cs || typeof cs.isAvailable !== "function" || !cs.isAvailable() || typeof cs.listCloudArchives !== "function") {
      return Promise.resolve({ available: false, count: -1, list: [], error: null });
    }
    let p;
    try { p = Promise.resolve(cs.listCloudArchives()); } catch (e) {
      return Promise.resolve({ available: true, count: -1, list: [], error: describeErr(e) });
    }
    const timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve({ available: true, count: -1, list: [], error: "列表超时未响应（" + ARCHIVE_FETCH_TIMEOUT_MS + "ms）" }); }, ARCHIVE_FETCH_TIMEOUT_MS);
    });
    return Promise.race([p, timeout]).then(function (metas) {
      const list = (Array.isArray(metas) ? metas : []).map(function (m) {
        return {
          uuidPrefix: p8(m && m.archiveId),
          modifiedAt: num(m && m.modifiedAt),
          modifiedAtText: fmtTime(m && m.modifiedAt),
          size: num(m && m.size),
          slot: (m && m.slotName) || ""
        };
      }).sort(function (a, b) { return b.modifiedAt - a.modifiedAt; });
      return { available: true, count: list.length, list: list, error: null };
    }).catch(function (e) {
      return { available: true, count: -1, list: [], error: describeErr(e) };
    });
  }

  // 判定：把数据翻译成「结论 + 该修哪条」。
  function buildVerdicts(rep) {
    const v = [];
    const push = function (level, text) { v.push({ level: level, text: text }); };
    const loc = rep.local || {}, cloud = rep.cloud || {}, st = rep.storage || {}, arc = rep.archives || {};

    // 1. 本地写盘失败
    if (rep.storageError) {
      const quota = /quota|exceed|storage full|1014/i.test(rep.storageError.name + " " + rep.storageError.message);
      push("FAIL", "本地写盘失败：" + rep.storageError.name + (rep.storageError.code ? " code=" + rep.storageError.code : "") + " — " + rep.storageError.message + (quota ? "（配额超限：本地存储已写满，存档无法再更新）" : ""));
    } else {
      push("OK", "本地写盘无异常（本次会话未记录到 storage 错误）");
    }

    // 2. 体积
    const bigChars = Math.max(num(loc.saveKeyChars), num(loc.payloadChars));
    if (bigChars >= SIZE_FAIL_CHARS) push("FAIL", "存档体积 " + bigChars.toLocaleString("zh-CN") + " 字符（约 " + fmtBytes(bigChars * 2) + "）已逼近 localStorage 常规 5MB 配额，极易触发写盘失败");
    else if (bigChars >= SIZE_WARN_CHARS) push("WARN", "存档体积 " + bigChars.toLocaleString("zh-CN") + " 字符（约 " + fmtBytes(bigChars * 2) + "）偏大，建议关注是否存在无上限增长的数组");
    else push("OK", "存档体积正常：" + (bigChars >= 0 ? bigChars.toLocaleString("zh-CN") + " 字符（约 " + fmtBytes(bigChars * 2) + "）" : "无法测量"));

    // 3. localStorage 总占用
    if (st.supported && st.totalBytes > 0) {
      const pct = Math.round(st.totalBytes / LOCAL_QUOTA_BYTES * 100);
      if (pct >= 100) push("FAIL", "localStorage 总占用 " + fmtBytes(st.totalBytes) + "（估计已达上限的 " + pct + "%）");
      else if (pct >= 80) push("WARN", "localStorage 总占用 " + fmtBytes(st.totalBytes) + "（估计达上限的 " + pct + "%），余量不足");
      else push("OK", "localStorage 总占用 " + fmtBytes(st.totalBytes) + "（估计达上限的 " + pct + "%）");
    }
    if (st.error) push("FAIL", "读取 localStorage 本身报错：" + st.error);

    // 3b. 同步元数据键成本：SaveEnvelope.checksum 存的是「全量规范化 payload」而非哈希，
    //     导致 sync_meta 键几乎与存档本体同体积 → 本地存储成本接近翻倍，提前撞 5MB 配额。
    const metaEntry = (st.entries || []).filter(function (e) { return e.key === "deep_space_idle_sync_meta"; })[0];
    if (metaEntry && loc.saveKeyChars > 0 && metaEntry.chars > loc.saveKeyChars * 0.5) {
      push("WARN", "同步元数据键占 " + metaEntry.chars.toLocaleString("zh-CN") + " 字符，是存档本体（" + loc.saveKeyChars.toLocaleString("zh-CN") + " 字符）的 " +
        Math.round(metaEntry.chars / loc.saveKeyChars * 100) + "% —— 其中 localChecksum 存的是整份存档的规范化序列化（并非哈希），" +
        "使本地存储实际成本接近翻倍，会显著提前撞 localStorage 配额并触发写盘失败");
    }

    // 4. 云端可用性与同步
    if (!cloud.present) {
      push("WARN", "未找到云同步服务实例（可能是纯本地环境）");
    } else if (!cloud.available) {
      push("WARN", "云端不可用（当前按本地模式运行，不会有任何云端备份）");
    } else {
      if (!cloud.lastSuccessfulSyncAt) {
        push("FAIL", "云端从未成功同步过（lastSuccessfulSyncAt 为空）——云端没有任何进度");
      } else if (num(loc.lastSaveTime) - cloud.lastSuccessfulSyncAt > CLOUD_LAG_WARN_MS) {
        push("WARN", "云端落后本地约 " + fmtDurationShort(num(loc.lastSaveTime) - cloud.lastSuccessfulSyncAt) + "（本地 " + loc.lastSaveTimeText + " / 云端 " + cloud.lastSuccessfulSyncAtText + "）");
      } else {
        push("OK", "云端与本地同步时间接近（本地 " + loc.lastSaveTimeText + " / 云端 " + cloud.lastSuccessfulSyncAtText + "）");
      }
      if (cloud.lastError) push("FAIL", "云端最近错误：" + cloud.lastError.name + (cloud.lastError.code ? " code=" + cloud.lastError.code : "") + " — " + cloud.lastError.message);
      if (cloud.dirty) push("WARN", "云端存在未上传的本地变更（dirty=true）。若长期如此，说明上传一直被跳过或失败");
      // 双重冻结：本地写盘失败会连带让上传永远 clean，此为核心缺陷（persistence.js markDirty 只在保存成功后调用）
      if (rep.storageError && cloud.dirty === false) {
        push("FAIL", "典型「双重冻结」特征：本地写盘失败 + 云端 dirty=false —— 云上传会因 reason:\"clean\" 永远跳过，本地与云端会同时停止更新");
      }
    }
    // 5. 云端归档列表
    if (arc.available && arc.count >= 0) {
      if (arc.count === 0) push("WARN", "云端归档列表为 0 条，但若上方显示曾成功同步过，则属自相矛盾（列表读取可能失败）");
      else if (arc.count === 1) push("OK", "云端只有 1 份存档（正常）");
      else push("FAIL", "云端存在 " + arc.count + " 份同名存档 —— 读写可能不是同一条，会造成进度错乱/回退（官方允许每人 100 档，多档不会报错）");
    } else if (arc.available && arc.error) {
      push("WARN", "云端归档列表读取失败：" + arc.error);
    }

    // 6. 设备镜像
    if (rep.mirror && rep.mirror.present && !rep.mirror.available) {
      push("WARN", "设备文件备份不可用" + (rep.mirror.error ? "：" + rep.mirror.error.message : ""));
    } else if (rep.mirror && rep.mirror.present && rep.mirror.syncFailed) {
      push("WARN", "设备文件备份写入失败" + (rep.mirror.error ? "：" + rep.mirror.error.message : ""));
    }

    // 7. 冲突现场
    if (rep.conflict) {
      const l = rep.conflict.local, c = rep.conflict.cloud;
      const line = function (tag, x) {
        if (!x) return tag + "：无";
        return tag + "：" + x.savedAtText + "（游玩 " + fmtDur(x.playSeconds) + " ｜ 技能 " + x.skillsN + "/" + x.skillsLvl + " ｜ 舰船 " + x.shipsN + " ｜ 星币 " + fmtIsk(x.isk) + "）";
      };
      push("INFO", "冲突现场 —— " + line("本地", l) + " ／ " + line("云端", c));
      if (l && c) {
        const samePlay = l.playSeconds === c.playSeconds && l.skillsLvl === c.skillsLvl && l.shipsN === c.shipsN;
        const sameTime = l.savedAt === c.savedAt;
        if (sameTime && samePlay) push("FAIL", "本地与云端信封的保存时间、游玩时长、内容摘要完全一致 —— 两份其实来自同一次保存，「冲突」判定依据可疑（应检查 checksum/时间戳来源，而非让玩家二选一）");
        else if (l.checksumDigest && c.checksumDigest && l.checksumDigest === c.checksumDigest) push("WARN", "本地与云端存档内容摘要一致但时间戳不同 —— 内容相同、时间戳被改写");
      }
    }

    const fails = v.filter(function (x) { return x.level === "FAIL"; }).length;
    const warns = v.filter(function (x) { return x.level === "WARN"; }).length;
    rep.verdictSummary = "FAIL " + fails + " ｜ WARN " + warns + " ｜ 其余正常";
    return v;
  }

  function fmtDurationShort(ms) {
    const s = Math.max(0, Math.round(num(ms) / 1000));
    if (s >= 86400) return Math.floor(s / 86400) + " 天";
    if (s >= 3600) return Math.floor(s / 3600) + " 时 " + Math.floor((s % 3600) / 60) + " 分";
    return Math.floor(s / 60) + " 分";
  }

  function buildCloudReportText(rep) {
    const L = [];
    const loc = rep.local || {}, cloud = rep.cloud || {}, st = rep.storage || {}, arc = rep.archives || {};
    L.push("=== 深空放置 · 云存档链路诊断 ===");
    L.push("生成时间：" + rep.generatedAt);
    if (rep.appVersion) L.push("版本标记：" + rep.appVersion);
    L.push("平台：" + rep.env.platform + " ｜ 视口：" + rep.env.viewport + " ｜ 本次运行：" + rep.env.elapsedSec + " 秒 ｜ 启动态：" + rep.env.bootState);
    L.push("页面：" + rep.env.url);
    L.push("UA：" + rep.env.ua);
    L.push("");
    L.push("【判定】" + (rep.verdictSummary || ""));
    (rep.verdicts || []).forEach(function (x) { L.push("  [" + x.level + "] " + x.text); });
    L.push("");
    L.push("【本地存档】");
    L.push("  是否有内存状态：" + loc.hasState + " ｜ SaveManager：" + (loc.managerPresent ? "已加载" : "未加载"));
    L.push("  最后成功写盘：" + loc.lastSaveTimeText + "（" + loc.lastSaveTime + "）");
    L.push("  存档已落盘字符数：" + (loc.saveKeyChars >= 0 ? loc.saveKeyChars.toLocaleString("zh-CN") + " 字符（约 " + fmtBytes(loc.saveKeyChars * 2) + "）" : "未找到 eve_idle_save 键"));
    L.push("  当前内存序列化字符数：" + (loc.payloadChars >= 0 ? loc.payloadChars.toLocaleString("zh-CN") : "序列化失败：" + loc.payloadSerializeError));
    L.push("  待保存标记 dirty：" + loc.dirty);
    L.push("  最近一次写盘异常：" + (rep.storageError ? rep.storageError.name + (rep.storageError.code ? " code=" + rep.storageError.code : "") + " — " + rep.storageError.message : "无"));
    L.push("");
    L.push("【本地存储占用】" + (st.supported ? fmtBytes(st.totalBytes) + "（估计上限的 " + Math.round(st.totalBytes / LOCAL_QUOTA_BYTES * 100) + "%）" : "不可用" + (st.error ? "：" + st.error : "")));
    (st.entries || []).slice(0, 8).forEach(function (e) { L.push("  " + e.key + " → " + e.chars.toLocaleString("zh-CN") + " 字符 / " + fmtBytes(e.bytes)); });
    if ((st.entries || []).length > 8) L.push("  ... 另有 " + (st.entries.length - 8) + " 个键");
    L.push("");
    L.push("【设备文件备份】" + (rep.mirror && rep.mirror.present ? (rep.mirror.available ? (rep.mirror.syncFailed ? "可用但上次写入失败" : "正常") : "不可用") + " ｜ 上次写入：" + rep.mirror.lastWriteAtText + (rep.mirror.error ? " ｜ 错误：op=" + rep.mirror.error.op + (rep.mirror.error.code ? " code=" + rep.mirror.error.code : "") + " " + rep.mirror.error.message + (rep.mirror.error.file ? " file=" + rep.mirror.error.file : "") : "") : "未挂载"));
    L.push("");
    if (!cloud.present) {
      L.push("【云端】未找到云同步服务实例");
    } else {
      L.push("【云端】可用：" + cloud.available + " ｜ 状态：" + cloud.state + " ｜ 平台：" + cloud.platform);
      L.push("  dirty=" + cloud.dirty + " busy=" + cloud.busy + " 上次失败标记=" + cloud.syncFailedFlag);
      L.push("  上次成功同步：" + cloud.lastSuccessfulSyncAtText + "（" + cloud.lastSuccessfulSyncAt + "）");
      L.push("  localRevision=" + cloud.localRevision + " ｜ 记录云端内容摘要=" + (cloud.lastCloudChecksumDigest || "空") + " ｜ 记录归档 uuid 前缀=" + (cloud.lastCloudArchiveIdPrefix || "空"));
      L.push("  provider 当前归档 uuid 前缀=" + (cloud.providerArchiveUUIDPrefix || "空") + " ｜ fileId 前缀=" + (cloud.providerFileIdPrefix || "空"));
      L.push("  最近错误：" + (cloud.lastError ? cloud.lastError.name + (cloud.lastError.code ? " code=" + cloud.lastError.code : "") + " — " + cloud.lastError.message : "无"));
    }
    L.push("");
    if (!arc.available) {
      L.push("【云端归档列表】云端不可用，未读取");
    } else if (arc.count < 0) {
      L.push("【云端归档列表】读取失败：" + (arc.error || "未知"));
    } else {
      L.push("【云端归档列表】共 " + arc.count + " 份" + (arc.count > 1 ? "  ⚠ 多档！" : ""));
      arc.list.forEach(function (a, i) {
        L.push("  " + (i + 1) + ". uuid=" + (a.uuidPrefix || "?") + "... ｜ 修改时间=" + a.modifiedAtText + " ｜ 体积=" + (a.size ? fmtBytes(a.size) : "?") + " ｜ slot=" + a.slot);
      });
    }
    if (rep.conflict) {
      L.push("");
      L.push("【启动冲突现场】");
      const one = function (tag, x) {
        if (!x) { L.push("  " + tag + "：无"); return; }
        L.push("  " + tag + "：信封 savedAt=" + x.savedAtText + " revision=" + x.revision + " 内容摘要=" + (x.checksumDigest || "?") + " 体积=" + (x.chars >= 0 ? x.chars.toLocaleString("zh-CN") + " 字符" : "?"));
        L.push("        存档内 lastSaveTime=" + x.lastSaveTimeText + " ｜ 游玩 " + fmtDur(x.playSeconds) + " ｜ 技能 " + x.skillsN + " 项/总等级 " + x.skillsLvl + " ｜ 舰船 " + x.shipsN + " ｜ 星币 " + fmtIsk(x.isk));
      };
      one("本地", rep.conflict.local);
      one("云端", rep.conflict.cloud);
    }
    L.push("");
    L.push("（本报告只含 uuid 前 8 位与内容摘要短哈希，不含存档内容、玩家 ID、Token 与完整路径）");
    return L.join("\n");
  }

  function renderCloudModal(rep) {
    if (typeof document === "undefined") return;
    const text = buildCloudReportText(rep);
    let overlay = document.getElementById("cloud-save-diag-overlay");
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = document.createElement("div");
    overlay.id = "cloud-save-diag-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;";
    const box = document.createElement("div");
    box.style.cssText = "background:#15171c;color:#e8e8e8;max-width:94vw;width:680px;max-height:86vh;display:flex;flex-direction:column;padding:16px 18px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);font-family:ui-monospace,Menlo,Consolas,monospace;";
    const title = document.createElement("div");
    title.textContent = "🩺 云存档链路诊断";
    title.style.cssText = "font-size:15px;font-weight:700;margin-bottom:8px;flex:0 0 auto;";
    const pre = document.createElement("pre");
    pre.textContent = text;
    pre.style.cssText = "white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.55;margin:0 0 12px;overflow:auto;flex:1 1 auto;-webkit-user-select:text;user-select:text;";
    const bar = document.createElement("div");
    bar.style.cssText = "flex:0 0 auto;display:flex;gap:8px;flex-wrap:wrap;";
    const copy = document.createElement("button");
    copy.textContent = "复制报告";
    copy.style.cssText = "padding:8px 14px;cursor:pointer;";
    copy.onclick = function () {
      const done = function (ok) { copy.textContent = ok ? "已复制 ✓" : "复制失败，请长按选择文本"; setTimeout(function () { copy.textContent = "复制报告"; }, 1800); };
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
        } else if (document.execCommand) {
          const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); document.body.removeChild(ta); done(ok);
        } else { done(false); }
      } catch (e) { done(false); }
    };
    const close = document.createElement("button");
    close.textContent = "关闭";
    close.style.cssText = "padding:8px 14px;cursor:pointer;";
    close.onclick = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    bar.appendChild(copy); bar.appendChild(close);
    box.appendChild(title); box.appendChild(pre); box.appendChild(bar);
    overlay.appendChild(box);
    if (document.body) document.body.appendChild(overlay);
  }

  // 采集入口：同步信息立即渲染，云端归档列表到达后再补一次（避免玩家等网络）。
  function runCloudSaveDiagnostics() {
    const rep = collectSync();
    rep.archives = { available: null, count: -1, list: [], error: null };
    rep.verdicts = buildVerdicts(rep);
    const promise = collectArchives().then(function (arc) {
      rep.archives = arc;
      rep.verdicts = buildVerdicts(rep);
      return rep;
    });
    return { report: rep, done: promise };
  }

  if (typeof window !== "undefined") {
    window.diagnoseCloudSave = function () { return runCloudSaveDiagnostics().report; };
    window.openCloudSaveDiagnostics = function () {
      const run = runCloudSaveDiagnostics();
      renderCloudModal(run.report);
      run.done.then(function (rep) {
        const el = document.getElementById("cloud-save-diag-overlay");
        if (!el) return; // 玩家已关闭，不重开
        renderCloudModal(rep);
        // 保持「复制」按钮上的加载态不干扰：重渲染会重建按钮，这里无需额外处理。
      }).catch(function () {});
      return run.report;
    };
    window.cloudSaveDiagnosticsText = function () {
      const run = runCloudSaveDiagnostics();
      return run.done.then(function (rep) { return buildCloudReportText(rep); });
    };
  }
})();
