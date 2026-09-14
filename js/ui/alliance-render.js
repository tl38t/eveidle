(function (root) {
  "use strict";

  var cloudOrigin = "https://alliance-deepspace-d4govx4ikc2e937c5.webapps.tcloudbase.com";
  var taskGateway = "https://deepspace-d4govx4ikc2e937c5-1477691191.ap-shanghai.app.tcloudbase.com/alliance-daily-tasks";
  var adminGateway = "https://deepspace-d4govx4ikc2e937c5-1477691191.ap-shanghai.app.tcloudbase.com/alliance-admin";
  var cloudTaskSyncStarted = false;
  var cloudTaskStatus = "local";
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
  root.AllianceRenderHelpers = { formatRelativeTime: formatRelativeTime };

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
    members = (members || []).slice().sort(function (a, b) {
      var aOwner = String(a.playerId) === String(alliance.ownerId) ? 0 : 1;
      var bOwner = String(b.playerId) === String(alliance.ownerId) ? 0 : 1;
      return aOwner - bOwner;
    });
    var memberRows = members.map(function (member) {
      var isOwner = member.isOwner || String(member.playerId) === String(alliance.ownerId);
      var stats = '<span class="text-muted" style="display:block;font-size:12px;margin-top:2px;">当日 ' + esc(member.dailyPoints) + ' · 总 ' + esc(member.totalPoints) + ' · ' + esc(formatRelativeTime(member.lastOnlineAt)) + '</span>';
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
      '<input id="alliance-new-code" maxlength="3" placeholder="例如 EVE" autocomplete="off" style="flex:1;min-width:0;text-transform:uppercase;padding:6px 8px;background:#0a1420;border:1px solid #24405c;border-radius:6px;color:#d8e2ee;">' +
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
    withTimeout(root.AllianceApi.getAlliance(), 8000).then(function (alliance) {
      if (alliance) {
        rememberAlliance(alliance);
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
    var taskCount = root.AllianceBuildingConfig && root.gameState && root.gameState.alliance
      ? root.AllianceBuildingConfig.dailyTaskCount(root.gameState.alliance.buildings || []) : 5;
    var taskDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    var taskCacheKey = "eve_idle_alliance_tasks_v4_" + playerId + "_" + taskDate;
    try {
      var taskState = root.gameState || {};
      var cached = root.localStorage && root.localStorage.getItem(taskCacheKey);
      if (cached) {
        try { taskPreview = JSON.parse(cached); } catch (ignore) { taskPreview = []; }
      }
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
        requiredAmount: task.requiredAmount, requiredLevel: task.requiredLevel,
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
    if (identityReady && !isTapTapRuntime() && !/^local_/.test(String(playerId)) && !cloudTaskSyncStarted && taskPreview.length === taskCount) {
      cloudTaskSyncStarted = true;
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
        var synced = rows.map(function (row, index) {
          var materialId = row.material_id || row.materialId || "";
          return {
            taskKey: String(taskDate) + ":" + String(row.slot || index + 1) + ":" + materialId,
            serverTaskId: row.id || row.task_id || null,
            slot: row.slot || index + 1, category: row.category, skill: row.skill,
            materialId: materialId, materialName: row.material_name || row.materialName || materialId,
            requiredAmount: Number(row.required_amount == null ? row.requiredAmount : row.required_amount),
            requiredLevel: Number(row.required_level == null ? row.requiredLevel : row.required_level),
            standardTimeSec: Number(row.standard_time_sec == null ? row.standardTimeSec : row.standard_time_sec),
            materialValue: Number(row.material_value == null ? row.materialValue : row.material_value),
            difficulty: row.difficulty, rewardPoints: Number(row.reward_points == null ? row.rewardPoints : row.reward_points),
            tacticalTier: row.tactical_tier == null ? row.tacticalTier : Number(row.tactical_tier),
            status: row.status || "open"
          };
        });
        taskPreview = synced;
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
          buildings: returnedSnapshot && Array.isArray(returnedSnapshot.buildings) ? returnedSnapshot.buildings : []
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
    function hasTaskMaterials(task) {
      var amount = Number(task.requiredAmount) || 0;
      if (task.category === "equipment") {
        var inventory = root.gameState && root.gameState.equipment && Array.isArray(root.gameState.equipment.inventory) ? root.gameState.equipment.inventory : [];
        return inventory.indexOf(String(task.materialId || "").replace(/^equipment:/, "")) >= 0;
      }
      return typeof ResourceRegistry !== "undefined" && ResourceRegistry.get(root.gameState, task.materialId) >= amount;
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
    var memberHtml = returnedMemberList.length ? '<div class="alliance-card-title">联盟成员</div><div class="alliance-members">' + returnedMemberList.map(function (member) { return '<div class="alliance-member-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #1e354b;"><span style="min-width:0;overflow-wrap:anywhere;">' + esc(member.username || "Steam 玩家") + '</span></div>'; }).join("") + '</div>' : '';
    function submitTaskFromCard(task, button) {
      var alliance = root.gameState && root.gameState.alliance;
      var allianceId = alliance && alliance.allianceId || returnedId;
      var amount = Number(task.requiredAmount) || 0;
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
        : typeof ResourceRegistry !== "undefined" && ResourceRegistry.spend(root.gameState, task.materialId, amount);
      if (!spent) { button.disabled = false; if (msg) msg.textContent = "材料不足"; return; }
      button.disabled = true;
      fetch(taskGateway, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit", playerId: playerId, allianceId: allianceId, taskId: task.serverTaskId, amount: amount }) })
        .then(function (response) { return readResponseJson(response).then(function (data) { if (!response.ok || !data.ok) throw new Error(data.error || "任务提交失败"); return data; }); })
        .then(function (data) { localStorage.setItem("eve_idle_alliance_task_processed_" + task.taskKey, "1"); if (root.SaveManager && root.SaveManager.save) root.SaveManager.save(); if (msg) msg.textContent = "任务提交成功，联盟建设点 +" + data.pointsEarned; load(); })
        .catch(function (error) { if (task.category === "equipment") inventory.push(equipmentId); else ResourceRegistry.add(root.gameState, task.materialId, amount); if (root.SaveManager && root.SaveManager.save) root.SaveManager.save(); button.disabled = false; if (msg) msg.textContent = error.message || "任务提交失败"; });
    }
    setTimeout(function () {
      content.insertAdjacentHTML("beforeend", taskHtml);
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
      if (type === "mission_hall") return "任务大厅：每日任务 " + level + " 个";
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
