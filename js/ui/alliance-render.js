(function (root) {
  "use strict";

  var cloudOrigin = "https://alliance-deepspace-d4govx4ikc2e937c5.webapps.tcloudbase.com";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
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
    try {
      var taskState = root.gameState || {};
      var taskDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
      var taskCatalog = root.AllianceTaskCatalog && root.AllianceTaskCatalog.buildRuntimeCatalog
        ? root.AllianceTaskCatalog.buildRuntimeCatalog(root) : [];
      taskPreview = root.AllianceTaskModel && root.AllianceTaskModel.generateFive
        ? root.AllianceTaskModel.generateFive(playerId, taskDate, taskState, taskCatalog) : [];
      taskPreview = taskPreview.map(function (task) { return {
        slot: task.slot, category: task.category, skill: task.skill,
        materialId: task.materialId, materialName: task.materialName,
        requiredAmount: task.requiredAmount, requiredLevel: task.requiredLevel,
        standardTimeSec: task.standardTimeSec, materialValue: task.materialValue,
        difficulty: task.difficulty,
        rewardPoints: task.rewardPoints,
        tacticalTier: task.tacticalTier
      }; });
    } catch (error) { taskPreview = []; }
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
      root.location.href = url + "&diagnose=1";
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
    var memberHtml = returnedMemberList.length ? '<div class="alliance-card-title">联盟成员</div><div class="alliance-members">' + returnedMemberList.map(function (member) { return '<div class="alliance-member-row"><span>' + esc(member.username || member.playerId) + '</span><span class="text-muted">' + esc(member.playerId) + '</span></div>'; }).join("") + '</div>' : '';
    content.innerHTML = returnedCode
      ? '<div class="alliance-card"><div class="alliance-card-title">当前联盟（云端回传）</div><div class="alliance-name">' + esc(returnedCode) + '</div><div class="alliance-meta">联盟创建人：' + esc(returnedOwnerName || returnedOwner || "-") + ' · 成员：' + esc(returnedMembers || "0") + '/10<br>联盟 ID：' + esc(returnedId || "-") + '</div>' + memberHtml + '</div>'
      : '<div class="alliance-empty"><div class="alliance-empty-title">联盟数据在云端页面管理</div><div class="alliance-empty-sub">点击“打开云端联盟”查看、创建或加入联盟。返回游戏后会显示云端回传的联盟摘要。</div><div class="alliance-id">当前玩家 ID：' + esc(playerId) + '</div></div>';
    if (msg) msg.textContent = "云端联盟已就绪";
  }

  root.renderAlliancePage = load;
})(typeof window !== "undefined" ? window : globalThis);
