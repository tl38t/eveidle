// js/ui/ad-buff-widget.js
// 脑突触加速剂 UI：顶栏状态（标题右侧）+ 注入弹窗。
// 仅 TapTap 真机(mode==='taptap')且过首次启动 60s 宽限期显示；本地调试 ?debugAd=1 强制显示。
// 增益状态/提取剂库存见 js/systems/ad-buff.js；重复脑插→小型提取剂的转化在 js/data/implants.js。

(function () {
  const BOOT_GRACE_MS = 60 * 1000; // TapTap 审核规范：首次启动 60 秒内不出现广告
  const bootTime = Date.now();
  let wrapEl = null, statusEl = null, pauseBtn = null, injectBtn = null, updater = null, modalEl = null;
  let probeBadge = null, probePanel = null, probeTimer = null;
  let probeFaultMode = false;

  // 本地调试开关：URL 带 ?debugAd=1 或 localStorage.debugAd==='1' 时，强制显示顶栏状态/按钮（顶栏不受真机宽限约束），
  // 「获取」按钮在本地无真 window.tap 时模拟「看完广告」直接发放大型提取剂。
  function isAdDebug() {
    try {
      const p = new URLSearchParams(location.search);
      if (p.get("debugAd") === "1") return true;
      if (typeof localStorage !== "undefined" && localStorage.getItem("debugAd") === "1") return true;
    } catch (e) {}
    return false;
  }
  const DEBUG = isAdDebug();

  function safeToast(msg) {
    if (typeof showToast === "function") showToast(msg);
    else console.log("[ad-buff]", msg);
  }

  function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  // 把 TapTap SDK 返回的原始错误解码成大白话，并给出最可能的原因与下一步动作。
  function decodeAdError(le) {
    const raw = (le && le.errMsg) ? le.errMsg : (le ? String(le) : "");
    if (/odinCode[=:\s]*200001/i.test(raw)) {
      return {
        title: "平台内部错误 odinCode=200001（无填充）",
        detail: "TapTap 广告平台返回 200001，即「请求未拿到可投放素材」。最常见三件事：\n" +
          "1) 你在 Dirichlet 新建的测试广告尚未生效（测试开关没开 / 没点保存 / 需等平台同步）；\n" +
          "2) 测试广告填写的 OAID 与当前真机设备的 OAID 不一致（素材定向不到你的设备）；\n" +
          "3) 身份审核未通过，正式广告位不可用，仅测试广告能跑，但测试广告配置不完整。"
      };
    }
    if (/no.?fill|无填充|NO_FILL/i.test(raw)) {
      return { title: "广告无填充 (no fill)", detail: "该广告位当前没有可投放素材。检查测试广告是否已生效、OAID 是否匹配当前设备。" };
    }
    if (/ad[_]?unit|广告位.*(无效|未|错)|invalid.*id|未配置|不存在/i.test(raw)) {
      return { title: "广告位 ID 无效 / 未配置", detail: "代码当前使用的竖屏 adUnitId = 1054324（横屏备用 1054323），均由 TapTap MCP check_ads_status 核验。若后台仍提示无效，请确认 Dirichlet 推广位 1054324 已生效且横竖屏类型匹配；若后台实际 ID 不同，把新 ID 发我，我改代码后重新打包。" };
    }
    if (/timeout|超时|load/i.test(raw)) {
      return { title: "广告加载超时 / 失败", detail: "素材拉取问题，多为网络或无填充。可重试一次；若一直如此，本质仍是 200001 类无填充。" };
    }
    return { title: "未知广告错误", detail: "原始信息：" + raw.slice(0, 160) + "\n请把这段发我，我据此定位具体原因。" };
  }

  // 广告失败后自动弹出故障面板（大白话），无需用户去翻 ⚙。
  function showAdFault(err) {
    ensureProbe();
    probeFaultMode = true;
    try { if (typeof getAdStatus === "function") getAdStatus(); } catch (e) {}
    if (probePanel) { probePanel.style.display = "block"; renderProbe(); }
    if (probeTimer) clearInterval(probeTimer);
    probeTimer = setInterval(renderProbe, 1000);
  }

  // ---- 顶部状态区：插入到 .brand（标题）之后 ----
  function ensureDom() {
    if (wrapEl) return;
    const brand = document.querySelector(".topbar .brand") || document.querySelector(".brand");
    if (!brand) { setTimeout(ensureDom, 300); return; }
    wrapEl = document.createElement("span");
    wrapEl.setAttribute("data-adb-wrap", "1");
    wrapEl.style.cssText = "display:inline-flex;align-items:center;gap:8px;margin-left:14px;font:12px/1.4 system-ui,-apple-system,'Microsoft YaHei',sans-serif;";

    statusEl = document.createElement("span");
    statusEl.setAttribute("data-adb-status", "1");
    statusEl.style.cssText = "white-space:nowrap;color:#7fe3ff;cursor:pointer;";
    statusEl.title = "脑突触加速：点击管理注入 / 获取；长按打开广告诊断";
    statusEl.addEventListener("click", openModal);
    attachProbeTrigger(statusEl);

    pauseBtn = document.createElement("button");
    pauseBtn.setAttribute("data-adb-pause", "1");
    pauseBtn.className = "btn btn-sm";
    pauseBtn.style.cssText = "cursor:pointer;";
    pauseBtn.addEventListener("click", onPauseClick);

    wrapEl.appendChild(statusEl);
    wrapEl.appendChild(pauseBtn);
    brand.insertAdjacentElement("afterend", wrapEl);
  }

  function onPauseClick() {
    const st = (typeof getAdBuffStatus === "function") ? getAdBuffStatus(gameState) : { active: false, paused: false };
    if (st.paused) {
      if (typeof resumeCerebralPlasma === "function") resumeCerebralPlasma(gameState);
      safeToast("脑突触加速已继续");
    } else if (st.active) {
      if (typeof pauseCerebralPlasma === "function") pauseCerebralPlasma(gameState);
      safeToast("脑突触加速已暂停（不消耗时间、不享受增益）");
    }
    update();
  }

  function update() {
    if (!statusEl) return;
    const mode = (typeof getAdStatus === "function" && getAdStatus().mode) || "local-only";
    // 直接探测平台可用性，不依赖 ad-service 的异步刷新：TapTap 运行时注入 window.tap 的时机不确定，
    // 若只信 getAdStatus().mode 可能在 tap 注入后仍有 1 秒延迟。detectTapTapAvailable 是只读轻量探测。
    const taptapAvail = (typeof window !== "undefined" && window.AdPlatformConfig && typeof window.AdPlatformConfig.detectTapTapAvailable === "function")
      ? window.AdPlatformConfig.detectTapTapAvailable() : false;
    const isTaptap = mode === "taptap" || taptapAvail;
    const pastGrace = DEBUG ? true : Date.now() - bootTime > BOOT_GRACE_MS;
    if (!DEBUG && (!isTaptap || !pastGrace)) { if (wrapEl) wrapEl.style.display = "none"; showProbeBadge(); return; }
    if (wrapEl) wrapEl.style.display = "inline-flex";
    // 入口显示时仍保留一个低调的小探针点，方便诊断广告加载失败。
    showProbeBadge(true);

    const st = (typeof getAdBuffStatus === "function") ? getAdBuffStatus(gameState) : { active: false, paused: false, remainingMs: 0 };
    if (st.active || st.paused) {
      statusEl.textContent = "🧠 脑突触加速 " + (st.paused ? "⏸ " : "⚡ ") + fmt(st.remainingMs);
      statusEl.style.color = st.active ? "#7fe3ff" : "#9fb0c0";
    } else {
      statusEl.textContent = "🧠 脑突触加速 —";
      statusEl.style.color = "#9fb0c0";
    }

    if (st.active) { pauseBtn.style.display = ""; pauseBtn.disabled = false; pauseBtn.textContent = "⏸ 暂停"; }
    else if (st.paused) { pauseBtn.style.display = ""; pauseBtn.disabled = false; pauseBtn.textContent = "▶ 继续"; }
    else { pauseBtn.style.display = "none"; }
  }

  function hideAll() { if (wrapEl) wrapEl.style.display = "none"; }

  // 长按/右键状态区唤出广告诊断探针（入口显示时也能查看）。
  function attachProbeTrigger(el) {
    let timer = null;
    function clear() { if (timer) { clearTimeout(timer); timer = null; } }
    el.addEventListener("touchstart", function (e) { clear(); timer = setTimeout(function () { toggleProbe(); }, 800); }, { passive: true });
    el.addEventListener("touchend", clear);
    el.addEventListener("touchmove", clear);
    el.addEventListener("mousedown", function (e) {
      if (e.button === 2) { e.preventDefault(); toggleProbe(); return; }
      clear(); timer = setTimeout(function () { toggleProbe(); }, 800);
    });
    el.addEventListener("mouseup", clear);
    el.addEventListener("mouseleave", clear);
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  // ---- 自诊断探针（自测包用）：广告入口为何不显示，一目了然 ----
  // 入口被隐藏时左下角自动浮现 ⚙ 角标；也可全局 Ctrl+Shift+D 唤出。
  function ensureProbe() {
    if (probeBadge) return;
    probeBadge = document.createElement("div");
    probeBadge.setAttribute("data-adb-probe-badge", "1");
    probeBadge.textContent = "⚙";
    probeBadge.title = "广告诊断：点开查看为何未显示广告入口";
    probeBadge.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9000;width:30px;height:30px;border-radius:50%;background:rgba(20,28,40,.85);border:1px solid #2a3a4a;color:#8fb6d8;display:none;align-items:center;justify-content:center;cursor:pointer;font-size:15px;";
    probeBadge.addEventListener("click", toggleProbe);
    document.body.appendChild(probeBadge);

    probePanel = document.createElement("div");
    probePanel.setAttribute("data-adb-probe-panel", "1");
    probePanel.style.cssText = "position:fixed;left:8px;bottom:44px;z-index:9001;width:min(360px,92vw);max-height:72vh;overflow:auto;background:#0a121e;border:1px solid #1d2c3c;border-radius:10px;padding:12px 14px;color:#cdd9e5;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;box-shadow:0 8px 30px rgba(0,0,0,.5);display:none;";
    document.body.appendChild(probePanel);

    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) { e.preventDefault(); toggleProbe(); }
    });
  }

  function showProbeBadge(subtle) {
    if (!probeBadge) return;
    probeBadge.style.display = "flex";
    if (subtle) {
      probeBadge.style.opacity = ".35";
      probeBadge.style.transform = "scale(.75)";
      probeBadge.textContent = "·";
    } else {
      probeBadge.style.opacity = "1";
      probeBadge.style.transform = "scale(1)";
      probeBadge.textContent = "⚙";
    }
  }
  function hideProbeBadge() { if (probeBadge) probeBadge.style.display = "none"; }

  function toggleProbe() {
    if (!probePanel) return;
    if (probePanel.style.display === "none" || !probePanel.style.display) {
      probePanel.style.display = "block";
      renderProbe();
      if (probeTimer) clearInterval(probeTimer);
      probeTimer = setInterval(renderProbe, 1000);
    } else {
      probePanel.style.display = "none";
      if (probeTimer) { clearInterval(probeTimer); probeTimer = null; }
    }
  }

  function renderProbe() {
    if (!probePanel) return;
    const tap = (typeof window !== "undefined") ? window.tap : null;
    const tapKeys = (tap && typeof tap === "object") ? Object.keys(tap).slice(0, 24) : [];
    const tapCreateType = tap ? typeof tap.createRewardedVideoAd : "n/a";
    const detect = (window.AdPlatformConfig && typeof window.AdPlatformConfig.detectTapTapAvailable === "function")
      ? window.AdPlatformConfig.detectTapTapAvailable() : null;
    const status = (typeof getAdStatus === "function") ? getAdStatus() : { mode: "n/a" };
    const mode = status.mode || "n/a";
    const isTaptap = (mode === "taptap") || !!detect;
    const pastGrace = Date.now() - bootTime > BOOT_GRACE_MS;
    const urlP = (typeof location !== "undefined") ? new URLSearchParams(location.search).get("debugAd") : null;
    const lsP = (typeof localStorage !== "undefined") ? localStorage.getItem("debugAd") : null;
    const brandExists = !!(document.querySelector(".topbar .brand") || document.querySelector(".brand"));
    const usedAdUnitId = (window.AdPlatformConfig && typeof window.AdPlatformConfig.resolveAdUnitId === "function")
      ? window.AdPlatformConfig.resolveAdUnitId("rewarded_default") : null;
    const lines = [
      "== 广告诊断 ==",
      "代码使用的 adUnitId: " + usedAdUnitId,
      "URL: " + ((location.href || "").length > 120 ? location.href.slice(0, 120) + "…" : location.href),
      "UA: " + ((navigator.userAgent || "n/a").slice(0, 84)),
      "debugAd: url=" + urlP + " localStorage=" + lsP + " DEBUG=" + DEBUG,
      "启动已过: " + Math.floor((Date.now() - bootTime) / 1000) + "s / 宽限=" + (BOOT_GRACE_MS / 1000) + "s  pastGrace=" + pastGrace,
      "window.tap 存在: " + (tap ? "YES" : "NO"),
      "tap.createRewardedVideoAd: " + tapCreateType,
      "detectTapTapAvailable(): " + detect,
      "getAdStatus().mode: " + mode,
      "TaptapAdProvider: " + (typeof window.TaptapAdProvider) + "  NoopAdProvider: " + (typeof window.NoopAdProvider),
      "DOM .brand 存在: " + brandExists,
      "=> isTaptap(计算): " + isTaptap
    ];

    probePanel.innerHTML = "";
    // 故障卡片：广告失败时自动弹出，用大白话解释
    if (probeFaultMode && status.lastAdError) {
      const decoded = decodeAdError(status.lastAdError);
      const card = document.createElement("div");
      card.style.cssText = "border:1px solid #5a2230;background:#1a0e12;border-radius:8px;padding:10px;margin-bottom:10px;";
      const t = document.createElement("div");
      t.style.cssText = "color:#ff9aa8;font-weight:700;margin-bottom:6px;font-size:13px;";
      t.textContent = "⚠ 广告故障：" + decoded.title;
      card.appendChild(t);
      const d = document.createElement("div");
      d.style.cssText = "color:#e8c4cc;white-space:pre-line;font-size:12px;line-height:1.6;";
      d.textContent = decoded.detail;
      card.appendChild(d);
      const idLine = document.createElement("div");
      idLine.style.cssText = "color:#cdd9e5;margin-top:6px;font-size:12px;";
      idLine.textContent = "代码使用的 adUnitId = " + usedAdUnitId + "（务必与你在 Dirichlet 新建的测试广告位 ID 一致）";
      card.appendChild(idLine);
      const rawLine = document.createElement("div");
      rawLine.style.cssText = "color:#9fb0c0;margin-top:4px;font-size:11px;word-break:break-all;";
      rawLine.textContent = "原始错误：" + String((status.lastAdError && (status.lastAdError.errMsg || status.lastAdError.errCode)) || JSON.stringify(status.lastAdError) || "无").slice(0, 200);
      card.appendChild(rawLine);
      probePanel.appendChild(card);
    } else if (probeFaultMode) {
      const card = document.createElement("div");
      card.style.cssText = "border:1px solid #2a3a4a;background:#0c1622;border-radius:8px;padding:10px;margin-bottom:10px;color:#9fb0c0;font-size:12px;";
      card.textContent = "尚未捕获到广告错误。请先点弹窗里的「获取」按钮触发一次广告请求。";
      probePanel.appendChild(card);
    }

    const pre = document.createElement("div");
    pre.textContent = lines.join("\n");
    probePanel.appendChild(pre);

    const force = document.createElement("button");
    force.className = "btn primary";
    force.style.cssText = "margin-top:8px;width:100%;padding:8px;font-size:12px;cursor:pointer;";
    force.textContent = "强制开启广告调试 (debugAd=1) → 重载";
    force.addEventListener("click", function () {
      try { localStorage.setItem("debugAd", "1"); } catch (e) {}
      location.reload();
    });
    probePanel.appendChild(force);

    const copy = document.createElement("button");
    copy.className = "btn";
    copy.style.cssText = "margin-top:6px;width:100%;padding:8px;font-size:12px;cursor:pointer;";
    copy.textContent = "复制诊断信息";
    copy.addEventListener("click", function () {
      try { if (navigator.clipboard) navigator.clipboard.writeText(lines.join("\n")); } catch (e) {}
      safeToast("诊断已复制");
    });
    probePanel.appendChild(copy);
  }

  // ---- 弹窗 ----
  function openModal() {
    closeModal();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-adb-modal", "1");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(4,8,14,.82);display:flex;align-items:center;justify-content:center;z-index:3000;";
    const box = document.createElement("div");
    box.style.cssText = "position:relative;width:min(440px,92vw);max-height:86vh;overflow:auto;background:#0a121e;border:1px solid #1d2c3c;border-radius:14px;padding:18px 20px;color:#cdd9e5;font:14px/1.6 system-ui,-apple-system,'Microsoft YaHei',sans-serif;box-shadow:0 8px 40px rgba(0,0,0,.5);";
    overlay.appendChild(box);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
    modalEl = overlay;
    renderModalMain(box);
  }

  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }

  function buildHead(box, titleText) {
    const head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;";
    const title = document.createElement("div");
    title.style.cssText = "font-size:16px;font-weight:700;color:#e6eef6;";
    title.textContent = titleText;
    const x = document.createElement("div");
    x.textContent = "✕";
    x.style.cssText = "cursor:pointer;color:#8a9aae;font-size:18px;line-height:1;";
    x.addEventListener("click", closeModal);
    head.appendChild(title); head.appendChild(x);
    box.appendChild(head);
  }

  function watchReason(st) {
    if (st.dailyCount >= st.dailyCap) return "今日已看完(" + st.dailyCount + "/" + st.dailyCap + ")";
    return "间隔中";
  }

  function renderModalMain(box) {
    box.innerHTML = "";
    buildHead(box, "脑突触加速");

    const intro = document.createElement("div");
    intro.style.cssText = "font-size:13px;color:#aebccb;line-height:1.7;margin-bottom:12px;";
    intro.innerHTML = "看完<b>联盟泛银河娱乐广播</b>，或转化重复脑插，可获得<b>脑突触加速提取剂</b>。<br>注入后生效：<b>采矿 / 采气 / 冶炼效率、玩家战斗伤害、技能经验 ×1.3</b>。<br>大型提取剂 30 分钟（看广告获取），小型提取剂 5 分钟（重复脑插转化）。";
    box.appendChild(intro);

    const st = (typeof getAdBuffStatus === "function") ? getAdBuffStatus(gameState) : { extractors: { large: 0, small: 0 }, canWatch: false, dailyCount: 0, dailyCap: 10 };
    const ex = st.extractors || { large: 0, small: 0 };
    const inv = document.createElement("div");
    inv.style.cssText = "font-size:13px;color:#9fd0e8;margin-bottom:14px;padding:8px 10px;border:1px solid #1d2c3c;border-radius:8px;background:#0c1622;";
    inv.textContent = "当前库存：大型 ×" + ex.large + "（30分） · 小型 ×" + ex.small + "（5分）";
    box.appendChild(inv);

    const total = (typeof getTotalExtractorDurationMs === "function") ? getTotalExtractorDurationMs(gameState) : 0;
    const hasAny = (ex.large + ex.small) > 0;

    // 按钮① 注入（主操作）
    const injectBtn2 = document.createElement("button");
    injectBtn2.className = "btn primary";
    injectBtn2.style.cssText = "display:block;width:100%;margin-bottom:10px;padding:10px;font-size:14px;cursor:pointer;";
    injectBtn2.textContent = hasAny ? "💉 注入脑突触加速提取剂" : "💉 注入脑突触加速提取剂（无库存）";
    if (hasAny) injectBtn2.addEventListener("click", function () { renderInjectConfirm(box, ex, total); });
    else { injectBtn2.disabled = true; injectBtn2.style.opacity = ".4"; injectBtn2.style.pointerEvents = "none"; }
    box.appendChild(injectBtn2);

    // 按钮② 获取
    const obtainBtn = document.createElement("button");
    const canWatch = !!st.canWatch;
    obtainBtn.className = "btn";
    obtainBtn.style.cssText = "display:block;width:100%;padding:10px;font-size:14px;cursor:pointer;";
    obtainBtn.textContent = canWatch ? "📺 获取（收看联盟泛银河娱乐广播）" : ("📺 获取（" + watchReason(st) + "）");
    if (canWatch) obtainBtn.addEventListener("click", function () { renderObtainConfirm(box); });
    else { obtainBtn.disabled = true; obtainBtn.style.opacity = ".4"; obtainBtn.style.pointerEvents = "none"; }
    box.appendChild(obtainBtn);
  }

  function renderInjectConfirm(box, ex, total) {
    box.innerHTML = "";
    buildHead(box, "注入脑突触加速提取剂");
    const msg = document.createElement("div");
    msg.style.cssText = "font-size:14px;color:#cdd9e5;margin:6px 0 16px;line-height:1.7;";
    const min = Math.floor(total / 60000), sec = Math.floor((total % 60000) / 1000);
    msg.innerHTML = "是否<b>注入全部</b>脑突触加速提取剂？<br>大型 ×" + ex.large + "（30分） + 小型 ×" + ex.small + "（5分） = <b>" + min + "分" + (sec ? (sec + "秒") : "") + "</b>";
    box.appendChild(msg);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;";
    const ok = document.createElement("button");
    ok.textContent = "确认注入";
    ok.className = "btn primary";
    ok.style.cssText = "flex:1;padding:10px;font-size:14px;cursor:pointer;";
    ok.addEventListener("click", function () {
      const added = (typeof injectAllExtractors === "function") ? injectAllExtractors(gameState) : 0;
      const after = (typeof getAdBuffStatus === "function") ? getAdBuffStatus(gameState) : { remainingMs: added, paused: false };
      safeToast("已注入脑突触加速提取剂，剩余 " + fmt(after.remainingMs) + (after.paused ? "（已暂停）" : ""));
      closeModal(); update();
    });
    const back = document.createElement("button");
    back.textContent = "返回";
    back.className = "btn";
    back.style.cssText = "flex:1;padding:10px;font-size:14px;cursor:pointer;";
    back.addEventListener("click", function () { renderModalMain(box); });
    row.appendChild(ok); row.appendChild(back);
    box.appendChild(row);
  }

  function renderObtainConfirm(box) {
    box.innerHTML = "";
    buildHead(box, "获取脑突触加速提取剂");
    const msg = document.createElement("div");
    msg.style.cssText = "font-size:14px;color:#cdd9e5;margin:6px 0 16px;line-height:1.7;";
    msg.innerHTML = "是否收看<b>联盟泛银河娱乐广播</b>以获取脑突触加速提取剂（大型，30 分钟）？";
    box.appendChild(msg);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;";
    const ok = document.createElement("button");
    ok.textContent = "确认收看";
    ok.className = "btn primary";
    ok.style.cssText = "flex:1;padding:10px;font-size:14px;cursor:pointer;";
    ok.addEventListener("click", function () { doObtain(box); });
    const back = document.createElement("button");
    back.textContent = "返回";
    back.className = "btn";
    back.style.cssText = "flex:1;padding:10px;font-size:14px;cursor:pointer;";
    back.addEventListener("click", function () { renderModalMain(box); });
    row.appendChild(ok); row.appendChild(back);
    box.appendChild(row);
  }

  function doObtain(box) {
    if (typeof canWatchAd === "function" && !canWatchAd(gameState)) {
      safeToast("今日已看完或间隔未到");
      closeModal(); return;
    }
    // 本地调试：无真 window.tap 时模拟看完广告，直接发放大型提取剂
    if (DEBUG && (typeof getAdStatus !== "function" || getAdStatus().mode !== "taptap")) {
      if (typeof addExtractor === "function") addExtractor(gameState, "large", 1);
      if (typeof recordAdWatch === "function") recordAdWatch(gameState);
      safeToast("🧪 [调试] 已获得大型脑突触加速提取剂 ×1");
      closeModal(); update(); return;
    }
    if (typeof window.showRewardedAd !== "function") { safeToast("广告功能未就绪"); closeModal(); return; }
    closeModal();
    window.showRewardedAd("rewarded_default", {
      onReward() {
        if (typeof addExtractor === "function") addExtractor(gameState, "large", 1);
        if (typeof recordAdWatch === "function") recordAdWatch(gameState);
        safeToast("获得大型脑突触加速提取剂 ×1（30 分钟）");
        update();
      },
      onSkip() { safeToast("未看完广播，未获得提取剂"); },
      onError(err) {
        const detail = (err && err.errMsg) ? err.errMsg : String(err || "");
        safeToast("广告加载失败" + (detail ? "：" + detail.slice(0, 80) : ""));
        showAdFault(err);
      }
    });
  }

  function init() {
    if (typeof document === "undefined" || !document.body) { setTimeout(init, 200); return; }
    ensureDom();
    ensureProbe();
    update();
    if (updater) clearInterval(updater);
    updater = setInterval(update, 1000);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
