(function (root) {
  "use strict";

  var cloudOrigin = "https://alliance-deepspace-d4govx4ikc2e937c5.webapps.tcloudbase.com";
  var taskGateway = "https://deepspace-d4govx4ikc2e937c5-1477691191.ap-shanghai.app.tcloudbase.com/alliance-daily-tasks";
  var adminGateway = "https://deepspace-d4govx4ikc2e937c5-1477691191.ap-shanghai.app.tcloudbase.com/alliance-admin";
  var cloudTaskStatus = "local";
  // 任务条数收敛用状态（2026-09-20）。
  // 任务大厅等级是任务条数的权威来源，但它来自 alliance_buildings，只有 getAlliance() 之后
  // 才到位；而任务同步 fetch 在 getAlliance() 之前就发出去了 ⇒ 首轮只能按本地旧的建筑数据
  // 估算（常常退化成 5）。服务端 ensureTasks 又是按「客户端 preview 长度」建行的 ⇒ 两边互相
  // 等对方先变成 6，全天卡在 5 条（实测 2026-09-20：大厅 L2 应为 6，DB 当天只有 slot 1-5，
  // 而 09-12 / 09-18 都是 6 行）。所以：
  //   renderedTaskCount   = 上一次真正渲染出的任务行数，建筑数据到位后据此判断要不要补条数；
  //   reloadedHallCount    = 已经为哪个大厅条数触发过一次收敛重绘（防 load() 死循环）；
  //   cloudTaskSyncDone    = 本次进页面后是否已经发过同步（保持原 cloudTaskSyncStarted 的
  //                          「一次性」语义；收敛时显式复位，一次进页面最多补一次）；
  //   cloudTaskSyncAttempts = 已发出的同步次数，多次都补不上就退回服务端条数（见下方兜底）。
  var cloudTaskSyncDone = false;
  var cloudTaskSyncAttempts = 0;
  var cloudTaskAttemptDate = "";
  var renderedTaskCount = 0;
  var reloadedHallCount = -1;
  var activeCloudUrl = "";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // 最后上线时间 → 相对时间（如「3 小时前」）。导出便于单测。
  function formatRelativeTime(value) {
    if (!value) return "从未上线";
    var t = new Date(value).getTime();
    if (isNaN(t)) return "从未上线";
    var diff = Date.now() - t;
    if (diff < 0) diff = 0;
    var min = Math.floor(diff / 60000);
    if (min < 1) return "刚刚";
    if (min < 60) return min + " 分钟前";
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + " 小时前";
    var day = Math.floor(hr / 24);
    if (day < 30) return day + " 天前";
    var mon = Math.floor(day / 30);
    if (mon < 12) return mon + " 个月前";
    return Math.floor(mon / 12) + " 年前";
  }
  // 成员行字段归一化：唯一权威。云端 RPC / relay 回传载荷是 snake_case
  // （daily_points / total_points / last_online_at），原生 AllianceApi 是 camelCase。
  // 两条渲染路径（云端直读、云端回传）都必须先过这里，禁止在别处再写一份字段映射。
  function normalizeMemberRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(function (row) {
      row = row || {};
      return {
        playerId: row.playerId != null ? row.playerId : (row.player_id != null ? row.player_id : ""),
        username: row.username || "",
        isOwner: row.isOwner != null ? !!row.isOwner : !!row.is_owner,
        totalPoints: Number(row.totalPoints != null ? row.totalPoints : row.total_points) || 0,
        dailyPoints: Number(row.dailyPoints != null ? row.dailyPoints : row.daily_points) || 0,
        lastOnlineAt: row.lastOnlineAt || row.last_online_at || null
      };
    });
  }

  // 成员行的「当日 X · 总 Y · Z前」统计行。两条渲染路径共用，避免出现第二种格式。
  function renderMemberStatsLine(member) {
    return '<span class="text-muted" style="display:block;font-size:12px;margin-top:2px;">当日 ' + esc(member.dailyPoints) + ' · 总 ' + esc(member.totalPoints) + ' · ' + esc(formatRelativeTime(member.lastOnlineAt)) + '</span>';
  }

  root.AllianceRenderHelpers = {
    formatRelativeTime: formatRelativeTime,
    normalizeMemberRows: normalizeMemberRows,
    identityKindLabel: identityKindLabel,
    shortIdentity: shortIdentity,
    renderIdentityCardHtml: renderIdentityCardHtml
  };

  // In-game direct cloud read (desktop first). TapTap keeps working because any
  // network failure degrades to the cloud-page fallback below.
  var activeRender = null;

  function setCloudButtonVisible(visible) {
    var button = document.getElementById("btn-open-cloud-test");
    if (button) button.style.display = visible ? "" : "none";
  }

  function isTapTapRuntime() {
    var tap = root.tap || (typeof globalThis !== "undefined" && globalThis.tap);
    var playerId = root.AllianceApi && root.AllianceApi.getPlayerId ? root.AllianceApi.getPlayerId() : "";
    return !!(tap && typeof tap.login === "function") || /^taptap_/.test(String(playerId));
  }

  function openCloudRelay(params) {
    if (!activeCloudUrl) return false;
    var suffix = Object.keys(params || {}).map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(params[key] == null ? "" : params[key]);
    }).join("&");
    root.location.href = activeCloudUrl + (suffix ? "&" + suffix : "");
    return true;
  }

  // alliance_daily_tasks 表没有 required_level 列：云函数 normalizeTasks 会校验该字段，
  // 但建表/写入都不落库，所以云端回传的行必然缺它。旧代码把 Number(undefined) 直接写进
  // 本地缓存（JSON 序列化后是 null），下次整份 preview 上行时服务端判「技能门槛无效」
  // ⇒ 整次同步失败、面板退回本地预览（表现就是「连不上/没有提交按钮」）。
  // 这里按「云端值 → 本次已上行值 → 本地任务目录(按 materialId) → 1」补齐，使往返无损。
  function coerceRequiredLevel() {
    for (var i = 0; i < arguments.length; i++) {
      var value = Number(arguments[i]);
      if (Number.isInteger(value) && value >= 1 && value <= 100) return value;
    }
    return 1;
  }

  function buildRequiredLevelMap(env) {
    var map = {};
    try {
      var catalog = env && env.AllianceTaskCatalog && env.AllianceTaskCatalog.buildRuntimeCatalog
        ? env.AllianceTaskCatalog.buildRuntimeCatalog(env) : [];
      (catalog || []).forEach(function (item) {
        if (item && item.materialId) map[String(item.materialId)] = coerceRequiredLevel(item.requiredLevel);
      });
    } catch (ignore) { /* 目录不可用时回落到 1，保证上行值合法 */ }
    return map;
  }

  function ensureAllianceHelpButton() {
    var title = document.querySelector(".panel-title");
    var existing = document.getElementById("btn-alliance-help");
    if (existing && title && existing.parentNode !== title) {
      title.appendChild(existing);
    }
    if (existing) return;
    var cloudButton = document.getElementById("btn-open-cloud-test");
    if (!cloudButton || !cloudButton.parentNode || !title) return;
    var button = document.createElement("button");
    button.id = "btn-alliance-help";
    button.className = "btn secondary";
    button.textContent = "?";
    button.title = "联盟玩法说明";
    button.setAttribute("aria-label", "联盟玩法说明");
    button.style.cssText = "width:30px;height:30px;padding:0;border-radius:50%;font-weight:800;font-size:17px;margin-left:8px;vertical-align:middle;";
    title.appendChild(button);
    button.onclick = function () {
      showAllianceMessage("联盟玩法说明", "1. 每日建设任务：任务大厅每天生成建设任务。\n\n2. 提交任务：收集所需材料后提交任务，获得联盟建设点。\n\n3. 建设点：建设点由全体成员共享，用于升级联盟建筑。\n\n4. 建筑效果：总部提高成员上限；任务大厅增加每日任务数量；作战指挥部提高战斗伤害；冶炼中枢提高冶炼效率。\n\n5. 管理权限：只有盟主可以升级建筑、踢出成员、转让盟主和解散联盟；盟主不能直接退出，需先转让盟主或解散联盟。", "info");
    };
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_resolve, reject) {
        setTimeout(function () { reject(new Error("连接超时")); }, ms);
      })
    ]);
  }

  function rememberAlliance(alliance) {
    if (!root.gameState || !alliance) return;
    root.gameState.alliance = {
      isMember: true,
      allianceId: alliance.id,
      code: alliance.code,
      ownerPlayerId: alliance.ownerId || "",
      ownerName: "",
      memberCount: Math.max(0, Math.min(30, Number(alliance.memberCount) || 1)),
      memberCap: Math.max(10, Number(alliance.memberCap) || 10),
      construction: alliance.construction || { points_balance: 0, total_points_earned: 0 },
      buildings: Array.isArray(alliance.buildings) ? alliance.buildings : [],
      buildingLevel: 0,
      memberList: []
    };
    root.gameState._dirty = true;
    if (root.SaveManager && root.SaveManager.save) root.SaveManager.save();
  }

  function readResponseJson(response) {
    return response.text().then(function (text) {
      var source = String(text || "").replace(/^\uFEFF/, "").trim();
      try { return JSON.parse(source); } catch (_) {
        var end = Math.max(source.lastIndexOf("}"), source.lastIndexOf("]"));
        if (end > 0) {
          try { return JSON.parse(source.slice(0, end + 1)); } catch (ignore) { return {}; }
        }
        return {};
      }
    });
  }

  function cloudBuildingType(type) {
    return String(type || "") === "frontier_hq" ? "logistics_hub" : String(type || "");
  }

  function renderBuildingSummary(alliance, buttonClass) {
    var config = root.AllianceBuildingConfig;
    var buildings = alliance && Array.isArray(alliance.buildings) ? alliance.buildings : [];
    if (!config || !config.BUILDINGS) return "";
    var ids = ["frontier_hq", "mission_hall", "combat_command", "refining_core"];
    var rows = ids.map(function (id) {
      var def = config.BUILDINGS[id];
      var level = config.levelOf(buildings, id);
      var next = level < def.maxLevel ? def.levels[level] : null;
      var effect = id === "frontier_hq"
        ? (level ? "成员上限 " + def.levels[level - 1].memberCap + " 人" : "未建造")
        : id === "mission_hall"
          ? (level ? "每日任务 " + def.levels[level - 1].dailyTasks + " 个" : "未建造")
          : id === "combat_command"
            ? (level ? "战斗伤害 +" + Math.round(def.levels[level - 1].combatDamageBonus * 100) + "%" : "未建造")
            : (level ? "冶炼效率 +" + Math.round(def.levels[level - 1].refiningEfficiencyBonus * 100) + "%" : "未建造");
      var nextText = next ? " · 下级 " + next.cost + " 建设点" : " · 已满级";
      var canUpgrade = String(alliance.ownerId) === String(root.AllianceApi.getPlayerId()) && level < def.maxLevel;
      var upgradeButton = canUpgrade
        ? '<button class="btn secondary ' + (buttonClass || "alliance-upgrade-btn") + '" data-building-type="' + esc(def.legacyId || id) + '" style="padding:4px 8px;margin-left:8px;">' + (level ? "升级" : "建造") + '</button>'
        : '';
      return '<div class="alliance-building-row" style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid #1e354b;">' +
        '<span>' + esc(def.name) + ' <span class="text-muted">Lv.' + esc(level) + '</span></span>' +
        '<span class="text-muted" style="text-align:right;">' + esc(effect + nextText) + upgradeButton + '</span></div>';
    }).join("");
    return '<div class="alliance-card-title" style="margin-top:12px;">联盟建设</div>' + rows;
  }

  function renderAllianceGuide() {
    return '<details class="alliance-guide" style="margin-top:12px;border-top:1px solid #1e354b;padding-top:10px;">' +
      '<summary style="cursor:pointer;color:#9fddff;font-weight:700;">联盟玩法说明</summary>' +
      '<div class="alliance-task-hint" style="white-space:pre-line;">1. 每日建设任务会根据任务大厅等级生成。\n2. 完成任务并提交材料，可获得联盟建设点。\n3. 联盟建设点由全体成员共享，用于升级联盟建筑。\n4. 总部提高成员上限；任务大厅增加每日任务；作战指挥部提高战斗伤害；冶炼中枢提高冶炼效率。\n5. 只有盟主可以升级建筑、踢出成员、转让盟主和解散联盟。盟主不能直接退出，需先转让盟主或解散联盟。</div>' +
      '</details>';
  }

  function renderMemberCard(alliance, members) {
    members = normalizeMemberRows(members).sort(function (a, b) {
      var aOwner = String(a.playerId) === String(alliance.ownerId) ? 0 : 1;
      var bOwner = String(b.playerId) === String(alliance.ownerId) ? 0 : 1;
      return aOwner - bOwner;
    });
    var memberRows = members.map(function (member) {
      var isOwner = member.isOwner || String(member.playerId) === String(alliance.ownerId);
      var stats = renderMemberStatsLine(member);
      return '<div class="alliance-member-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #1e354b;">' +
        '<span style="min-width:0;overflow-wrap:anywhere;">' + esc(member.username || "未设置昵称") + stats + '</span>' +
        '<span style="display:flex;align-items:center;gap:8px;flex:0 0 auto;white-space:nowrap;">' +
        '<span class="text-muted">' + (isOwner ? "盟主" : "成员") + '</span>' +
        ((!isOwner && String(alliance.ownerId) === String(root.AllianceApi.getPlayerId()))
          ? '<button class="btn secondary alliance-transfer-btn" data-target-player="' + esc(member.playerId) + '" style="padding:4px 8px;">转让</button><button class="btn secondary alliance-kick-btn" data-target-player="' + esc(member.playerId) + '" style="padding:4px 8px;">踢出</button>'
          : '') + '</span></div>';
    }).join("");
    return '<div class="alliance-card"><div class="alliance-card-title">当前联盟（实时）</div>' +
      '<div class="alliance-name">' + esc(alliance.name || alliance.code) + '</div>' +
      '<div class="alliance-meta">联盟代码：' + esc(alliance.code) + ' · 成员：' + esc(alliance.memberCount) + '/' + esc(alliance.memberCap || 10) + ' · 建设点：' + esc(alliance.construction && alliance.construction.points_balance || 0) + '<br>联盟 ID：' + esc(alliance.id) + '</div>' +
      renderBuildingSummary(alliance) +
      renderAllianceGuide() +
      '<div class="alliance-card-title" style="margin-top:12px;">联盟成员</div>' +
      (memberRows || '<div class="alliance-task-hint">暂无成员数据</div>') +
      renderMembershipActions(alliance) + '</div>';
  }

  // 离盟入口：盟主=解散联盟（全体同时退出），普通成员=退出联盟。
  // 判据以服务端为准（disband_alliance 二次校验 owner），前端只决定按钮文案，不复制权限逻辑。
  function renderMembershipActions(alliance) {
    var isOwner = String(alliance.ownerId) === String(root.AllianceApi.getPlayerId());
    var hint = isOwner
      ? "你是盟主：解散后全体成员同时退出，联盟数据不可恢复。若只想自己离开，请先把盟主转让给其他成员。"
      : "退出后你可以再加入其他联盟。";
    return '<div style="margin-top:12px;border-top:1px solid #1e354b;padding-top:10px;">' +
      '<div style="display:flex;justify-content:flex-end;">' +
      (isOwner
        ? '<button class="btn secondary alliance-disband-btn" style="border-color:#c96a6a;color:#ffc9c9;">解散联盟</button>'
        : '<button class="btn secondary alliance-leave-btn">退出联盟</button>') +
      '</div>' +
      '<div class="alliance-task-hint" style="margin-top:6px;text-align:right;">' + esc(hint) + '</div></div>';
  }

  function showAllianceConfirm(title, message, onConfirm) {
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(4,8,14,.78);display:flex;align-items:center;justify-content:center;padding:16px;z-index:3000;";
    overlay.innerHTML = '<div style="width:min(440px,94vw);background:#101b2a;border:1px solid #385a78;border-radius:12px;padding:20px;color:#dceeff;box-shadow:0 18px 60px rgba(0,0,0,.45);">' +
      '<div style="font-size:18px;font-weight:700;margin-bottom:10px;">' + esc(title) + '</div><div style="color:#a8bacb;line-height:1.6;">' + esc(message) + '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;"><button class="btn secondary" data-alliance-cancel>取消</button><button class="btn primary" data-alliance-confirm>确认</button></div></div>';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); }
    overlay.querySelector("[data-alliance-cancel]").onclick = close;
    overlay.querySelector("[data-alliance-confirm]").onclick = function () { close(); onConfirm(); };
    overlay.onclick = function (event) { if (event.target === overlay) close(); };
  }

  function friendlyAllianceError(error) {
    var raw = error && error.message ? String(error.message) : String(error || "");
    var text = raw.toLowerCase();
    if (text.indexOf("unknown alliance building") >= 0 || text.indexOf("未知联盟建筑") >= 0) return "未知联盟建筑，请更新游戏后重试。";
    if (text.indexOf("only alliance owner") >= 0 || text.indexOf("only the alliance owner") >= 0 || text.indexOf("only owner") >= 0 || text.indexOf("只有联盟创建人") >= 0) return "只有盟主可以执行此操作。";
    if (text.indexOf("not enough alliance construction points") >= 0 || text.indexOf("construction points") >= 0 || text.indexOf("insufficient") >= 0 || text.indexOf("建设点") >= 0 || text.indexOf("不足") >= 0) return "联盟建设点不足，无法升级该建筑。";
    if (text.indexOf("max level") >= 0 || (text.indexOf("building") >= 0 && text.indexOf("max") >= 0) || text.indexOf("最高等级") >= 0) return "该建筑已经达到最高等级。";
    if (text.indexOf("network") >= 0 || text.indexOf("failed to fetch") >= 0) return "网络连接失败，请检查网络后重试。";
    if (text.indexOf("database request failed") >= 0 || text.indexOf("http 400") >= 0 || text.indexOf("http 404") >= 0 || text.indexOf("http 409") >= 0) return "联盟服务暂时不可用，请稍后重试。";
    // 身份相关错误：云端已返回可读中文，这里只补齐「玩家该做什么」。
    if (text.indexOf("设备密钥") >= 0) return "本机身份凭证已失效（可能已在其他设备上完成身份转移）。如需继续管理身份，请联系盟主合并，或退出后重新加入联盟。";
    if (text.indexOf("转移码不存在") >= 0) return "转移码不存在，请核对后重试。";
    if (text.indexOf("转移码已过期") >= 0) return "转移码已过期，请在旧设备上重新生成。";
    if (text.indexOf("转移码已被使用") >= 0) return "该转移码已经用过了，请在旧设备上重新生成。";
    if (text.indexOf("不能认领自身身份") >= 0) return "这是本机自己生成的转移码，不需要使用。";
    if (text.indexOf("不同联盟") >= 0) return "两个身份分属不同联盟，请先让其中一个退出联盟，再执行合并。";
    if (text.indexOf("盟主") >= 0 && text.indexOf("合并") >= 0) return "只有盟主可以合并成员身份。";
    if (text.indexOf("平台身份") >= 0) return "账号登录状态已失效，请关闭面板后重新打开。";
    return raw || "联盟操作失败，请稍后重试。";
  }

  function showAllianceMessage(title, message, tone) {
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(4,8,14,.78);display:flex;align-items:center;justify-content:center;padding:16px;z-index:3000;";
    var accent = tone === "error" ? "#e58b8b" : "#8ed9b5";
    overlay.innerHTML = '<div style="width:min(440px,94vw);background:#101b2a;border:1px solid ' + accent + ';border-radius:12px;padding:20px;color:#dceeff;box-shadow:0 18px 60px rgba(0,0,0,.45);">' +
      '<div style="font-size:18px;font-weight:700;margin-bottom:10px;color:' + accent + ';">' + esc(title) + '</div><div style="color:#a8bacb;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;">' + esc(message) + '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:20px;"><button class="btn primary" data-alliance-message-close>知道了</button></div></div>';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); }
    overlay.querySelector("[data-alliance-message-close]").onclick = close;
    overlay.onclick = function (event) { if (event.target === overlay) close(); };
  }

  // ---------------------------------------------------------------------------
  // 身份与设备：把「联盟身份是设备级还是账号级」暴露给玩家，并提供换设备的认领入口。
  // 前端只负责展示与发起，所有合并判据都在云端（SQL 函数 + alliance-identity 云函数），
  // 此处不复制任何合并规则。
  // ---------------------------------------------------------------------------
  function overlayShell(title, bodyHtml, buttonsHtml) {
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(4,8,14,.78);display:flex;align-items:center;justify-content:center;padding:16px;z-index:3000;";
    overlay.innerHTML = '<div style="width:min(460px,94vw);max-height:86vh;overflow:auto;background:#101b2a;border:1px solid #385a78;border-radius:12px;padding:20px;color:#dceeff;box-shadow:0 18px 60px rgba(0,0,0,.45);">' +
      '<div style="font-size:18px;font-weight:700;margin-bottom:10px;">' + esc(title) + '</div>' + bodyHtml +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">' + buttonsHtml + '</div></div>';
    document.body.appendChild(overlay);
    overlay.onclick = function (event) { if (event.target === overlay) overlay.remove(); };
    return overlay;
  }

  // 身份类型展示名：只按前缀/形态判断，不猜平台细节。
  function identityKindLabel(playerId) {
    playerId = String(playerId || "");
    if (/^taptap_/.test(playerId)) return "TapTap 账号";
    if (/^steam_/.test(playerId) || /^[0-9]{5,20}$/.test(playerId)) return "Steam 账号";
    if (/^dev_/.test(playerId)) return "设备身份";
    if (/^local_/.test(playerId)) return "本机设备";
    return "未知身份";
  }

  function shortIdentity(playerId) {
    playerId = String(playerId || "");
    if (playerId.length <= 20) return playerId;
    return playerId.slice(0, 12) + "…" + playerId.slice(-6);
  }

  function renderIdentityCardHtml(isOwner) {
    var api = root.AllianceApi;
    if (!api || typeof api.createIdentityCode !== "function") return "";
    var playerId = api.getPlayerId ? api.getPlayerId() : "";
    if (!playerId) return "";
    var isDevice = api.isDeviceIdentity ? api.isDeviceIdentity() : false;
    var hint = isDevice
      ? "当前是本机设备身份（未绑定平台账号）。换设备或清理浏览器数据都会产生新身份；在旧设备点「生成转移码」，再到新设备点「使用转移码」，两边就会合成同一个人。"
      : "当前是平台账号身份，换设备后会自动识别为同一个人，无需转移码。";
    return '<div class="alliance-card alliance-identity-card" id="alliance-identity-card" style="margin-top:12px;">' +
      '<div class="alliance-card-title">身份与设备</div>' +
      '<div class="alliance-meta">本机身份：' + esc(shortIdentity(playerId)) + ' · ' + esc(identityKindLabel(playerId)) + '</div>' +
      '<div class="alliance-task-hint">' + esc(hint) + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">' +
      '<button class="btn secondary alliance-identity-create">生成转移码</button>' +
      '<button class="btn secondary alliance-identity-redeem">使用转移码</button>' +
      (isOwner ? '<button class="btn secondary alliance-identity-merge">合并成员身份</button>' : '') +
      '</div>' +
      '<div class="alliance-task-hint" id="alliance-identity-msg" style="min-height:18px;"></div></div>';
  }

  function showRedeemIdentityOverlay(onDone) {
    var overlay = overlayShell("使用转移码",
      '<div style="color:#a8bacb;line-height:1.6;margin-bottom:10px;">输入旧设备生成的 8 位转移码。确认后本机身份会并入该身份，联盟、建设点与任务进度都以该身份为准。</div>' +
      '<input data-alliance-prompt-input maxlength="16" autocomplete="off" placeholder="例如 A7K2M9QP" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #385a78;background:#0b1522;color:#eaf6ff;font-size:16px;letter-spacing:2px;text-transform:uppercase;">' +
      '<div class="alliance-task-hint" data-alliance-prompt-hint style="min-height:18px;"></div>',
      '<button class="btn secondary" data-alliance-cancel>取消</button><button class="btn primary" data-alliance-confirm>确认</button>');
    var input = overlay.querySelector("[data-alliance-prompt-input]");
    var hint = overlay.querySelector("[data-alliance-prompt-hint]");
    var button = overlay.querySelector("[data-alliance-confirm]");
    overlay.querySelector("[data-alliance-cancel]").onclick = function () { overlay.remove(); };
    button.onclick = function () {
      var code = String(input.value || "").trim().toUpperCase();
      if (!code) { hint.textContent = "请输入转移码"; return; }
      button.disabled = true;
      hint.textContent = "正在合并身份…";
      root.AllianceApi.redeemIdentityCode(code).then(function (result) {
        overlay.remove();
        showAllianceMessage("身份已合并", "本机身份已并入 " + shortIdentity(result && result.keeperPlayerId) + "。\n联盟、建设点与任务进度已跟随该身份。", "info");
        if (typeof onDone === "function") onDone();
      }).catch(function (error) {
        button.disabled = false;
        hint.textContent = friendlyAllianceError(error);
      });
    };
    try { input.focus(); } catch (_) {}
  }

  function showMergeIdentityOverlay(allianceId, onDone) {
    var overlay = overlayShell("合并成员身份",
      '<div style="color:#a8bacb;line-height:1.6;margin-bottom:12px;">把「被合并」成员的数据（贡献、建设记录、盟主身份）并入「保留」成员，用于清理同一人在多台设备上产生的重复身份。此操作不可撤销。</div>' +
      '<div data-alliance-merge-body class="text-muted">正在读取成员…</div>' +
      '<div class="alliance-task-hint" data-alliance-prompt-hint style="min-height:18px;"></div>',
      '<button class="btn secondary" data-alliance-cancel>取消</button><button class="btn primary" data-alliance-confirm disabled>合并</button>');
    var body = overlay.querySelector("[data-alliance-merge-body]");
    var hint = overlay.querySelector("[data-alliance-prompt-hint]");
    var button = overlay.querySelector("[data-alliance-confirm]");
    overlay.querySelector("[data-alliance-cancel]").onclick = function () { overlay.remove(); };
    root.AllianceApi.getMemberStats(allianceId).then(function (rows) {
      var members = normalizeMemberRows(rows);
      if (members.length < 2) { body.textContent = "成员不足两人，无需合并。"; return; }
      var options = members.map(function (member) {
        return '<option value="' + esc(member.playerId) + '">' + esc(member.username || "未设置昵称") + ' · ' + esc(shortIdentity(member.playerId)) + '</option>';
      }).join("");
      var selectStyle = "width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid #385a78;background:#0b1522;color:#eaf6ff;font-size:14px;";
      body.innerHTML = '<div style="margin-bottom:8px;"><div class="text-muted" style="margin-bottom:4px;">被合并（该身份将消失）</div>' +
        '<select data-alliance-merge-from style="' + selectStyle + '">' + options + '</select></div>' +
        '<div><div class="text-muted" style="margin-bottom:4px;">保留（数据归并到这里）</div>' +
        '<select data-alliance-merge-to style="' + selectStyle + '">' + options + '</select></div>';
      var fromSelect = body.querySelector("[data-alliance-merge-from]");
      var toSelect = body.querySelector("[data-alliance-merge-to]");
      toSelect.value = members[0].playerId;
      button.disabled = false;
      button.onclick = function () {
        var fromId = fromSelect.value;
        var toId = toSelect.value;
        if (!fromId || !toId || fromId === toId) { hint.textContent = "请选择两个不同的成员"; return; }
        button.disabled = true;
        hint.textContent = "正在合并…";
        root.AllianceApi.adminMergeIdentity(allianceId, fromId, toId).then(function () {
          overlay.remove();
          showAllianceMessage("成员身份已合并", "已把该成员并入了保留身份，成员列表稍后刷新。", "info");
          if (typeof onDone === "function") onDone();
        }).catch(function (error) {
          button.disabled = false;
          hint.textContent = friendlyAllianceError(error);
        });
      };
    }).catch(function (error) {
      body.textContent = "成员列表读取失败：" + friendlyAllianceError(error);
    });
  }

  function bindIdentityActions(box, allianceId, isOwner) {
    var api = root.AllianceApi;
    if (!api || typeof api.createIdentityCode !== "function") return;
    var msg = box.querySelector("#alliance-identity-msg");
    function setMsg(text, tone) {
      if (!msg) return;
      msg.textContent = text || "";
      msg.style.color = tone === "error" ? "#e58b8b" : "#8ed9b6";
    }
    var createButton = box.querySelector(".alliance-identity-create");
    if (createButton) createButton.onclick = function () {
      createButton.disabled = true;
      setMsg("正在生成转移码…");
      api.createIdentityCode(900).then(function (result) {
        setMsg("");
        var expires = result && result.expiresAt ? String(result.expiresAt) : "";
        showAllianceMessage("身份转移码",
          "转移码：" + (result && result.code || "-") +
          (expires ? "\n有效期至：" + expires : "") +
          "\n\n在需要接管的设备上打开联盟面板 →「使用转移码」→ 输入这串码，那台设备就会并入本机身份。\n转移码 15 分钟内有效，且只能使用一次。", "info");
      }).catch(function (error) { setMsg(friendlyAllianceError(error), "error"); })
        .then(function () { createButton.disabled = false; });
    };
    var redeemButton = box.querySelector(".alliance-identity-redeem");
    if (redeemButton) redeemButton.onclick = function () { showRedeemIdentityOverlay(load); };
    var mergeButton = box.querySelector(".alliance-identity-merge");
    if (mergeButton && isOwner && allianceId) {
      mergeButton.onclick = function () { showMergeIdentityOverlay(allianceId, load); };
    } else if (mergeButton) {
      mergeButton.style.display = "none";
    }
  }

  function bindAdminActions(box, alliance, members, msg) {
    if (!alliance || String(alliance.ownerId) !== String(root.AllianceApi.getPlayerId())) return;
    function runAction(button, action, confirmText, successText) {
      button.onclick = function () {
        var target = button.getAttribute("data-target-player");
        showAllianceConfirm(action === "kick_member" ? "踢出联盟成员" : "转让盟主", confirmText, function () {
          button.disabled = true;
          var session = root.SteamAllianceSession;
          var tokenPromise = root.AllianceApi && typeof root.AllianceApi.getAllianceSessionToken === "function"
            ? Promise.resolve(root.AllianceApi.getAllianceSessionToken())
            : session && typeof session.getToken === "function" ? Promise.resolve(session.getToken()) : Promise.resolve("");
          tokenPromise.then(function (token) {
          if (!token && session && typeof session.authenticate === "function") return session.authenticate().then(function (x) { return x.sessionToken; });
          return token;
          }).then(function (token) {
          return fetch(adminGateway, { method: "POST", headers: { "Content-Type": "application/json", "x-alliance-session": token || "" }, body: JSON.stringify({ action: action, allianceId: alliance.id, targetPlayerId: target }) });
          }).then(function (response) { return readResponseJson(response).then(function (data) { if (!response.ok || !data.ok) throw new Error(data.error || "管理员操作失败"); return data; }); })
          .then(function () { if (msg) msg.textContent = successText; startCloudRefresh(); })
          .catch(function (error) {
            button.disabled = false;
            var message = friendlyAllianceError(error);
            if (msg) msg.textContent = message;
            showAllianceMessage("联盟操作失败", message, "error");
          });
        });
      };
    }
    Array.prototype.forEach.call(box.querySelectorAll(".alliance-kick-btn"), function (button) {
      runAction(button, "kick_member", "确定要踢出这名成员吗？", "成员已踢出");
    });
    Array.prototype.forEach.call(box.querySelectorAll(".alliance-transfer-btn"), function (button) {
      runAction(button, "transfer_leader", "确定要把盟主转让给这名成员吗？转让后你将失去管理权限。", "盟主已转让");
    });
  }

  function bindMembershipActions(box, alliance, msg) {
    if (!alliance || !root.AllianceApi) return;
    var disbandBtn = box.querySelector(".alliance-disband-btn");
    if (disbandBtn && typeof root.AllianceApi.disbandAlliance === "function") {
      disbandBtn.onclick = function () {
        showAllianceConfirm("解散联盟", "确定要解散这个联盟吗？全体成员将同时退出，该操作不可恢复。", function () {
          disbandBtn.disabled = true;
          if (msg) msg.textContent = "正在解散联盟…";
          root.AllianceApi.disbandAlliance(alliance.id).then(function () {
            if (msg) msg.textContent = "联盟已解散";
            showAllianceMessage("联盟已解散", "联盟已解散，你已不再是任何联盟成员。", "success");
            startCloudRefresh();
          }).catch(function (error) {
            disbandBtn.disabled = false;
            var message = friendlyAllianceError(error);
            if (msg) msg.textContent = message;
            showAllianceMessage("解散失败", message, "error");
          });
        });
      };
    }
    var leaveBtn = box.querySelector(".alliance-leave-btn");
    if (leaveBtn && typeof root.AllianceApi.leaveAlliance === "function") {
      leaveBtn.onclick = function () {
        showAllianceConfirm("退出联盟", "确定要退出这个联盟吗？", function () {
          leaveBtn.disabled = true;
          if (msg) msg.textContent = "正在退出联盟…";
          root.AllianceApi.leaveAlliance(alliance.id).then(function () {
            if (msg) msg.textContent = "已退出联盟";
            showAllianceMessage("已退出联盟", "你已退出联盟，可以加入其他联盟了。", "success");
            startCloudRefresh();
          }).catch(function (error) {
            leaveBtn.disabled = false;
            var message = friendlyAllianceError(error);
            if (msg) msg.textContent = message;
            showAllianceMessage("退出失败", message, "error");
          });
        });
      };
    }
  }

  function bindBuildingActions(box, alliance, msg) {
    if (!alliance || String(alliance.ownerId) !== String(root.AllianceApi.getPlayerId())) return;
    Array.prototype.forEach.call(box.querySelectorAll('.alliance-upgrade-btn'), function (button) {
      button.onclick = function () {
        var buildingType = cloudBuildingType(button.getAttribute('data-building-type'));
        if (isTapTapRuntime() && openCloudRelay({
          relayAction: 'upgrade_building',
          allianceId: alliance.id,
          buildingType: buildingType
        })) {
          if (msg) msg.textContent = '正在打开云端升级建筑…';
          return;
        }
        button.disabled = true;
        if (msg) msg.textContent = '正在升级建筑…';
        fetch(taskGateway, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'upgrade_building', playerId: root.AllianceApi.getPlayerId(), allianceId: alliance.id, buildingType: buildingType })
        }).then(function (response) {
          return readResponseJson(response).then(function (data) {
            if (!response.ok || !data.ok) throw new Error(data.error || '建筑升级失败');
            return data;
          });
        }).then(function () {
          if (msg) msg.textContent = '建筑升级成功';
          showAllianceMessage('建筑升级成功', '建筑升级成功，联盟属性已更新。', 'success');
          startCloudRefresh();
        }).catch(function (error) {
          button.disabled = false;
          var message = friendlyAllianceError(error);
          if (msg) msg.textContent = message;
          showAllianceMessage('建筑升级失败', message, 'error');
        });
      };
    });
  }

  function renderListView(list) {
    var rows = list.map(function (a) {
      var cap = Math.max(10, Number(a.memberCap) || 10);
      var full = Number(a.memberCount) >= cap;
      var buildings = Array.isArray(a.buildings) ? a.buildings : [];
      var buildingNames = { frontier_hq: "总部", logistics_hub: "总部", mission_hall: "任务大厅", combat_command: "作战指挥部", refining_core: "冶炼中枢" };
      var buildingText = buildings.map(function (b) { return (buildingNames[b.building_type] || b.building_type || "建筑") + " Lv." + (Number(b.level) || 0); }).join(" · ");
      return '<div class="alliance-member-row"><span>' + esc(a.name || a.code) + '</span>' +
        '<span class="text-muted">' + esc(a.memberCount) + '/' + esc(cap) + '</span>' +
        '<span class="text-muted" style="flex:1;min-width:0;overflow-wrap:anywhere;">' + esc(buildingText || "建筑数据暂无") + '</span>' +
        '<button class="btn secondary alliance-join-btn" data-alliance-id="' + esc(a.id) + '"' + (full ? " disabled" : "") + ' style="margin-left:auto;">' + (full ? "已满" : "加入") + '</button></div>';
    }).join("");
    var listHtml = list.length
      ? '<div class="alliance-card-title">联盟列表（' + list.length + '）</div><div class="alliance-members">' + rows + '</div>'
      : '<div class="alliance-task-hint">还没有联盟，创建第一个吧。</div>';
    return '<div class="alliance-card"><div class="alliance-card-title">创建联盟</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
      '<input id="alliance-new-code" maxlength="3" placeholder="例如 ABC" autocomplete="off" style="flex:1;min-width:0;text-transform:uppercase;padding:6px 8px;background:#0a1420;border:1px solid #24405c;border-radius:6px;color:#d8e2ee;">' +
      '<button class="btn primary" id="alliance-create-btn">建立联盟</button></div>' +
      '<div class="alliance-task-hint">代码为 1～3 位大写英文字母。</div></div>' +
      '<div class="alliance-card">' + listHtml + '</div>';
  }

  function bindListActions(box, msg) {
    var createBtn = box.querySelector("#alliance-create-btn");
    var input = box.querySelector("#alliance-new-code");
    if (createBtn && input) createBtn.onclick = function () {
      var value = (input.value || "").trim();
      var check = root.AlliancePolicy && root.AlliancePolicy.validate
        ? root.AlliancePolicy.validate(value) : { ok: true };
      if (!check.ok) { if (msg) msg.textContent = check.reason || "联盟代码无效"; return; }
      createBtn.disabled = true;
      if (msg) msg.textContent = "创建联盟中…";
      root.AllianceApi.createAlliance(value).then(function (alliance) {
        if (msg) msg.textContent = "联盟已创建";
        rememberAlliance(alliance);
        startCloudRefresh();
      }).catch(function (error) {
        createBtn.disabled = false;
        if (msg) msg.textContent = "创建失败：" + (error && error.message || error);
      });
    };
    Array.prototype.forEach.call(box.querySelectorAll(".alliance-join-btn"), function (btn) {
      btn.onclick = function () {
        btn.disabled = true;
        if (msg) msg.textContent = "加入联盟中…";
        root.AllianceApi.joinAlliance(btn.getAttribute("data-alliance-id")).then(function () {
          if (msg) msg.textContent = "已加入联盟";
          startCloudRefresh();
        }).catch(function (error) {
          btn.disabled = false;
          if (msg) msg.textContent = "加入失败：" + (error && error.message || error);
        });
      };
    });
  }

  // 建筑数据（含任务大厅等级）到位后调用：若大厅等级给出的每日任务条数**大于**当前已渲染
  // 的行数，说明首轮任务同步是在建筑数据到位之前发的（很可能只送了 5 条）⇒ 补一次收敛。
  // 三条护栏：① 只在「变多」时动手（变少不裁剪，避免把服务端已建好的行丢掉）；
  // ② 同一个目标条数只触发一次（reloadedHallCount），防 load() ⇄ startCloudRefresh 互触发；
  // ③ 延到本轮渲染链结束再 load()，否则会把外层还没写完的 box.innerHTML 写到已被替换的旧节点上。
  function convergeTaskCountWithBuildings(buildings) {
    if (!root.AllianceBuildingConfig || typeof root.AllianceBuildingConfig.dailyTaskCount !== "function") return;
    var hallCount = root.AllianceBuildingConfig.dailyTaskCount(buildings || []);
    if (!(hallCount > renderedTaskCount)) return;
    if (hallCount === reloadedHallCount) return;
    reloadedHallCount = hallCount;
    // 复位一次性闸门，让这一轮 load() 能把缺失的槽位补出来（服务端 ensureTasks 是按客户端
    // preview 长度建行的：只有客户端先按大厅条数送 6 条，服务端才会建出 slot 6）。
    cloudTaskSyncDone = false;
    setTimeout(function () {
      if (typeof load === "function") load();
    }, 0);
  }

  function startCloudRefresh() {
    var ctx = activeRender;
    if (!ctx) return;
    if (!root.AllianceApi || !root.AllianceApi.getAlliance) {
      if (ctx.msg) ctx.msg.textContent = "云端联盟已就绪";
      return;
    }
    var box = document.getElementById("alliance-state");
    if (!box) return;
    if (root.AllianceApi && typeof root.AllianceApi.pingOnline === "function") root.AllianceApi.pingOnline();
    // getAlliance() 拿回来的 alliance_buildings 就是服务端 taskCountForPlayer() 用的同一份数据
    // ⇒ 一旦它到位，客户端算出的条数与服务端口径一致。这里先留存，等整条刷新链跑完再用于收敛。
    var convergedBuildings = null;
    withTimeout(root.AllianceApi.getAlliance(), 8000).then(function (alliance) {
      if (alliance) {
        rememberAlliance(alliance);
        convergedBuildings = alliance.buildings;
        return root.AllianceApi.getMemberStats(alliance.id).then(function (members) {
          if (root.AllianceApi && typeof root.AllianceApi.pingOnline === "function") root.AllianceApi.pingOnline();
          box.innerHTML = renderMemberCard(alliance, members);
          bindAdminActions(box, alliance, members, ctx.msg);
          bindMembershipActions(box, alliance, ctx.msg);
          bindBuildingActions(box, alliance, ctx.msg);
          setCloudButtonVisible(false);
          if (ctx.msg) ctx.msg.textContent = "已连接云端联盟";
        });
      }
      return withTimeout(root.AllianceApi.listAlliances(), 8000).then(function (list) {
        box.innerHTML = renderListView(list || []);
        bindListActions(box, ctx.msg);
        setCloudButtonVisible(true);
        if (ctx.msg) ctx.msg.textContent = "已连接云端（未加入联盟）";
      });
    }).catch(function () {
      box.innerHTML = ctx.fallbackHtml;
      setCloudButtonVisible(true);
      if (ctx.hasCloudReturn) {
        if (ctx.msg) ctx.msg.textContent = "云端联盟数据已回传";
        if (ctx.bindFallbackActions) ctx.bindFallbackActions(box);
        return;
      }
      if (ctx.msg) ctx.msg.textContent = "云端未连接，请点击“打开云端联盟”获取联盟信息并同步建设点";
      var hint = document.createElement("div");
      hint.className = "alliance-task-hint";
      hint.style.cssText = "margin-top:10px;color:#f2c879;";
      hint.textContent = "云端未连接：请点击上方“打开云端联盟”获取联盟信息；提交建设任务后，建设点会回传云端。";
      box.appendChild(hint);
    }).then(function () {
      // 必须放在整条链的最后：任务条数收敛会重新 load()（整块 content.innerHTML 重建），
      // 若在 getMemberStats 之前触发，成员卡的 box.innerHTML 会写到已被替换掉的旧节点上。
      if (convergedBuildings) convergeTaskCountWithBuildings(convergedBuildings);
    });
  }

  function showDiagnoseOverlay() {
    var overlay = document.getElementById("alliance-diag-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "alliance-diag-overlay";
      overlay.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(2,8,16,.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";
      overlay.innerHTML = '<div style="background:#0d1826;border:1px solid #24405c;border-radius:10px;max-width:520px;width:100%;max-height:80%;overflow:auto;padding:16px;color:#d8e2ee;font-size:13px;line-height:1.6;">' +
        '<div style="font-weight:500;margin-bottom:8px;">联盟网络诊断（当前环境实测）</div>' +
        '<div id="alliance-diag-body">诊断中…</div>' +
        '<div style="margin-top:12px;text-align:right;"><button class="btn secondary" id="alliance-diag-close">关闭</button></div></div>';
      document.body.appendChild(overlay);
      overlay.querySelector("#alliance-diag-close").onclick = function () { overlay.remove(); };
      overlay.onclick = function (event) { if (event.target === overlay) overlay.remove(); };
    }
    var body = overlay.querySelector("#alliance-diag-body");
    body.textContent = "诊断中…";
    root.AllianceApi.diagnose().then(function (report) {
      var rows = (report.steps || []).map(function (step) {
        return '<div>· ' + esc(step.name) + '：' + (step.ok ? "通过" : "失败") + ' ' + esc(step.detail || "") + '（' + esc(step.ms) + 'ms）</div>';
      }).join("");
      body.innerHTML = '<div>页面协议：' + esc(report.protocol) + '</div>' +
        '<div>接口地址：' + esc(report.endpoint) + '</div>' +
        '<div>玩家 ID：' + esc(report.deviceId) + '</div>' +
        '<div style="margin-top:8px;">' + rows + '</div>';
    }).catch(function (error) {
      body.textContent = "诊断执行失败：" + (error && error.message || error);
    });
  }

  // 平台身份归并失败提示（2026-09-18）：归并失败此前只在 console.warn 里出现，
  // 玩家会永久停在 local_ 设备身份且毫无察觉。此处给出明确提示 + 重试入口。
  // 与身份卡片同策略：挂在 #alliance-state 之外，每次 load() 重建一次（幂等），
  // 云端刷新（只替换 #alliance-state）不会把它冲掉。
  function renderIdentityMergeWarning(content, playerId) {
    if (!content) return;
    Array.prototype.forEach.call(content.querySelectorAll("#alliance-merge-warning"), function (node) { node.remove(); });
    var issue = root.AllianceApi && root.AllianceApi.getIdentityIssue ? root.AllianceApi.getIdentityIssue() : null;
    if (!issue) return;
    content.insertAdjacentHTML("beforeend",
      '<div class="alliance-card" id="alliance-merge-warning">' +
        '<div class="alliance-card-title">平台身份未绑定成功</div>' +
        '<div class="alliance-task-hint">本机正在使用设备身份 ' + esc(playerId) + '，与平台账号合并时失败：' + esc(issue.message) + '</div>' +
        '<div class="alliance-task-hint">不影响存档与游戏进度，仅联盟成员记录会挂在设备身份下。可稍后重试。</div>' +
        '<div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn secondary" id="alliance-retry-identity">重新绑定平台身份</button>' +
          '<span class="alliance-task-hint" id="alliance-retry-identity-msg"></span>' +
        '</div>' +
      '</div>');
    var button = document.getElementById("alliance-retry-identity");
    if (!button) return;
    button.onclick = function () {
      var tip = document.getElementById("alliance-retry-identity-msg");
      button.disabled = true;
      if (tip) tip.textContent = "正在重试……";
      root.AllianceApi.retryPlatformIdentity().then(function () {
        load();
      }).catch(function (error) {
        button.disabled = false;
        if (tip) tip.textContent = "仍然失败：" + ((error && error.message) || error);
      });
    };
  }

  function load() {
    var msg = document.getElementById("alliance-msg");
    var content = document.getElementById("alliance-content");
    if (!content) return;
    ensureAllianceHelpButton();

    function initializeWithRetry(attempt) {
      var initialize = root.AllianceApi && root.AllianceApi.initializeSteamIdentity
        ? root.AllianceApi.initializeSteamIdentity()
        : Promise.resolve();
      return initialize.catch(function (error) {
        if (attempt >= 2) throw error;
        return new Promise(function (resolve) { setTimeout(resolve, 600); }).then(function () { return initializeWithRetry(attempt + 1); });
      });
    }
    initializeWithRetry(0).then(function () {
      loadAfterIdentity(msg, content, true);
    }).catch(function (error) {
      console.warn("Steam identity unavailable; cloud task sync skipped.", error);
      loadAfterIdentity(msg, content, false);
    });
  }

  function loadAfterIdentity(msg, content, identityReady) {
    var playerId = root.AllianceApi && root.AllianceApi.getPlayerId
      ? root.AllianceApi.getPlayerId()
      : "";
    var taskPreview = [];
    // 任务大厅等级是任务条数的权威来源，但它来自 alliance_buildings，只有 getAlliance()
    // 之后才到位（见 startCloudRefresh）⇒ 首次 load() 必然拿不到，先按已保存的建筑数据
    // 估算、拿不到就兜底 5；建筑数据刷新到位后由 convergeTaskCountWithBuildings() 收敛。
    var hallTaskCount = root.AllianceBuildingConfig && root.gameState && root.gameState.alliance
      ? root.AllianceBuildingConfig.dailyTaskCount(root.gameState.alliance.buildings || []) : 5;
    var taskCount = hallTaskCount;
    var taskDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    var taskCacheKey = "eve_idle_alliance_tasks_v4_" + playerId + "_" + taskDate;
    // 按需构建（缓存/云端行都缺 required_level 时才建一次），避免每次都跑目录构建。
    var requiredLevelMap = null;
    function catalogRequiredLevel(materialId) {
      if (requiredLevelMap === null) requiredLevelMap = buildRequiredLevelMap(root);
      return requiredLevelMap[String(materialId || "")];
    }
    try {
      var taskState = root.gameState || {};
      var cached = root.localStorage && root.localStorage.getItem(taskCacheKey);
      if (cached) {
        try { taskPreview = JSON.parse(cached); } catch (ignore) { taskPreview = []; }
      }
      // 云端同步过的任务（每项都带 serverTaskId）代表服务端已有的条数。这里**只增不减**：
      // 服务端条数更少说明它的槽位还没补齐 —— 云函数 ensureTasks 是按「客户端 preview 的
      // 长度」建行的，客户端只送 5 条，服务端就永远只有 5 行（实测 2026-09-20：大厅 L2
      // 应为 6，DB 里当天只有 slot 1-5，且因为 existing(5) !== expected(6)，每次同步都走
      // previewCount=5 分支，一个槽位都不补 ⇒ 全天卡在 5 条）。所以必须把 preview 拉到大池
      // 等级，下一次同步才会把缺的槽位建出来；同时保住已同步行的 serverTaskId（第 3 轮
      // 旧逻辑用本地预览整体覆盖云端行、丢掉 id ⇒「有云端状态但点不了提交」）。
      var cloudTaskCount = Array.isArray(taskPreview) && taskPreview.length > 0 &&
        taskPreview.every(function (item) { return item && item.serverTaskId; })
        ? taskPreview.length : 0;
      if (cloudTaskCount) taskCount = Math.max(taskCount, cloudTaskCount);
      // 兜底：已经发过 2 次同步（首轮 + 收敛各一次）而服务端始终只回更少的行，说明它算出的
      // 大厅条数就是更小（例如本地建筑数据比服务端新）⇒ 退回服务端条数，宁可按已有行渲染
      // （每行都有 serverTaskId、能提交），也不显示本地生成的无 id 行。
      if (cloudTaskSyncAttempts >= 2 && cloudTaskCount > 0 && cloudTaskCount < taskCount) taskCount = cloudTaskCount;
      if (!Array.isArray(taskPreview) || taskPreview.length !== taskCount) {
        var taskCatalog = root.AllianceTaskCatalog && root.AllianceTaskCatalog.buildRuntimeCatalog
          ? root.AllianceTaskCatalog.buildRuntimeCatalog(root) : [];
        taskPreview = root.AllianceTaskModel && root.AllianceTaskModel.generateFive
          ? root.AllianceTaskModel.generateFive(playerId, taskDate, taskState, taskCatalog, taskCount) : [];
      }
      taskPreview = taskPreview.map(function (task) { return {
        taskKey: task.taskKey || (String(taskDate) + ":" + String(task.slot) + ":" + String(task.materialId || "")),
        serverTaskId: task.serverTaskId || task.id || null,
        slot: task.slot, category: task.category, skill: task.skill,
        materialId: task.materialId, materialName: task.materialName,
        requiredAmount: task.requiredAmount, requiredLevel: coerceRequiredLevel(task.requiredLevel, catalogRequiredLevel(task.materialId)),
        standardTimeSec: task.standardTimeSec, materialValue: task.materialValue,
        difficulty: task.difficulty,
        rewardPoints: task.rewardPoints,
        tacticalTier: task.tacticalTier,
        status: task.status || "open",
        canSubmit: hasTaskMaterials(task)
      }; });
      if (taskPreview.length === taskCount && root.localStorage) root.localStorage.setItem(taskCacheKey, JSON.stringify(taskPreview));
    } catch (error) { taskPreview = []; }
    if (!identityReady || /^local_/.test(String(playerId))) cloudTaskStatus = "local";
    // 本次真正渲染出的行数 —— 建筑数据到位后 convergeTaskCountWithBuildings() 拿它做对照。
    renderedTaskCount = taskPreview.length;
    // 按天重置计数：跨天后重新允许「把条数补齐」的尝试。
    if (cloudTaskAttemptDate !== taskDate) { cloudTaskAttemptDate = taskDate; cloudTaskSyncAttempts = 0; }
    var canSyncTasks = identityReady && !isTapTapRuntime() && !/^local_/.test(String(playerId)) &&
      !cloudTaskSyncDone && taskPreview.length === taskCount;
    if (canSyncTasks) {
      cloudTaskSyncDone = true;
      cloudTaskSyncAttempts += 1;
      cloudTaskStatus = "syncing";
      fetch(taskGateway, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerId, taskPreview: taskPreview })
      }).then(function (response) {
        return readResponseJson(response).then(function (data) {
          if (!response.ok || !data || !data.ok || !Array.isArray(data.tasks) || data.tasks.length < 5 || data.tasks.length > 10) throw new Error("云端任务返回无效");
          return data.tasks;
        });
      }).then(function (rows) {
        // 云端行没有 required_level（表里无此列）。优先用本次上行同一 slot 的值补齐，
        // 其次查本地目录，最后 1 —— 保证写回缓存的值合法，下次往返不再被服务端拒绝。
        var sentLevelBySlot = {};
        (Array.isArray(taskPreview) ? taskPreview : []).forEach(function (item) {
          if (item) sentLevelBySlot[Number(item.slot)] = item.requiredLevel;
        });
        var synced = rows.map(function (row, index) {
          var materialId = row.material_id || row.materialId || "";
          var slot = Number(row.slot) || index + 1;
          return {
            taskKey: String(taskDate) + ":" + String(slot) + ":" + materialId,
            serverTaskId: row.id || row.task_id || null,
            slot: slot, category: row.category, skill: row.skill,
            materialId: materialId, materialName: row.material_name || row.materialName || materialId,
            requiredAmount: Number(row.required_amount == null ? row.requiredAmount : row.required_amount),
            requiredLevel: coerceRequiredLevel(row.required_level == null ? row.requiredLevel : row.required_level, sentLevelBySlot[slot], catalogRequiredLevel(materialId)),
            standardTimeSec: Number(row.standard_time_sec == null ? row.standardTimeSec : row.standard_time_sec),
            materialValue: Number(row.material_value == null ? row.materialValue : row.material_value),
            difficulty: row.difficulty, rewardPoints: Number(row.reward_points == null ? row.rewardPoints : row.reward_points),
            tacticalTier: row.tactical_tier == null ? row.tacticalTier : Number(row.tactical_tier),
            status: row.status || "open"
          };
        });
        taskPreview = synced;
        // 服务端回的行数达到我们要的条数 ⇒ 这一轮补齐成功，把尝试计数清零（说明它认这个条数）；
        // 回得更少 ⇒ 它按客户端 preview 长度建行、而这次没补上，计数留着给下面的兜底用。
        if (synced.length >= taskCount) cloudTaskSyncAttempts = 0;
        if (root.localStorage) root.localStorage.setItem(taskCacheKey, JSON.stringify(synced));
        cloudTaskStatus = "cloud";
        load();
      }).catch(function () {
        cloudTaskStatus = "local";
        if (typeof console !== "undefined" && console.warn) console.warn("Alliance cloud task sync failed; using local preview.");
        /* Keep the local preview visible if the gateway is temporarily unavailable. */
      });
    }
    // Do not carry a previous alliance summary into the next round trip.
    // Otherwise URLSearchParams may read the old duplicate parameter first.
    var returnUrl = root.location.href.split("?")[0].split("#")[0];
    var url = cloudOrigin + "/?embedded=1&v=5&playerId=" + encodeURIComponent(playerId) +
      "&returnUrl=" + encodeURIComponent(returnUrl) +
      "&taskDate=" + encodeURIComponent(taskDate || "") +
      "&taskPreview=" + encodeURIComponent(JSON.stringify(taskPreview));
    activeCloudUrl = url;

    var cloudButton = document.getElementById("btn-open-cloud-test");
    if (cloudButton) cloudButton.onclick = function () {
      var opened = null;
      try { opened = root.open(url, "_blank"); } catch (error) { opened = null; }
      if (!opened) root.location.href = url;
    };

    var diagnoseButton = document.getElementById("btn-alliance-diagnose");
    if (diagnoseButton) diagnoseButton.onclick = function () {
      if (root.AllianceApi && root.AllianceApi.diagnose) showDiagnoseOverlay();
      else root.location.href = url + "&diagnose=1";
    };

    var params = new URLSearchParams(root.location.search);
    var returnedCode = params.get("allianceCode");
    var returnedOwner = params.get("allianceOwner");
    var returnedOwnerName = params.get("allianceOwnerName");
    var returnedMembers = params.get("allianceMembers");
    var returnedBuildingLevel = Number(params.get("allianceBuildingLevel"));
    var returnedId = params.get("allianceId");
    var returnedTaskId = params.get("allianceTaskId");
    var returnedTaskAmount = Number(params.get("allianceTaskAmount"));
    var returnedTaskCategory = params.get("allianceTaskCategory") || "";
    var returnedTaskMaterial = params.get("allianceTaskMaterial") || "";
    var returnedTaskSubmitted = params.get("allianceTaskSubmitted") === "1";
    var returnedRelayResult = params.get("allianceRelayResult") || "";
    var returnedRelayError = params.get("allianceRelayError") || "";
    var returnedSnapshot = null;
    try { returnedSnapshot = JSON.parse(params.get("allianceSnapshot") || "null"); } catch (error) { returnedSnapshot = null; }
    var returnedMemberList = [];
    try { returnedMemberList = JSON.parse(params.get("allianceMemberList") || "[]"); } catch (error) { returnedMemberList = []; }
    // 回传成员的唯一权威 = relay 的 allianceSnapshot.members（内含 当日/总/最后上线/是否盟主）。
    // allianceMemberList 是 2026-09-12 前的旧 relay 契约（现网 relay 已不再下发），仅作兜底。
    // 这里若仍只读旧参数，回传视图会整块丢掉成员区 —— 正是「建设点没回传到游戏」的根因。
    var returnedMemberRows = normalizeMemberRows(
      returnedSnapshot && Array.isArray(returnedSnapshot.members) && returnedSnapshot.members.length
        ? returnedSnapshot.members
        : returnedMemberList
    );
    var returnedConstruction = returnedSnapshot && returnedSnapshot.construction ? returnedSnapshot.construction : null;
    var returnedBuildings = returnedSnapshot && Array.isArray(returnedSnapshot.buildings) ? returnedSnapshot.buildings : [];
    var returnedTasks = returnedSnapshot && Array.isArray(returnedSnapshot.tasks) ? returnedSnapshot.tasks : [];
    if (returnedTasks.length >= 5 && returnedTasks.length <= 10) {
      taskPreview = returnedTasks.map(function (row, index) {
        var materialId = row.material_id || row.materialId || "";
        return {
          taskKey: String(taskDate) + ":" + String(row.slot || index + 1) + ":" + materialId,
          serverTaskId: row.id || row.task_id || row.serverTaskId || null,
          slot: row.slot || index + 1, category: row.category, skill: row.skill,
          materialId: materialId, materialName: row.material_name || row.materialName || materialId,
          requiredAmount: Number(row.required_amount == null ? row.requiredAmount : row.required_amount),
          requiredLevel: Number(row.required_level == null ? row.requiredLevel : row.required_level),
          standardTimeSec: Number(row.standard_time_sec == null ? row.standardTimeSec : row.standard_time_sec),
          materialValue: Number(row.material_value == null ? row.materialValue : row.material_value),
          difficulty: row.difficulty,
          rewardPoints: Number(row.reward_points == null ? row.rewardPoints : row.reward_points),
          tacticalTier: row.tactical_tier == null ? row.tacticalTier : Number(row.tactical_tier),
          status: row.status || "open"
        };
      });
      taskCount = taskPreview.length;
      cloudTaskStatus = "cloud";
      if (root.localStorage) root.localStorage.setItem(taskCacheKey, JSON.stringify(taskPreview));
    }
    var returnedBuildingHtml = renderBuildingSummary({ buildings: returnedBuildings, ownerId: returnedOwner }, "alliance-returned-upgrade");
    var returnedConstructionHtml = returnedConstruction
      ? '<div class="alliance-meta">建设点：' + esc(returnedConstruction.points_balance || 0) + ' · 累计获得：' + esc(returnedConstruction.total_points_earned || 0) + '</div>'
      : '';
    if (root.gameState && params.has("allianceId")) {
      if (returnedId && returnedCode) {
        // relay 的 allianceSnapshot 不保证带 buildings。旧逻辑在缺失时直接写 []，会把本地已知的
        // 任务大厅等级清成 0 ⇒ dailyTaskCount 退化成 5 ⇒ 当天任务被锁在 5 条（服务端按客户端
        // preview 长度建行，少送的槽位一整天都不会补）。缺失时保留本地已有的建筑数据。
        var previousBuildings = root.gameState.alliance && Array.isArray(root.gameState.alliance.buildings)
          ? root.gameState.alliance.buildings : [];
        root.gameState.alliance = {
          isMember: true,
          allianceId: returnedId,
          code: returnedCode,
          ownerPlayerId: returnedOwner || "",
          ownerName: returnedOwnerName || returnedOwner || "",
          memberCount: Math.max(0, Math.min(30, Number(returnedSnapshot && returnedSnapshot.memberCount != null ? returnedSnapshot.memberCount : returnedMembers) || 0)),
          memberCap: Math.max(10, Number(root.AllianceBuildingConfig && root.AllianceBuildingConfig.memberCap ? root.AllianceBuildingConfig.memberCap(returnedBuildings) : returnedCap) || returnedCap),
          buildingLevel: Math.max(0, Math.min(5, Number.isFinite(returnedBuildingLevel) ? returnedBuildingLevel : 0)),
          memberList: returnedSnapshot && Array.isArray(returnedSnapshot.members) ? returnedSnapshot.members : returnedMemberList,
          construction: returnedSnapshot && returnedSnapshot.construction ? returnedSnapshot.construction : null,
          buildings: returnedSnapshot && Array.isArray(returnedSnapshot.buildings) && returnedSnapshot.buildings.length
            ? returnedSnapshot.buildings : previousBuildings
        };
      } else {
        root.gameState.alliance = null;
      }
      root.gameState._dirty = true;
      if (root.SaveManager && root.SaveManager.save) root.SaveManager.save();
    }

    function settleReturnedTask() {
      if (!returnedTaskId || !Number.isFinite(returnedTaskAmount) || returnedTaskAmount <= 0) return;
      var state = root.gameState;
      var processedKey = "eve_idle_alliance_task_processed_" + returnedTaskId;
      if (root.localStorage && root.localStorage.getItem(processedKey)) return;
      var resourceId = returnedTaskMaterial;
      var equipmentId = resourceId.indexOf("equipment:") === 0 ? resourceId.slice("equipment:".length) : "";
      var equipmentIndex = -1;
      if (returnedTaskCategory === "equipment") {
        var inventory = state && state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
        equipmentIndex = inventory.indexOf(equipmentId);
        if (equipmentIndex < 0) { if (msg) msg.textContent = "任务材料不足：未找到指定装备"; return; }
      } else if (!state || typeof ResourceRegistry === "undefined" || ResourceRegistry.get(state, resourceId) < returnedTaskAmount) {
        if (msg) msg.textContent = "任务材料不足：" + resourceId;
        return;
      }
      var deducted = false;
      if (returnedTaskCategory === "equipment") { state.equipment.inventory.splice(equipmentIndex, 1); state._dirty = true; deducted = true; }
      else deducted = ResourceRegistry.spend(state, resourceId, returnedTaskAmount);
      if (!deducted) { if (msg) msg.textContent = "任务材料扣除失败"; return; }
      if (root.SaveManager && root.SaveManager.save) root.SaveManager.save();
      if (returnedTaskSubmitted) {
        if (root.localStorage) root.localStorage.setItem(processedKey, "1");
        var returnedTask = taskPreview.filter(function (task) { return String(task.serverTaskId) === String(returnedTaskId); })[0];
        if (returnedTask && root.localStorage) root.localStorage.setItem("eve_idle_alliance_task_processed_" + returnedTask.taskKey, "1");
        if (msg) msg.textContent = "任务已提交，联盟建设点已更新";
        if (typeof root.updateUI === "function") root.updateUI();
        return;
      }
      fetch(taskGateway, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", playerId: playerId, allianceId: returnedId, taskId: returnedTaskId, amount: returnedTaskAmount })
      }).then(function (response) { return readResponseJson(response).then(function (data) { if (!response.ok || !data.ok) throw new Error(data.error || "云端提交失败"); return data; }); })
        .then(function (data) {
          if (root.localStorage) root.localStorage.setItem(processedKey, "1");
          if (msg) msg.textContent = "任务已提交，联盟建设点 +" + data.pointsEarned;
          if (typeof root.updateUI === "function") root.updateUI();
        }).catch(function (error) {
          if (returnedTaskCategory === "equipment") state.equipment.inventory.push(equipmentId);
          else ResourceRegistry.add(state, resourceId, returnedTaskAmount);
          state._dirty = true;
          if (root.SaveManager && root.SaveManager.save) root.SaveManager.save();
          if (msg) msg.textContent = "云端提交失败，材料已退回：" + (error.message || error);
        });
    }
    settleReturnedTask();
    if (returnedRelayError) { if (msg) msg.textContent = "联盟操作未完成：" + returnedRelayError; }
    else if (returnedRelayResult === "upgrade_success") { if (msg) msg.textContent = "联盟建筑升级成功，建设点已扣除"; }
    var taskLabels = { mineral: "矿物采集", refining: "冶炼材料", gas: "气体采集", planetary: "行星材料", booster: "增强剂制造", equipment: "装备制造", "ship-component": "舰船组件" };
    // 任务用料 id 规范化：云端可能回传裸名（如"锻星合金"）或命名空间前缀（如"special:锻星合金"）。
    // 裸名需经 ResourceRegistry 的 idsByName 解析为规范 id，否则 get/spend/add 一律查不到导致永远"材料不足/提交失败"。
    function resolveTaskMaterialId(materialId) {
      if (typeof materialId !== "string") return materialId;
      if (typeof ResourceRegistry !== "undefined" && ResourceRegistry.parseId && ResourceRegistry.parseId(materialId)) return materialId;
      if (typeof ResourceRegistry !== "undefined" && ResourceRegistry.resolveMaterialIds) {
        var ids = ResourceRegistry.resolveMaterialIds(materialId);
        if (ids && ids.length) return ids[0];
      }
      return materialId;
    }
    function hasTaskMaterials(task) {
      var amount = Number(task.requiredAmount) || 0;
      if (task.category === "equipment") {
        var inventory = root.gameState && root.gameState.equipment && Array.isArray(root.gameState.equipment.inventory) ? root.gameState.equipment.inventory : [];
        return inventory.indexOf(String(task.materialId || "").replace(/^equipment:/, "")) >= 0;
      }
      return typeof ResourceRegistry !== "undefined" && ResourceRegistry.getByRef(root.gameState, task.materialId) >= amount;
    }
    if (!document.getElementById("alliance-task-polish")) {
      var taskStyle = document.createElement("style");
      taskStyle.id = "alliance-task-polish";
      taskStyle.textContent = ".alliance-task-card{padding:18px 20px}.alliance-task-card .alliance-card-title{font-size:18px;margin-bottom:12px}.alliance-task-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #20364d}.alliance-task-row>div:first-child{display:grid;grid-template-columns:30px minmax(0,1fr);column-gap:10px;align-items:center;flex:1;min-width:0}.alliance-task-slot{grid-row:1 / span 2;display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#173b59;color:#8ed9ff;font-size:12px;font-weight:700}.alliance-task-row strong{display:block;color:#eaf6ff;font-size:14px;margin-bottom:4px;min-width:0;overflow-wrap:anywhere}.alliance-task-meta{color:#8ba6bd;font-size:12px;line-height:1.5;min-width:0;overflow-wrap:anywhere}.alliance-task-ready,.alliance-task-done,.alliance-task-locked{padding:4px 8px;border-radius:999px;font-size:12px;white-space:nowrap;flex:0 0 auto}.alliance-task-ready{color:#8df0bd;background:rgba(51,181,119,.14);border:1px solid rgba(92,210,150,.35)}.alliance-task-done{color:#9fc8e2;background:rgba(100,145,180,.14);border:1px solid rgba(120,165,200,.3)}.alliance-task-locked{color:#a1afbd;background:rgba(120,140,160,.1);border:1px solid rgba(120,140,160,.22)}.alliance-task-hint{margin-top:12px;padding-top:10px;border-top:1px solid #20364d;color:#8ba6bd;font-size:12px}@media(max-width:560px){.alliance-task-row{align-items:flex-start}.alliance-task-row>span:last-child{margin-left:40px;margin-top:4px}}";
      document.head.appendChild(taskStyle);
    }
    var taskHtml = '<div class="alliance-card alliance-task-card"><div class="alliance-card-title">今日建设任务（本地状态）</div>' + (taskPreview.length === taskCount ? taskPreview.map(function (task) {
      var key = task.taskKey || (String(taskDate) + ":" + String(task.slot) + ":" + String(task.materialId || ""));
      var submitted = task.status === "completed" || (root.localStorage && root.localStorage.getItem("eve_idle_alliance_task_processed_" + key));
      var status = submitted ? "已领取" : (hasTaskMaterials(task) ? "材料足够，可提交" : "材料不足");
      var statusClass = submitted ? "alliance-task-done" : (status === "材料足够，可提交" ? "alliance-task-ready" : "alliance-task-locked");
      return '<div class="alliance-task-row"><div><span class="alliance-task-slot">' + esc(task.slot) + '</span><strong>' + esc(task.materialName) + '</strong><div class="alliance-task-meta">' + esc(taskLabels[task.category] || task.category) + ' · 需求 ' + esc(task.requiredAmount) + ' · 奖励 ' + esc(task.rewardPoints) + ' 建设点</div></div><span class="' + statusClass + '">' + status + '</span></div>';
    }).join("") : '<div class="alliance-task-hint">尚未生成任务，请先打开一次云端联盟页面。</div>') + '<div class="alliance-task-hint">当前阶段只显示本地材料状态，任务提交验证将在下一步接入。</div></div>';
    var memberHtml = returnedMemberRows.length
      ? '<div class="alliance-card-title">联盟成员</div><div class="alliance-members">' + returnedMemberRows.map(function (member) {
          return '<div class="alliance-member-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #1e354b;">' +
            '<span style="min-width:0;overflow-wrap:anywhere;">' + esc(member.username || "Steam 玩家") + renderMemberStatsLine(member) + '</span>' +
            '<span class="text-muted">' + ((member.isOwner || String(member.playerId) === String(returnedOwner)) ? "盟主" : "成员") + '</span></div>';
        }).join("") + '</div>'
      : '';
    function submitTaskFromCard(task, button) {
      var alliance = root.gameState && root.gameState.alliance;
      var allianceId = alliance && alliance.allianceId || returnedId;
      var amount = Number(task.requiredAmount) || 0;
      // 联盟 ID 只有 getAlliance()/云端回传之后才可用。过早提交会发 undefined，
      // 服务端 Number(undefined)=NaN ⇒ 400「联盟 ID 无效」，材料已扣但任务没提交。
      if (!Number.isSafeInteger(Number(allianceId)) || Number(allianceId) <= 0) {
        if (msg) msg.textContent = "正在获取联盟信息，请稍候再点提交。";
        // 只重拉一次联盟信息（不整页重绘，避免把这条提示又冲掉）。
        startCloudRefresh();
        return;
      }
      if (isTapTapRuntime() && openCloudRelay({
        relayAction: "submit_task",
        allianceId: allianceId,
        taskId: task.serverTaskId,
        taskAmount: amount,
        taskCategory: task.category || "",
        taskMaterial: task.materialId || ""
      })) {
        button.disabled = true;
        if (msg) msg.textContent = "正在通过云端提交任务…";
        return;
      }
      var equipmentId = String(task.materialId || "").replace(/^equipment:/, "");
      var inventory = root.gameState && root.gameState.equipment && root.gameState.equipment.inventory;
      var spent = task.category === "equipment"
        ? Array.isArray(inventory) && inventory.indexOf(equipmentId) >= 0 && (inventory.splice(inventory.indexOf(equipmentId), 1), true)
        : typeof ResourceRegistry !== "undefined" && ResourceRegistry.spendByRef(root.gameState, task.materialId, amount);
      if (!spent) { button.disabled = false; if (msg) msg.textContent = "材料不足"; return; }
      button.disabled = true;
      fetch(taskGateway, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit", playerId: playerId, allianceId: allianceId, taskId: task.serverTaskId, amount: amount }) })
        .then(function (response) { return readResponseJson(response).then(function (data) { if (!response.ok || !data.ok) throw new Error(data.error || "任务提交失败"); return data; }); })
        .then(function (data) { localStorage.setItem("eve_idle_alliance_task_processed_" + task.taskKey, "1"); if (root.SaveManager && root.SaveManager.save) root.SaveManager.save(); if (msg) msg.textContent = "任务提交成功，联盟建设点 +" + data.pointsEarned; load(); })
        .catch(function (error) { if (task.category === "equipment") inventory.push(equipmentId); else ResourceRegistry.add(root.gameState, resolveTaskMaterialId(task.materialId), amount); if (root.SaveManager && root.SaveManager.save) root.SaveManager.save(); button.disabled = false; if (msg) msg.textContent = error.message || "任务提交失败"; });
    }
    setTimeout(function () {
      // 云端同步成功后会再调一次 load()，而任务卡是 append 的：上一轮的 setTimeout 会
      // 在新的 innerHTML 重置之后才落地 ⇒ 面板并排堆出两张任务卡，其中旧的那张没有
      // 提交按钮（按 slot 匹配也可能落空），看上去就是「显示云端状态但点不了」。
      // 与身份卡同样处理：先移除上一轮的任务卡，保证面板只有一张。
      Array.prototype.forEach.call(content.querySelectorAll(".alliance-task-card"), function (node) { node.remove(); });
      content.insertAdjacentHTML("beforeend", taskHtml);
      // 身份卡片：作为 content 的兄弟节点挂在 #alliance-state 之外，
      // 这样云端刷新（只替换 #alliance-state）不会把它冲掉；每次 load() 重建一次。
      Array.prototype.forEach.call(content.querySelectorAll("#alliance-identity-card"), function (node) { node.remove(); });
      var identityState = root.gameState && root.gameState.alliance ? root.gameState.alliance : null;
      var identityOwnerId = (identityState && identityState.ownerPlayerId) || returnedOwner || "";
      var identityIsOwner = !!identityOwnerId && String(identityOwnerId) === String(playerId);
      var identityAllianceId = (identityState && identityState.allianceId) || returnedId || "";
      content.insertAdjacentHTML("beforeend", renderIdentityCardHtml(identityIsOwner));
      bindIdentityActions(content, identityAllianceId, identityIsOwner);
      renderIdentityMergeWarning(content, playerId);
      var taskCard = content.querySelector(".alliance-task-card");
      if (taskCard) {
        var title = taskCard.querySelector(".alliance-card-title");
        var hints = taskCard.querySelectorAll(".alliance-task-hint");
        if (title) title.textContent = cloudTaskStatus === "cloud" ? "今日建设任务（云端状态）" : cloudTaskStatus === "syncing" ? "今日建设任务（正在同步）" : "今日建设任务（本地预览）";
        if (hints.length) hints[hints.length - 1].textContent = cloudTaskStatus === "cloud" ? "任务已与联盟云端同步，提交后会增加联盟建设点。" : cloudTaskStatus === "syncing" ? "正在与联盟云端同步任务……" : "当前仅显示本地预览，云端暂时不可用。";
        if (cloudTaskStatus === "cloud") Array.prototype.forEach.call(taskCard.querySelectorAll(".alliance-task-ready"), function (status) {
          var row = status.parentNode;
          var slotNode = row && row.querySelector(".alliance-task-slot");
          var slot = Number(slotNode && slotNode.textContent) || 0;
          var task = taskPreview.filter(function (item) { return Number(item.slot) === slot; })[0];
          if (!task || !task.serverTaskId) return;
          var button = document.createElement("button");
          button.className = "btn secondary alliance-task-submit";
          button.textContent = "提交";
          button.onclick = function () { submitTaskFromCard(task, button); };
          status.replaceWith(button);
        });
      }
    }, 0);
    var returnedHq = returnedBuildings.filter(function (building) {
      var type = building.building_type || building.buildingType || "";
      return type === "frontier_hq" || type === "logistics_hub";
    })[0];
    var returnedHqLevel = Math.max(0, Number(returnedHq && returnedHq.level) || 0);
    var returnedCap = [10, 10, 15, 20, 25, 30][Math.max(0, Math.min(5, returnedHqLevel))];
    var returnedEffects = returnedBuildings.map(function (building) {
      var type = building.building_type || building.buildingType || "";
      var level = Math.max(0, Number(building.level) || 0);
      if (!level) return "";
      if (type === "frontier_hq" || type === "logistics_hub") return "总部：成员上限 " + returnedCap + " 人";
      // 这里要显示的是「每日任务条数」，不是建筑等级 —— 旧写法直接把 level 当条数印出来，
      // 任务大厅 L2 会显示成「每日任务 2 个」（真实值是 6 个）。
      if (type === "mission_hall") {
        var hallLevels = root.AllianceBuildingConfig && root.AllianceBuildingConfig.BUILDINGS &&
          root.AllianceBuildingConfig.BUILDINGS.mission_hall && root.AllianceBuildingConfig.BUILDINGS.mission_hall.levels;
        var hallRow = hallLevels && hallLevels[Math.max(0, Math.min(5, level) - 1)];
        return "任务大厅：每日任务 " + (hallRow ? hallRow.dailyTasks : level) + " 个";
      }
      if (type === "combat_command") return "战斗指挥部：战斗伤害 +" + (level * 2) + "%";
      if (type === "refining_core") return "冶炼中枢：冶炼效率 +" + (level * 5) + "%";
      return "";
    }).filter(Boolean).join(" · ");
    var returnedEffectHtml = returnedEffects ? '<div class="alliance-meta">建筑效果：' + esc(returnedEffects) + '</div>' : '';
    var fallbackHtml = returnedCode
      ? '<div class="alliance-card"><div class="alliance-card-title">当前联盟（云端回传）</div><div class="alliance-name">' + esc(returnedCode) + '</div><div class="alliance-meta">联盟创建人：' + esc(returnedOwnerName || returnedOwner || "-") + ' · 成员：' + esc(returnedMembers || "0") + '/' + esc(returnedCap) + '<br>联盟 ID：' + esc(returnedId || "-") + '</div>' + returnedConstructionHtml + returnedEffectHtml + returnedBuildingHtml + memberHtml + '</div>'
      : '<div class="alliance-empty"><div class="alliance-empty-title">联盟数据在云端页面管理</div><div class="alliance-empty-sub">点击“打开云端联盟”查看、创建或加入联盟。返回游戏后会显示云端回传的联盟摘要。</div><div class="alliance-id">当前玩家 ID：' + esc(playerId) + '</div></div>';
    content.innerHTML = '<div id="alliance-state">' + fallbackHtml + '</div>';
    function bindFallbackActions(box) {
      Array.prototype.forEach.call(box.querySelectorAll(".alliance-returned-upgrade"), function (button) {
        button.onclick = function () {
          openCloudRelay({ relayAction: "upgrade_building", allianceId: returnedId, buildingType: cloudBuildingType(button.getAttribute("data-building-type")) });
        };
      });
    }
    activeRender = { content: content, msg: msg, fallbackHtml: fallbackHtml, playerId: playerId, hasCloudReturn: params.has("allianceSnapshot"), bindFallbackActions: bindFallbackActions };
    bindFallbackActions(content);
    if (msg) msg.textContent = "正在连接云端联盟…";
    startCloudRefresh();
  }

  root.renderAlliancePage = load;
})(typeof window !== "undefined" ? window : globalThis);
