/* ================================================================
   启动引导入口（第一阶段交付决定·十）

   职责边界（严格）：
   - 仅调用 SaveManager.bootstrap()；不在此处写任何迁移 / 云 / 平台逻辑。
   - 必须在 render.js 之前加载：bootstrap() 内部「本地读档 + 迁移」是同步的，
     保证 render.js 在模块加载时调用 updateUI() 之前 gameState 已就绪。
   - bootstrap() 拒绝（本地读档/迁移抛错）→ 阻塞错误页，绝不静默开新档。
   - 防重复 bootstrap：SaveManager.bootstrap() 内部已用 _bootStarted 守卫，此处再兜底一次。
   - 5s 自动保存定时器与 beforeunload 的 bootState 门禁在 persistence.js 内实现；
     云端冲突未决（awaiting-choice）期间，tick / 离线结算 / 自动保存 / 成就上报均被暂停。
   ================================================================ */
(function () {
  "use strict";

  function showFatalBootError(err) {
    try {
      var msg = (err && err.message) ? err.message : String(err);
      var overlay = document.getElementById("boot-fatal-error");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "boot-fatal-error";
        overlay.setAttribute("role", "alert");
        overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(8,10,18,.96);color:#e8ecf4;" +
          "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
          "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;text-align:center;";
        var h = document.createElement("h1");
        h.textContent = "启动失败";
        h.style.cssText = "font-size:22px;margin:0 0 12px;";
        var p = document.createElement("p");
        p.textContent = "本地存档读取或迁移失败，游戏无法启动。请勿刷新以保留现场，并联系支持。";
        p.style.cssText = "max-width:520px;line-height:1.6;opacity:.85;margin:0 0 16px;";
        var pre = document.createElement("pre");
        pre.textContent = msg;
        pre.style.cssText = "max-width:560px;white-space:pre-wrap;word-break:break-word;background:rgba(255,255,255,.06);" +
          "padding:12px;border-radius:8px;font-size:12px;opacity:.7;margin:0;";
        overlay.appendChild(h); overlay.appendChild(p); overlay.appendChild(pre);
        if (document.body) document.body.appendChild(overlay);
      }
    } catch (e) {
      // 连错误页都建不出时，仅 console.error 留痕。
      console.error("BOOT FATAL", err);
    }
  }

  // 冲突选择浮层（决定·六 / P1-4）：云端冲突 awaiting-choice 期间必须二选一，绝无「取消并继续」。
  // P1-4 增强：展示本地/云端存档明细（时间、游玩时长、技能/舰船/资产摘要），提供本地/云端备份导出按钮
  // （仅真实触发后才显示「已导出」）；选项点击后先禁用按钮并提示「处理中」，仅在 resolve 成功后才移除遮罩；
  // resolve 失败则恢复按钮并显示错误、允许重试（resolveCloudConflict 失败会复位 awaiting-choice 保持阻塞）；
  // 忽略 backdrop / Escape（绝不静默关闭）。
  let _conflictKeyHandler = null;

  function fmtConflictTime(ts) {
    if (typeof ts !== "number" || !isFinite(ts) || ts <= 0) return "—";
    try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
  }
  function fmtConflictDuration(sec) {
    if (typeof sec !== "number" || !isFinite(sec) || sec <= 0) return "—";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return h + " 小时 " + m + " 分";
    return m + " 分";
  }
  function conflictSummarySection(label, src) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "flex:1;min-width:240px;text-align:left;background:rgba(255,255,255,.05);border:1px solid #243044;border-radius:10px;padding:14px;";
    const h = document.createElement("div");
    h.textContent = label;
    h.style.cssText = "font-size:15px;font-weight:700;margin-bottom:8px;color:#9fd0ff;";
    wrap.appendChild(h);
    const rows = [
      ["存档时间", fmtConflictTime(src.time)],
      ["游玩时长", fmtConflictDuration(src.playSeconds)],
      ["已解锁技能", src.skillsN + " 项（总等级 " + src.skillsLvl + "）"],
      ["拥有舰船", src.shipsN + " 艘"],
      ["星币", Math.floor(src.isk).toLocaleString()],
      ["矿物种类", src.materialsN + " 种"]
    ];
    rows.forEach(function (r) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;gap:12px;font-size:13px;line-height:1.9;";
      const k = document.createElement("span"); k.style.opacity = ".7"; k.textContent = r[0];
      const v = document.createElement("span"); v.style.fontWeight = "600"; v.textContent = r[1];
      row.appendChild(k); row.appendChild(v); wrap.appendChild(row);
    });
    return wrap;
  }
  function buildSaveSnapshot(state) {
    try { return JSON.stringify(state, null, 2); } catch (e) { return ""; }
  }
  function downloadBackup(filename, text) {
    try {
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      if (document.body) document.body.appendChild(a);
      a.click();
      if (a.parentNode) a.parentNode.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 2000);
      return true;
    } catch (e) { return false; }
  }
  function summarizeLocal() {
    const pending = SaveManager && SaveManager._pendingDeviceCandidate;
    const s = (pending && pending.envelope && pending.envelope.payload) || gameState || {};
    const skills = s.skills || {};
    let skillsN = 0, skillsLvl = 0;
    Object.keys(skills).forEach(function (k) {
      const v = skills[k];
      if (v && typeof v === "object") { skillsN += 1; skillsLvl += (typeof v.lvl === "number" ? v.lvl : 0); }
    });
    const shipsN = (s.inventory && Array.isArray(s.inventory.ships)) ? s.inventory.ships.length : 0;
    const res = s.resources || {};
    const isk = (typeof res.isk === "number") ? res.isk : 0;
    let materialsN = 0;
    const minerals = res.minerals || {};
    Object.keys(minerals).forEach(function (k) { if (minerals[k] > 0) materialsN += 1; });
    let playSeconds = 0;
    if (s.statistics && s.statistics.lifecycle && typeof s.statistics.lifecycle.onlineSeconds === "number") {
      playSeconds = s.statistics.lifecycle.onlineSeconds;
    }
    const time = pending && pending.envelope ? pending.envelope.savedAt : s.lastSaveTime;
    return { time: time, playSeconds: playSeconds, skillsN: skillsN, skillsLvl: skillsLvl, shipsN: shipsN, isk: isk, materialsN: materialsN };
  }
  function summarizeCloud() {
    const penv = SaveManager._pendingCloudEnvelope;
    const env = (penv && penv.envelope) || null;
    const meta = (penv && penv.meta) || null;
    const s = (env && env.payload) ? env.payload : {};
    const skills = s.skills || {};
    let skillsN = 0, skillsLvl = 0;
    Object.keys(skills).forEach(function (k) {
      const v = skills[k];
      if (v && typeof v === "object") { skillsN += 1; skillsLvl += (typeof v.lvl === "number" ? v.lvl : 0); }
    });
    const shipsN = (s.inventory && Array.isArray(s.inventory.ships)) ? s.inventory.ships.length : 0;
    const res = s.resources || {};
    const isk = (typeof res.isk === "number") ? res.isk : 0;
    let materialsN = 0;
    const minerals = res.minerals || {};
    Object.keys(minerals).forEach(function (k) { if (minerals[k] > 0) materialsN += 1; });
    let playSeconds = 0;
    if (s.statistics && s.statistics.lifecycle && typeof s.statistics.lifecycle.onlineSeconds === "number") {
      playSeconds = s.statistics.lifecycle.onlineSeconds;
    }
    const time = (env && typeof env.savedAt === "number" && env.savedAt > 0) ? env.savedAt
      : (meta ? (typeof meta.updatedAt === "number" ? meta.updatedAt : (typeof meta.updated_at === "number" ? meta.updated_at : 0)) : 0);
    return { time: time, playSeconds: playSeconds, skillsN: skillsN, skillsLvl: skillsLvl, shipsN: shipsN, isk: isk, materialsN: materialsN };
  }
  function showConflictError(err) {
    try {
      const el = document.getElementById("boot-conflict-error");
      if (el) el.textContent = "处理失败：" + ((err && err.message) ? err.message : String(err)) + "（可重试或先导出备份）";
    } catch (e) { /* ignore */ }
  }

  function showConflictChoice() {
    try {
      if (document.getElementById("boot-conflict-choice")) return;
      const overlay = document.createElement("div");
      overlay.id = "boot-conflict-choice";
      overlay.setAttribute("role", "alertdialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.style.cssText = "position:fixed;inset:0;z-index:99998;background:rgba(8,10,18,.96);color:#e8ecf4;" +
        "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
        "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;text-align:center;overflow:auto;";
      const h = document.createElement("h1");
      h.textContent = "检测到云端存档冲突";
      h.style.cssText = "font-size:22px;margin:0 0 8px;";
      const p = document.createElement("p");
      p.textContent = "本地存档与云端存档均已修改且内容不同。请选择使用哪一份（选择后另一份将被覆盖，不可撤销）。建议先导出两份备份再选择。";
      p.style.cssText = "max-width:620px;line-height:1.6;opacity:.85;margin:0 0 18px;";

      // 明细：本地 vs 云端
      const detailRow = document.createElement("div");
      detailRow.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;justify-content:center;max-width:720px;width:100%;margin-bottom:8px;";
      detailRow.appendChild(conflictSummarySection("本地存档", summarizeLocal()));
      detailRow.appendChild(conflictSummarySection("云端存档", summarizeCloud()));

      // 导出备份按钮（仅真实触发后才显示「已导出」）
      const exportRow = document.createElement("div");
      exportRow.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-bottom:18px;";
      const expLocal = document.createElement("button");
      expLocal.className = "btn";
      expLocal.textContent = "导出本地备份";
      expLocal.style.cssText = "min-width:140px;padding:8px 12px;font-size:13px;border:0;border-radius:8px;cursor:pointer;background:#33415c;color:#e8ecf4;";
      const localPayload = (SaveManager._pendingDeviceCandidate && SaveManager._pendingDeviceCandidate.envelope)
        ? SaveManager._pendingDeviceCandidate.envelope.payload : gameState;
      expLocal.addEventListener("click", function () {
        const ok = downloadBackup("local-save-backup-" + Date.now() + ".json", buildSaveSnapshot(localPayload));
        expLocal.textContent = ok ? "已导出 ✓" : "导出失败";
      });
      const expCloud = document.createElement("button");
      expCloud.className = "btn";
      expCloud.textContent = "导出云端备份";
      expCloud.style.cssText = "min-width:140px;padding:8px 12px;font-size:13px;border:0;border-radius:8px;cursor:pointer;background:#33415c;color:#e8ecf4;";
      const cloudPayload = (SaveManager._pendingCloudEnvelope && SaveManager._pendingCloudEnvelope.envelope) ? SaveManager._pendingCloudEnvelope.envelope.payload : null;
      if (!cloudPayload) { expCloud.disabled = true; expCloud.style.opacity = ".5"; expCloud.title = "云端存档不可用"; }
      expCloud.addEventListener("click", function () {
        if (!cloudPayload) return;
        const ok = downloadBackup("cloud-save-backup-" + Date.now() + ".json", buildSaveSnapshot(cloudPayload));
        expCloud.textContent = ok ? "已导出 ✓" : "导出失败";
      });
      exportRow.appendChild(expLocal); exportRow.appendChild(expCloud);

      // 选择按钮
      const btnStyle = "min-width:170px;padding:12px 18px;font-size:15px;border:0;border-radius:8px;cursor:pointer;";
      const localBtn = document.createElement("button");
      localBtn.textContent = "使用本地存档";
      localBtn.style.cssText = btnStyle + "background:#2f6df6;color:#fff;";
      const cloudBtn = document.createElement("button");
      cloudBtn.textContent = "使用云端存档";
      cloudBtn.style.cssText = btnStyle + "background:#16a085;color:#fff;";
      const choose = function (choice, btn) {
        if (overlay._resolving) return;
        overlay._resolving = true;
        localBtn.disabled = true; cloudBtn.disabled = true;
        btn.textContent = (choice === "local" ? "使用本地存档" : "使用云端存档") + "：处理中…";
        btn.style.opacity = ".8";
        Promise.resolve(SaveManager.resolveCloudConflict(choice)).then(function () {
          hideConflictChoice(); // 成功：移除遮罩（onBootState ready 也会移除，幂等）
        }).catch(function (err) {
          // 失败：恢复按钮 + 显示错误，允许重试（不移除遮罩、不静默覆盖）
          overlay._resolving = false;
          localBtn.disabled = false; cloudBtn.disabled = false;
          localBtn.textContent = "使用本地存档"; cloudBtn.textContent = "使用云端存档";
          localBtn.style.opacity = "1"; cloudBtn.style.opacity = "1";
          showConflictError(err);
        });
      };
      localBtn.addEventListener("click", function () { choose("local", localBtn); });
      cloudBtn.addEventListener("click", function () { choose("cloud", cloudBtn); });
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;justify-content:center;margin-bottom:6px;";
      row.appendChild(localBtn); row.appendChild(cloudBtn);

      const errNote = document.createElement("div");
      errNote.id = "boot-conflict-error";
      errNote.style.cssText = "color:#ff6b6b;font-size:13px;min-height:18px;margin-top:6px;max-width:560px;";

      overlay.appendChild(h); overlay.appendChild(p); overlay.appendChild(detailRow);
      overlay.appendChild(exportRow); overlay.appendChild(row); overlay.appendChild(errNote);
      if (document.body) document.body.appendChild(overlay);

      // 忽略 Escape：捕获阶段阻止默认与冒泡，绝不静默关闭。
      _conflictKeyHandler = function (e) {
        if (e && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); }
      };
      document.addEventListener("keydown", _conflictKeyHandler, true);
    } catch (e) {
      console.error("BOOT CONFLICT UI", e);
    }
  }

  function hideConflictChoice() {
    try {
      if (_conflictKeyHandler) { document.removeEventListener("keydown", _conflictKeyHandler, true); _conflictKeyHandler = null; }
      const el = document.getElementById("boot-conflict-choice");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch (e) { /* ignore */ }
  }

  // 监听 boot 状态：awaiting-choice 弹出冲突浮层；ready / error 收起（决定·六 / ·十）。
  function onBootState(e) {
    var st = e && e.detail && e.detail.state;
    if (st === "awaiting-choice") showConflictChoice();
    else if (st === "ready" || st === "error") hideConflictChoice();
  }

  function launch() {
    if (typeof SaveManager === "undefined" || !SaveManager) {
      console.error("SaveManager 未定义，无法引导启动");
      return;
    }
    if (SaveManager._bootStarted) return; // 防止重复 bootstrap（兜底）
    // 同步调用：bootstrap() 内的本地读档 + 迁移在本函数返回前同步完成，
    // 不包裹在 Promise.then 中（否则会推迟到微任务，晚于 render.js 模块加载）。
    var bootPromise = null;
    try {
      bootPromise = SaveManager.bootstrap();
    } catch (err) {
      console.error("BOOT FATAL", err);
      showFatalBootError(err);
      return;
    }
    // 异步链失败（本地读档/迁移抛错 → Promise.reject，或云端任何非覆盖性错误）一律阻塞错误页，
    // 绝不静默开新档（决定·十 fail closed）。
    if (bootPromise && typeof bootPromise.catch === "function") {
      bootPromise.catch(function (err) { console.error("BOOT FATAL", err); showFatalBootError(err); });
    }
  }

  if (typeof document !== "undefined") {
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("bootstatechange", onBootState);
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", launch, { once: true });
    } else {
      launch();
    }
  }
})();
