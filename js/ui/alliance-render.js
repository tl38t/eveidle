(function (root) {
  "use strict";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function load() {
    var msg = document.getElementById("alliance-msg");
    var content = document.getElementById("alliance-content");
    if (!content) return;
    msg.textContent = "正在读取联盟信息…";

    Promise.all([root.AllianceApi.getAlliance(), root.AllianceApi.listAlliances()]).then(function (result) {
      var current = result[0];
      var list = result[1];
      var html = current
        ? '<div class="alliance-card"><div class="alliance-card-title">当前联盟</div><div class="alliance-name">' + esc(current.name) + '</div><div class="alliance-meta">联盟 ID：' + esc(current.id) + ' · 成员：' + esc(current.memberCount) + '</div></div>'
        : '<div class="alliance-empty"><div class="alliance-empty-title">你还没有加入联盟</div><div class="alliance-empty-sub">建立一个联盟，或从下面的列表加入已有联盟。</div><div class="alliance-create-row"><input id="alliance-name-input" maxlength="3" placeholder="1～3位大写字母"><button class="btn primary" id="btn-create-alliance">建立联盟</button></div></div>';

      html += '<div class="alliance-list-title">联盟列表</div><div class="alliance-list">' + (list.length
        ? list.map(function (item) {
          var joined = current && String(current.id) === String(item.id);
          var joinAction = current || joined ? '' : (Number(item.memberCount) >= 10 ? '<span class="text-muted">已满（10/10）</span>' : '<button class="btn secondary btn-join-alliance" data-alliance-id="' + esc(item.id) + '">加入</button>');
          return '<div class="alliance-list-row"><strong>' + esc(item.name) + '</strong><span class="text-muted">成员 ' + esc(item.memberCount) + '/10</span>' + joinAction + (joined ? '<span class="text-muted">已加入</span>' : '') + '</div>';
        }).join("")
        : '<span class="text-muted">暂无公开联盟</span>') + '</div><div class="alliance-id">当前玩家 ID：' + esc(root.AllianceApi.getPlayerId()) + '</div>';
      content.innerHTML = html;

      var createButton = document.getElementById("btn-create-alliance");
      if (createButton) createButton.onclick = function () {
        var input = document.getElementById("alliance-name-input");
        createButton.disabled = true;
        root.AllianceApi.createAlliance(input ? input.value : "").then(load).catch(function (error) {
          createButton.disabled = false;
          msg.textContent = error.message || "建立联盟失败";
        });
      };

      Array.prototype.forEach.call(document.querySelectorAll(".btn-join-alliance"), function (button) {
        button.onclick = function () {
          button.disabled = true;
          msg.textContent = "正在加入联盟…";
          root.AllianceApi.joinAlliance(button.getAttribute("data-alliance-id")).then(load).catch(function (error) {
            button.disabled = false;
            msg.textContent = error.message || "加入联盟失败";
          });
        };
      });
      msg.textContent = "已连接 CloudBase";
    }).catch(function (error) {
      msg.textContent = error.message || "联盟信息读取失败";
    });
  }

  root.renderAlliancePage = load;
})(typeof window !== "undefined" ? window : globalThis);
