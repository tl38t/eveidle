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
    // Do not carry a previous alliance summary into the next round trip.
    // Otherwise URLSearchParams may read the old duplicate parameter first.
    var returnUrl = root.location.href.split("?")[0].split("#")[0];
    var url = cloudOrigin + "/?embedded=1&v=4&playerId=" + encodeURIComponent(playerId) +
      "&returnUrl=" + encodeURIComponent(returnUrl);

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
    var returnedId = params.get("allianceId");
    var returnedMemberList = [];
    try { returnedMemberList = JSON.parse(params.get("allianceMemberList") || "[]"); } catch (error) { returnedMemberList = []; }
    var memberHtml = returnedMemberList.length ? '<div class="alliance-card-title">联盟成员</div><div class="alliance-members">' + returnedMemberList.map(function (member) { return '<div class="alliance-member-row"><span>' + esc(member.username || member.playerId) + '</span><span class="text-muted">' + esc(member.playerId) + '</span></div>'; }).join("") + '</div>' : '';
    content.innerHTML = returnedCode
      ? '<div class="alliance-card"><div class="alliance-card-title">当前联盟（云端回传）</div><div class="alliance-name">' + esc(returnedCode) + '</div><div class="alliance-meta">联盟创建人：' + esc(returnedOwnerName || returnedOwner || "-") + ' · 成员：' + esc(returnedMembers || "0") + '/10<br>联盟 ID：' + esc(returnedId || "-") + '</div>' + memberHtml + '</div>'
      : '<div class="alliance-empty"><div class="alliance-empty-title">联盟数据在云端页面管理</div><div class="alliance-empty-sub">点击“打开云端联盟”查看、创建或加入联盟。返回游戏后会显示云端回传的联盟摘要。</div><div class="alliance-id">当前玩家 ID：' + esc(playerId) + '</div></div>';
    if (msg) msg.textContent = "云端联盟已就绪";
  }

  root.renderAlliancePage = load;
})(typeof window !== "undefined" ? window : globalThis);
