(function (root) {
  "use strict";

  var cloudOrigin = "https://alliance-deepspace-d4govx4ikc2e937c5.webapps.tcloudbase.com";
  var taskGateway = "https://deepspace-d4govx4ikc2e937c5.api.tcloudbasegateway.com/alliance-daily-tasks";
  var cloudTaskSyncStarted = false;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // In-game direct cloud read (desktop first). TapTap keeps working because any
  // network failure degrades to the cloud-page fallback below.
  var activeRender = null;

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
      memberCount: Math.max(0, Math.min(10, Number(alliance.memberCount) || 1)),
      buildingLevel: 0,
      memberList: []
    };
    root.gameState._dirty = true;
    if (root.SaveManager && root.SaveManager.save) root.SaveManager.save();
  }

  function renderMemberCard(alliance) {
    return '<div class="alliance-card"><div class="alliance-card-title">当前联盟（实时）</div>' +
      '<div class="alliance-name">' + esc(alliance.name || alliance.code) + '</div>' +
      '<div class="alliance-meta">联盟代码：' + esc(alliance.code) + ' · 成员：' + esc(alliance.memberCount) + '/10<br>联盟 ID：' + esc(alliance.id) + '</div></div>';
  }

  function renderListView(list) {
    var rows = list.map(function (a) {
      var full = Number(a.memberCount) >= 10;
      return '<div class="alliance-member-row"><span>' + esc(a.name || a.code) + '</span>' +
        '<span class="text-muted">' + esc(a.memberCount) + '/10</span>' +
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
    withTimeout(root.AllianceApi.getAlliance(), 8000).then(function (alliance) {
      if (alliance) {
        rememberAlliance(alliance);
        box.innerHTML = renderMemberCard(alliance);
        if (ctx.msg) ctx.msg.textContent = "已连接云端联盟";
        return null;
      }
      return withTimeout(root.AllianceApi.listAlliances(), 8000).then(function (list) {
        box.innerHTML = renderListView(list || []);
        bindListActions(box, ctx.msg);
        if (ctx.msg) ctx.msg.textContent = "已连接云端（未加入联盟）";
      });
    }).catch(function () {
      box.innerHTML = ctx.fallbackHtml;
      if (ctx.msg) ctx.msg.textContent = "云端连接失败，已切换云端页模式";
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

    var playerId = root.AllianceApi && root.AllianceApi.getPlayerId
      ? root.AllianceApi.getPlayerId()
      : "";
    var taskPreview = [];
    var taskDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    var taskCacheKey = "eve_idle_alliance_tasks_v4_" + playerId + "_" + taskDate;
    try {
      var taskState = root.gameState || {};
      var cached = root.localStorage && root.localStorage.getItem(taskCacheKey);
      if (cached) {
        try { taskPreview = JSON.parse(cached); } catch (ignore) { taskPreview = []; }
      }
      if (!Array.isArray(taskPreview) || taskPreview.length !== 5) {
        var taskCatalog = root.AllianceTaskCatalog && root.AllianceTaskCatalog.buildRuntimeCatalog
          ? root.AllianceTaskCatalog.buildRuntimeCatalog(root) : [];
        taskPreview = root.AllianceTaskModel && root.AllianceTaskModel.generateFive
          ? root.AllianceTaskModel.generateFive(playerId, taskDate, taskState, taskCatalog) : [];
      }
      taskPreview = taskPreview.map(function (task) { return {
        taskKey: task.taskKey || (String(taskDate) + ":" + String(task.slot) + ":" + String(task.materialId || "")),
        slot: task.slot, category: task.category, skill: task.skill,
        materialId: task.materialId, materialName: task.materialName,
        requiredAmount: task.requiredAmount, requiredLevel: task.requiredLevel,
        standardTimeSec: task.standardTimeSec, materialValue: task.materialValue,
        difficulty: task.difficulty,
        rewardPoints: task.rewardPoints,
        tacticalTier: task.tacticalTier
      }; });
      if (taskPreview.length === 5 && root.localStorage) root.localStorage.setItem(taskCacheKey, JSON.stringify(taskPreview));
    } catch (error) { taskPreview = []; }
    if (!cloudTaskSyncStarted && playerId && taskPreview.length === 5) {
      cloudTaskSyncStarted = true;
      fetch(taskGateway, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerId, taskPreview: taskPreview })
      }).then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok || !data || !data.ok || !Array.isArray(data.tasks) || data.tasks.length !== 5) throw new Error("云端任务返回无效");
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
            tacticalTier: row.tactical_tier == null ? row.tacticalTier : Number(row.tactical_tier)
          };
        });
        if (root.localStorage) root.localStorage.setItem(taskCacheKey, JSON.stringify(synced));
        load();
      }).catch(function () { /* Keep the local preview visible if the gateway is temporarily unavailable. */ });
    }
    // Do not carry a previous alliance summary into the next round trip.
    // Otherwise URLSearchParams may read the old duplicate parameter first.
    var returnUrl = root.location.href.split("?")[0].split("#")[0];
    var url = cloudOrigin + "/?embedded=1&v=4&playerId=" + encodeURIComponent(playerId) +
      "&returnUrl=" + encodeURIComponent(returnUrl) +
      "&taskDate=" + encodeURIComponent(taskDate || "") +
      "&taskPreview=" + encodeURIComponent(JSON.stringify(taskPreview));

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
    var returnedMemberList = [];
    try { returnedMemberList = JSON.parse(params.get("allianceMemberList") || "[]"); } catch (error) { returnedMemberList = []; }
    if (root.gameState && params.has("allianceId")) {
      if (returnedId && returnedCode) {
        root.gameState.alliance = {
          isMember: true,
          allianceId: returnedId,
          code: returnedCode,
          ownerPlayerId: returnedOwner || "",
          ownerName: returnedOwnerName || returnedOwner || "",
          memberCount: Math.max(0, Math.min(10, Number(returnedMembers) || 0)),
          buildingLevel: Math.max(0, Math.min(5, Number.isFinite(returnedBuildingLevel) ? returnedBuildingLevel : 0)),
          memberList: returnedMemberList
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
      fetch("https://deepspace-d4govx4ikc2e937c5.api.tcloudbasegateway.com/alliance-daily-tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", playerId: playerId, allianceId: returnedId, taskId: returnedTaskId, amount: returnedTaskAmount })
      }).then(function (response) { return response.json().then(function (data) { if (!response.ok || !data.ok) throw new Error(data.error || "云端提交失败"); return data; }); })
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
    var taskLabels = { mineral: "矿物采集", refining: "冶炼材料", gas: "气体采集", planetary: "行星材料", booster: "增强剂制造", equipment: "装备制造", "ship-component": "舰船组件" };
    function hasTaskMaterials(task) {
      var amount = Number(task.requiredAmount) || 0;
      if (task.category === "equipment") {
        var inventory = root.gameState && root.gameState.equipment && Array.isArray(root.gameState.equipment.inventory) ? root.gameState.equipment.inventory : [];
        return inventory.indexOf(String(task.materialId || "").replace(/^equipment:/, "")) >= 0;
      }
      return typeof ResourceRegistry !== "undefined" && ResourceRegistry.get(root.gameState, task.materialId) >= amount;
    }
    var taskHtml = '<div class="alliance-card alliance-task-card"><div class="alliance-card-title">今日建设任务（本地状态）</div>' + (taskPreview.length === 5 ? taskPreview.map(function (task) {
      var key = task.taskKey || (String(taskDate) + ":" + String(task.slot) + ":" + String(task.materialId || ""));
      var submitted = root.localStorage && root.localStorage.getItem("eve_idle_alliance_task_processed_" + key);
      var status = submitted ? "已领取" : (hasTaskMaterials(task) ? "材料足够，可提交" : "材料不足");
      var statusClass = submitted ? "alliance-task-done" : (status === "材料足够，可提交" ? "alliance-task-ready" : "alliance-task-locked");
      return '<div class="alliance-task-row"><div><span class="alliance-task-slot">' + esc(task.slot) + '</span><strong>' + esc(task.materialName) + '</strong><div class="alliance-task-meta">' + esc(taskLabels[task.category] || task.category) + ' · 需求 ' + esc(task.requiredAmount) + ' · 奖励 ' + esc(task.rewardPoints) + ' 建设点</div></div><span class="' + statusClass + '">' + status + '</span></div>';
    }).join("") : '<div class="alliance-task-hint">尚未生成任务，请先打开一次云端联盟页面。</div>') + '<div class="alliance-task-hint">当前阶段只显示本地材料状态，任务提交验证将在下一步接入。</div></div>';
    var memberHtml = returnedMemberList.length ? '<div class="alliance-card-title">联盟成员</div><div class="alliance-members">' + returnedMemberList.map(function (member) { return '<div class="alliance-member-row"><span>' + esc(member.username || member.playerId) + '</span><span class="text-muted">' + esc(member.playerId) + '</span></div>'; }).join("") + '</div>' : '';
    setTimeout(function () { content.insertAdjacentHTML("beforeend", taskHtml); }, 0);
    var fallbackHtml = returnedCode
      ? '<div class="alliance-card"><div class="alliance-card-title">当前联盟（云端回传）</div><div class="alliance-name">' + esc(returnedCode) + '</div><div class="alliance-meta">联盟创建人：' + esc(returnedOwnerName || returnedOwner || "-") + ' · 成员：' + esc(returnedMembers || "0") + '/10<br>联盟 ID：' + esc(returnedId || "-") + '</div>' + memberHtml + '</div>'
      : '<div class="alliance-empty"><div class="alliance-empty-title">联盟数据在云端页面管理</div><div class="alliance-empty-sub">点击“打开云端联盟”查看、创建或加入联盟。返回游戏后会显示云端回传的联盟摘要。</div><div class="alliance-id">当前玩家 ID：' + esc(playerId) + '</div></div>';
    content.innerHTML = '<div id="alliance-state">' + fallbackHtml + '</div>';
    activeRender = { content: content, msg: msg, fallbackHtml: fallbackHtml, playerId: playerId };
    if (msg) msg.textContent = "正在连接云端联盟…";
    startCloudRefresh();
  }

  root.renderAlliancePage = load;
})(typeof window !== "undefined" ? window : globalThis);
