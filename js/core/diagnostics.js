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
      else if (!dep.active) { verdict = "INFO"; reason = "基地当前未激活（已过期或未部署）"; }
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
