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
    // B 修复（2026-09-10）后 sync_meta 里存的就是 64 位摘要本身（16 hex），不再二次哈希，
    // 直接展示其首个 32 位段，保证诊断报告里看到的值与 sync_meta 现场逐字一致。
    if (/^[0-9a-f]{16}$/.test(s)) return "#" + s.slice(0, 8) + "(sync_meta 摘要)";
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

  // ================= 泰坦装配摘要（「重启丢装备」类问题的核心判据） =================
  // 目标：用极短文本回答四问 ——
  //   ① 槽位研究（tt_high/tt_mid/tt_low/tt_rig）在本次启动读到了吗（值 = 0 还是正常）；
  //   ② 注册表里该组合的 slots 是否已含研究加成（还是停在舰体基础值）；
  //   ③ 各槽装配件数 vs 槽位数（缺口 = 被 reclaim 回收的件数）；
  //   ④ 那些装配引用在装备实例池里还在不在（不在 = 真的没了，而非只是显示异常）。
  // 隐私：只输出游戏内 id（组合 id / 舰船 id）与计数，不含玩家 ID / Token / 存档内容。
  const TITAN_PREFIX = "titan__";
  const TITAN_SLOT_KEYS = ["high", "mid", "low", "rig"];
  const TT_NODES = ["tt_high", "tt_mid", "tt_low", "tt_rig"];

  function parseTitanIdOf(shipId) {
    if (typeof shipId !== "string" || shipId.indexOf(TITAN_PREFIX) !== 0) return null;
    const parts = shipId.slice(TITAN_PREFIX.length).split("__");
    if (parts.length !== 3) return null;
    return { hullId: parts[0], weaponId: parts[1], coreId: parts[2] };
  }
  function isTitanShip(ship) {
    if (!ship || typeof ship !== "object") return false;
    if (ship.titanCombo) return true;
    return typeof ship.shipId === "string" && ship.shipId.indexOf(TITAN_PREFIX) === 0;
  }
  function titanInstancePool() {
    const pool = {};
    let total = 0, titanTagged = 0;
    try {
      const list = (typeof gameState !== "undefined" && gameState && gameState.equipment && Array.isArray(gameState.equipment.instances))
        ? gameState.equipment.instances : [];
      total = list.length;
      list.forEach(function (x) {
        if (!x) return;
        if (x.instanceId) pool[x.instanceId] = true;
        if (typeof x.itemId === "string" && x.itemId.indexOf("titan") >= 0) titanTagged += 1;
      });
    } catch (e) {}
    return { pool: pool, total: total, titanTagged: titanTagged };
  }
  // 逐槽统计「已引用件数」与「引用在实例池中找不到的件数」。
  function countFitted(ship, pool) {
    const out = { high: 0, mid: 0, low: 0, rig: 0, missing: 0, nulls: 0 };
    const f = (ship && ship.fitted) || null;
    if (!f) return out;
    for (let s = 0; s < TITAN_SLOT_KEYS.length; s++) {
      const slot = TITAN_SLOT_KEYS[s];
      const arr = Array.isArray(f[slot]) ? f[slot] : [];
      for (let i = 0; i < arr.length; i++) {
        const ref = arr[i];
        if (ref == null) { out.nulls += 1; continue; }
        out[slot] += 1;
        if (typeof ref === "string" && !pool[ref]) out.missing += 1;
      }
    }
    return out;
  }

  // ---- 取证（2026-09-22）：「重启丢装备」跨重启自证 ----
  // ① 回收看门狗：state.js reclaimOverflowFitting 在真的裁掉泰坦装备时会往下面这个键追加一条
  //    证据（含「裁剪时刻的槽位上限」）。报告据此判定那次裁剪用的是含研究加成的正确槽位，
  //    还是研究未生效的过期（基础）槽位 —— 后者即真 bug。
  // ② 跨重启快照：每次生成报告记录各泰坦装配件数与存档字符数，下次报告自动给差值，
  //    把「重启前后两份报告人工对比」自动化。
  const TITAN_RECLAIM_LOG_KEY = "deep_space_idle_titan_reclaim_log_v1";
  const TITAN_SNAP_KEY = "deep_space_idle_titan_snap_v1";
  function readTitanReclaimLog() {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return [];
      const raw = localStorage.getItem(TITAN_RECLAIM_LOG_KEY);
      const p = raw ? JSON.parse(raw) : null;
      return Array.isArray(p) ? p : [];
    } catch (e) { return []; }
  }
  function readTitanSnap() {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return null;
      const raw = localStorage.getItem(TITAN_SNAP_KEY);
      const p = raw ? JSON.parse(raw) : null;
      return (p && typeof p === "object") ? p : null;
    } catch (e) { return null; }
  }
  function writeTitanSnap(snap) {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return;
      localStorage.setItem(TITAN_SNAP_KEY, JSON.stringify(snap));
    } catch (e) { /* 取证失败不影响报告生成 */ }
  }
  function titanSaveChars() {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return -1;
      const v = localStorage.getItem("eve_idle_save");
      return (typeof v === "string") ? v.length : -1;
    } catch (e) { return -1; }
  }
  function fmtClock(ms) {
    const n = num(ms);
    if (!n) return "?";
    try {
      const d = new Date(n);
      const p2 = function (x) { return (x < 10 ? "0" : "") + x; };
      return (d.getMonth() + 1) + "/" + d.getDate() + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
    } catch (e) { return "?"; }
  }

  function summarizeTitan() {
    const rep = {
      available: false, reason: "",
      nodes: {}, nodesHit: 0,
      hullsBase: {},
      registryCount: 0, configs: [],
      shipCount: 0, ships: [],
      poolTotal: 0, poolTitanTagged: 0,
      reclaimLog: [], reclaimTotal: 0, reclaimStaleCount: 0,
      prevSnap: null, snapNow: null, snapDeltas: [],
      verdict: ""
    };
    const state = (typeof gameState !== "undefined" && gameState) ? gameState : null;
    if (!state) { rep.reason = "无 gameState（未进入游戏或启动未完成）"; return rep; }
    rep.available = true;

    // ① 槽位研究等级
    const cl = (state.research && state.research.completedLevels && typeof state.research.completedLevels === "object")
      ? state.research.completedLevels : null;
    for (let i = 0; i < TT_NODES.length; i++) {
      const id = TT_NODES[i];
      const present = !!(cl && Object.prototype.hasOwnProperty.call(cl, id));
      const v = present ? Number(cl[id]) : 0;
      rep.nodes[id] = present ? (isFinite(v) ? v : String(cl[id])) : "缺失";
      if (present && isFinite(v) && v > 0) rep.nodesHit += 1;
    }

    // ② 舰体基础槽位真值 + 注册表当前槽位
    const hulls = (typeof window !== "undefined" && window.TITAN_HULLS) ? window.TITAN_HULLS : null;
    if (hulls) for (const h in hulls) { if (Object.prototype.hasOwnProperty.call(hulls, h) && hulls[h] && hulls[h].slots) rep.hullsBase[h] = hulls[h].slots; }
    const reg = (typeof window !== "undefined" && window.SHIP_DATA && window.SHIP_DATA.titan) ? window.SHIP_DATA.titan : null;
    if (reg) {
      for (const shipId in reg) {
        if (!Object.prototype.hasOwnProperty.call(reg, shipId)) continue;
        const cfg = reg[shipId];
        if (!cfg || cfg.type !== "titan") continue;
        rep.registryCount += 1;
        if (rep.configs.length < 8) {
          rep.configs.push({
            id: shipId, hullId: cfg.hullId || "?",
            slots: cfg.slots || null,
            base: (cfg.hullId && hulls && hulls[cfg.hullId] && hulls[cfg.hullId].slots) ? hulls[cfg.hullId].slots : null
          });
        }
      }
    }

    // ③ 存档内的泰坦舰船 + 装配
    let ships = [];
    try {
      if (state.inventory && Array.isArray(state.inventory.ships)) ships = state.inventory.ships;
    } catch (e) {}
    const ip = titanInstancePool();
    rep.poolTotal = ip.total; rep.poolTitanTagged = ip.titanTagged;
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i];
      if (!isTitanShip(ship)) continue;
      rep.shipCount += 1;
      if (rep.ships.length < 8) {
        const cnt = countFitted(ship, ip.pool);
        const cfg = reg && ship.shipId ? reg[ship.shipId] : null;
        rep.ships.push({
          id: String(ship.id || ship.instanceId || ("#" + i)),
          shipId: String(ship.shipId || "?"),
          hasCombo: !!ship.titanCombo,
          fitted: { high: cnt.high, mid: cnt.mid, low: cnt.low, rig: cnt.rig },
          nulls: cnt.nulls, missing: cnt.missing,
          slots: (cfg && cfg.slots) ? cfg.slots : null
        });
      }
    }

    // ⑤ 跨重启自证（2026-09-22）：快照对比 + 回收看门狗判定
    const snapNow = {
      t: Date.now(),
      saveChars: titanSaveChars(),
      ships: rep.ships.map(function (s) {
        return { id: s.id, fitted: { high: s.fitted.high, mid: s.fitted.mid, low: s.fitted.low, rig: s.fitted.rig } };
      })
    };
    const prevSnap = readTitanSnap();
    rep.prevSnap = prevSnap;
    if (prevSnap && Array.isArray(prevSnap.ships)) {
      rep.ships.forEach(function (s) {
        let pv = null;
        for (let i = 0; i < prevSnap.ships.length; i++) {
          if (prevSnap.ships[i] && prevSnap.ships[i].id === s.id) { pv = prevSnap.ships[i]; break; }
        }
        if (!pv || !pv.fitted) return;
        const from = { high: num(pv.fitted.high), mid: num(pv.fitted.mid), low: num(pv.fitted.low), rig: num(pv.fitted.rig) };
        const to = { high: s.fitted.high, mid: s.fitted.mid, low: s.fitted.low, rig: s.fitted.rig };
        rep.snapDeltas.push({
          id: s.id, from: from, to: to,
          changed: (from.high !== to.high) || (from.mid !== to.mid) || (from.low !== to.low) || (from.rig !== to.rig)
        });
      });
    }
    rep.snapNow = snapNow;
    writeTitanSnap(snapNow);

    // 回收看门狗：逐条判定「裁剪时槽位是否已含研究加成」（低于当前研究槽位 ⇒ 过期槽位裁剪 = 真 bug）
    function curSlotsFor(shipId) {
      for (let i = 0; i < rep.ships.length; i++) { if (rep.ships[i].shipId === shipId && rep.ships[i].slots) return rep.ships[i].slots; }
      for (let i = 0; i < rep.configs.length; i++) { if (rep.configs[i].id === shipId && rep.configs[i].slots) return rep.configs[i].slots; }
      return null;
    }
    const rlog = readTitanReclaimLog();
    rep.reclaimTotal = rlog.length;
    rep.reclaimLog = rlog.slice(0, 5);
    rep.reclaimStaleCount = 0;
    rep.reclaimLog.forEach(function (e) {
      const c = (e && e.cap) || {};
      const cur = curSlotsFor(String((e && e.ship) || ""));
      let stale = false;
      if (cur) {
        if (num(c.mid) < num(cur.mid) || num(c.low) < num(cur.low) || num(c.rig) < num(cur.rig)) stale = true;
      }
      e.__stale = stale;
      if (stale) rep.reclaimStaleCount += 1;
    });

    // ④ 一句话结论
    const v = [];
    if (rep.nodesHit === 0) v.push("槽位研究 4 节点全部读作 0/缺失");
    if (!rep.registryCount) v.push("注册表为空（泰坦组合未被注册）");
    if (!rep.shipCount) v.push("存档 inventory.ships 内无泰坦舰船");
    rep.configs.forEach(function (c) {
      if (c.base && c.slots) {
        const dBonus = (num(c.slots.mid) - num(c.base.mid)) + (num(c.slots.low) - num(c.base.low)) + (num(c.slots.rig) - num(c.base.rig));
        if (dBonus === 0 && rep.nodesHit > 0) v.push(c.hullId + " 注册表槽位未含研究加成（中/低/改装仍为基础值）");
      }
    });
    rep.ships.forEach(function (s) {
      if (s.missing > 0) v.push(s.id + " 有 " + s.missing + " 个装配引用在实例池中找不到");
    });
    // 注意：空槽（已装件数 < 槽位容量）是玩家正常状态，绝不能当异常判据。
    // 「是否丢装」只能靠重启前后两份报告对比 fitted 件数，故此处不下缺口结论。
    rep.verdict = v.length ? v.join("；") : "槽位含研究加成、装配引用完整（「重启丢装备」需用重启前后两份报告对比）";
    return rep;
  }

  // 本游戏的键前缀。同一 origin 上可能还有其他小游戏的数据（TapTap 把小游戏托管在
  // 同一域名下按路径分发，而 localStorage 按 origin 隔离、不看路径）——必须把「不是
  // 我们的占用」单独算出来，否则会把平台/其他游戏的空间算到本作头上，误导排查。
  const OWN_KEY_RE = /^(eve_idle_|deep_space_idle_)/;

  // localStorage 各键占用（UTF-16 下 1 字符 ≈ 2 字节）。
  // quotaBytes 是「推断出的实际上限」：容器给的配额并非恒为 5MB（Chromium 已放宽到 10MB），
  // 写死 5MB 会把已满 10MB 的机器算成 200%，反而误导。取能装下当前总量 + 写盘失败余量中
  // 最小的候选值作为下限。
  const QUOTA_CANDIDATES = [5 * 1024 * 1024, 10 * 1024 * 1024, 20 * 1024 * 1024];
  function inferQuotaBytes(totalBytes) {
    for (let i = 0; i < QUOTA_CANDIDATES.length; i++) {
      if (totalBytes <= QUOTA_CANDIDATES[i]) return QUOTA_CANDIDATES[i];
    }
    return Math.max(totalBytes, QUOTA_CANDIDATES[QUOTA_CANDIDATES.length - 1]);
  }
  function scanStorage() {
    const out = {
      supported: false, entries: [], totalBytes: 0, totalChars: 0, error: null,
      ownBytes: 0, ownChars: 0, ownKeys: 0, foreignBytes: 0, foreignChars: 0, foreignKeys: 0,
      topForeign: [], quotaBytes: 0
    };
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
        const own = OWN_KEY_RE.test(k);
        out.entries.push({ key: k, chars: chars, bytes: chars * 2, own: own });
      }
      out.entries.sort(function (a, b) { return b.bytes - a.bytes; });
      out.totalChars = out.entries.reduce(function (s, e) { return s + e.chars; }, 0);
      out.totalBytes = out.entries.reduce(function (s, e) { return s + e.bytes; }, 0);
      out.entries.forEach(function (e) {
        if (e.own) { out.ownBytes += e.bytes; out.ownChars += e.chars; out.ownKeys++; }
        else { out.foreignBytes += e.bytes; out.foreignChars += e.chars; out.foreignKeys++; }
      });
      out.topForeign = out.entries.filter(function (e) { return !e.own; }).slice(0, 5);
      out.quotaBytes = inferQuotaBytes(out.totalBytes);
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

    // ---- 泰坦装配摘要（重启丢装备类问题的判据；采集异常不得影响其余诊断）----
    try { rep.titan = summarizeTitan(); } catch (e) { rep.titan = { available: false, reason: "采集异常：" + describeErr(e) }; }

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
    if (bigChars >= SIZE_FAIL_CHARS) push("FAIL", "存档体积 " + bigChars.toLocaleString("zh-CN") + " 字符（约 " + fmtBytes(bigChars * 2) + "）过大，单键即接近容器配额，极易触发写盘失败");
    else if (bigChars >= SIZE_WARN_CHARS) push("WARN", "存档体积 " + bigChars.toLocaleString("zh-CN") + " 字符（约 " + fmtBytes(bigChars * 2) + "）偏大，建议关注是否存在无上限增长的数组");
    else push("OK", "存档体积正常：" + (bigChars >= 0 ? bigChars.toLocaleString("zh-CN") + " 字符（约 " + fmtBytes(bigChars * 2) + "）" : "无法测量"));

    // 3. localStorage 总占用。配额按实测推断（不写死 5MB：容器可能给到 10MB，
    //    写死会把已满的 10MB 机器算成 200%，反而误导）。
    if (st.supported && st.totalBytes > 0) {
      const quota = num(st.quotaBytes) || LOCAL_QUOTA_BYTES;
      const pct = Math.round(st.totalBytes / quota * 100);
      const attr = "本游戏 " + fmtBytes(st.ownBytes) + "（" + st.ownKeys + " 键）／其他来源 " + fmtBytes(st.foreignBytes) + "（" + st.foreignKeys + " 键）";
      if (pct >= 95) push("FAIL", "localStorage 总占用 " + fmtBytes(st.totalBytes) + "，已达推断上限 " + fmtBytes(quota) + " 的 " + pct + "%（已写满）—— " + attr);
      else if (pct >= 80) push("WARN", "localStorage 总占用 " + fmtBytes(st.totalBytes) + "（推断上限 " + fmtBytes(quota) + " 的 " + pct + "%），余量不足 —— " + attr);
      else push("OK", "localStorage 总占用 " + fmtBytes(st.totalBytes) + "（推断上限 " + fmtBytes(quota) + " 的 " + pct + "%）—— " + attr);
    }
    if (st.error) push("FAIL", "读取 localStorage 本身报错：" + st.error);

    // 3a. 他人占用：localStorage 按 origin（域名）共享，不看路径。TapTap 把小游戏托管在
    //     同一域名下用路径分发，所以同一台设备上其他小游戏的数据会与本作抢同一份配额。
    if (st.supported && st.foreignBytes > 0) {
      const share = Math.round(st.foreignBytes / Math.max(1, st.totalBytes) * 100);
      if (share >= 30 || rep.storageError) {
        push("FAIL", "本地存储中 " + share + "% 的空间（" + fmtBytes(st.foreignBytes) + "，共 " + st.foreignKeys +
          " 个键）不属于本游戏 —— 同域名下的其他小游戏与本作共享同一份 localStorage 配额。" +
          "本作只占 " + fmtBytes(st.ownBytes) + "，即使压到最小也可能写不进去；需清理同域其他数据，或把存档迁到文件系统（不占 localStorage）");
      }
    }

    // 3b. 同步元数据键成本：本版本起 sync_meta 只存 64 位校验摘要（B 修复），正常应 < 2KB。
    //     若仍与存档本体同量级，说明本地还留着旧版本写入的全量 checksum —— 再保存一次即可改写为摘要。
    const metaEntry = (st.entries || []).filter(function (e) { return e.key === "deep_space_idle_sync_meta"; })[0];
    if (metaEntry && loc.saveKeyChars > 0 && metaEntry.chars > loc.saveKeyChars * 0.5) {
      push("WARN", "同步元数据键占 " + metaEntry.chars.toLocaleString("zh-CN") + " 字符，是存档本体（" + loc.saveKeyChars.toLocaleString("zh-CN") + " 字符）的 " +
        Math.round(metaEntry.chars / loc.saveKeyChars * 100) + "% —— 该键正常应小于 2KB（只存校验摘要）。如此体积说明本地仍是旧版本（0.7.10 及以前）" +
        "写入的全量校验和残留，进入游戏正常保存一次即可自动改写为摘要并释放这部分空间");
    } else if (metaEntry) {
      push("OK", "同步元数据键仅占 " + metaEntry.chars.toLocaleString("zh-CN") + " 字符（本版本起只存校验摘要，不再随存档体积膨胀）");
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

    // 8. 泰坦装配（「重启丢装备」类问题的判据；高槽计数恒为 7 不会溢出，故只看中/低/改装）
    const ttv = rep.titan;
    if (ttv && ttv.available) {
      if (ttv.shipCount === 0) {
        push("INFO", "泰坦装配：存档内未发现泰坦舰船" + (ttv.registryCount ? "（注册表已有 " + ttv.registryCount + " 个组合）" : ""));
      } else {
        let bad = false;
        if (ttv.nodesHit === 0) {
          push("FAIL", "泰坦装配：槽位研究 tt_high/tt_mid/tt_low/tt_rig 全部读作 0/缺失 —— 槽位不会含研究加成，越界装备启动即被回收");
          bad = true;
        }
        ttv.configs.forEach(function (c) {
          if (!c.base || !c.slots) return;
          const dBonus = (num(c.slots.mid) - num(c.base.mid)) + (num(c.slots.low) - num(c.base.low)) + (num(c.slots.rig) - num(c.base.rig));
          if (dBonus === 0 && ttv.nodesHit > 0) {
            push("FAIL", "泰坦装配：" + c.hullId + " 注册表槽位仍为舰体基础值（未叠加研究加成），越界装备会被回收");
            bad = true;
          }
        });
        ttv.ships.forEach(function (s) {
          const cap = s.slots ? ("中" + num(s.slots.mid) + "/低" + num(s.slots.low) + "/改" + num(s.slots.rig) + "/高" + num(s.slots.high)) : "未知";
          push("INFO", "泰坦装配数据：舰船 " + s.id + " 已装 中" + s.fitted.mid + "/低" + s.fitted.low + "/改" + s.fitted.rig + " 件 ｜ 该组合槽位容量 " + cap + "（空槽属正常，不必等于容量；本报告后段会自动给出跨重启对比与启动回收记录）");
          if (s.missing > 0) { push("FAIL", "泰坦装配：舰船 " + s.id + " 有 " + s.missing + " 个装配引用在装备实例池中找不到（装备数据已丢失）"); bad = true; }
        });
        if (ttv.reclaimStaleCount > 0) {
          push("FAIL", "泰坦装配：历史上有 " + ttv.reclaimStaleCount + " 次启动使用了「未含研究加成」的过期槽位裁剪装备 —— 真 bug 复发（详见【启动回收记录】）");
          bad = true;
        }
        if (ttv.prevSnap && (ttv.snapDeltas || []).some(function (d) { return d.changed; })) {
          push("WARN", "泰坦装配：与上次生成报告相比装配件数发生变化（见【跨重启对比】）—— 若非你本人装卸，即为启动在回收装备");
        }
        if (!bad) push("OK", "泰坦装配：槽位研究已生效，装配引用完整（启动回收记录与跨重启对比见报告后段）");
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
    const quotaBytes = num(st.quotaBytes) || LOCAL_QUOTA_BYTES;
    L.push("【本地存储占用】" + (st.supported ? fmtBytes(st.totalBytes) + "（推断上限 " + fmtBytes(quotaBytes) + " 的 " + Math.round(st.totalBytes / quotaBytes * 100) + "%）" : "不可用" + (st.error ? "：" + st.error : "")));
    if (st.supported) {
      L.push("  本游戏占用：" + fmtBytes(st.ownBytes) + "（" + st.ownKeys + " 个键） ｜ 非本游戏占用：" + fmtBytes(st.foreignBytes) + "（" + st.foreignKeys + " 个键，与本站点其他小游戏共享同一份配额）");
    }
    (st.entries || []).slice(0, 8).forEach(function (e) { L.push("  " + (e.own ? "[本作] " : "[非本作] ") + e.key + " → " + e.chars.toLocaleString("zh-CN") + " 字符 / " + fmtBytes(e.bytes)); });
    if ((st.entries || []).length > 8) L.push("  ... 另有 " + (st.entries.length - 8) + " 个键");
    L.push("");
    L.push("【设备文件备份】" + (rep.mirror && rep.mirror.present ? (rep.mirror.available ? (rep.mirror.syncFailed ? "可用但上次写入失败" : "正常") : "不可用") + " ｜ 上次写入：" + rep.mirror.lastWriteAtText + (rep.mirror.error ? " ｜ 错误：op=" + rep.mirror.error.op + (rep.mirror.error.code ? " code=" + rep.mirror.error.code : "") + " " + rep.mirror.error.message + (rep.mirror.error.file ? " file=" + rep.mirror.error.file : "") : "") : "未挂载"));
    L.push("");
    const tt = rep.titan;
    if (tt && tt.available) {
      L.push("【泰坦装配】" + tt.verdict);
      L.push("  槽位研究：" + TT_NODES.map(function (id) { return id + "=" + tt.nodes[id]; }).join(" ") + "（命中 " + tt.nodesHit + "/4）");
      L.push("  注册表组合数：" + tt.registryCount);
      tt.configs.forEach(function (c) {
        L.push("    · " + c.id);
        L.push("        当前 slots=" + JSON.stringify(c.slots) + " ｜ 舰体基础=" + JSON.stringify(c.base));
      });
      L.push("  泰坦舰船：" + tt.shipCount + " 艘 ｜ 装备实例池 " + tt.poolTotal + " 件（titan 前缀 " + tt.poolTitanTagged + " 件）");
      tt.ships.forEach(function (s) {
        L.push("    · " + s.id + " shipId=" + s.shipId + " combo=" + (s.hasCombo ? "有" : "无"));
        L.push("        装配=" + JSON.stringify(s.fitted) + " ｜ 该组合槽位=" + JSON.stringify(s.slots) +
          (s.nulls ? " ｜ 空位 " + s.nulls : "") + (s.missing ? " ｜ 实例池缺失 " + s.missing : ""));
      });
      L.push("  （本报告已自动记录【启动回收记录】与【跨重启对比】，见下方两段，无需人工比对）");
      L.push("");
      L.push("【泰坦装配·启动回收记录】" + (tt.reclaimTotal
        ? "共 " + tt.reclaimTotal + " 条" + (tt.reclaimStaleCount ? "，其中 " + tt.reclaimStaleCount + " 条用了未含研究的过期槽位 ⚠ 真 bug" : "，全部用含研究槽位（属正常越界回收）")
        : "无"));
      if (!tt.reclaimTotal) {
        L.push("  未记录到任何回收事件 —— 历史与本次启动都没有裁过泰坦装备。");
        L.push("  若装配仍有空槽，那是此前版本留下的旧伤（装备已退回仓库，重新装上即可）或本就没装，不是当前版本在裁。");
      } else {
        (tt.reclaimLog || []).forEach(function (e) {
          const c = e.cap || {}, cu = e.cut || {};
          L.push("  · " + fmtClock(e.t) + " ｜ 裁 " + num(e.n) + " 件（中" + num(cu.mid) + "/低" + num(cu.low) + "/改" + num(cu.rig) + "）｜ 裁剪时槽位 中" + num(c.mid) + "/低" + num(c.low) + "/改" + num(c.rig) + (e.__stale ? " ⚠ 低于当前研究槽位" : ""));
        });
      }
      L.push("");
      L.push("【泰坦装配·跨重启对比】");
      if (!tt.prevSnap) {
        L.push("  首次记录，暂无基线。重启后再生成一次即可自动给出差值。");
      } else {
        L.push("  上次报告：" + fmtClock(tt.prevSnap.t) + " ｜ 当时存档 " + (num(tt.prevSnap.saveChars) >= 0 ? num(tt.prevSnap.saveChars).toLocaleString("zh-CN") + " 字符" : "未知"));
        if (!tt.snapDeltas || !tt.snapDeltas.length) L.push("  未找到可比对的泰坦舰船");
        (tt.snapDeltas || []).forEach(function (d) {
          L.push("  · " + d.id + " 装配 中" + d.from.mid + "/低" + d.from.low + "/改" + d.from.rig + " → 中" + d.to.mid + "/低" + d.to.low + "/改" + d.to.rig + (d.changed ? "  ⚠ 件数变化（非你本人装卸即为启动回收）" : "（无变化）"));
        });
      }
    } else if (tt) {
      L.push("【泰坦装配】未采集：" + (tt.reason || "?"));
    }
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
