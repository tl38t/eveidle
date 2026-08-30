(function (root) {
  "use strict";
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function load() {
    var msg = document.getElementById("alliance-msg"), el = document.getElementById("alliance-content"); if (!el) return;
    msg.textContent = "正在读取联盟信息…";
    Promise.all([AllianceApi.getAlliance(), AllianceApi.listAlliances()]).then(function (v) {
      var a = v[0], list = v[1], html = a ? '<div class="alliance-card"><div class="alliance-card-title">当前联盟</div><div class="alliance-name">' + esc(a.name) + '</div><div class="alliance-meta">联盟 ID：' + esc(a.id) + ' · 成员：' + esc(a.memberCount) + '</div></div>' : '<div class="alliance-empty"><div class="alliance-empty-title">你还没有加入联盟</div><div class="alliance-empty-sub">创建一个联盟，邀请其他玩家加入。</div><div class="alliance-create-row"><input id="alliance-name-input" maxlength="24" placeholder="输入联盟名称"><button class="btn primary" id="btn-create-alliance">建立联盟</button></div></div>';
      html += '<div class="alliance-list-title">联盟列表</div><div class="alliance-list">' + (list.length ? list.map(function (x) { return '<div class="alliance-list-row"><strong>' + esc(x.name) + '</strong><span class="text-muted">成员 ' + esc(x.memberCount) + '</span></div>'; }).join("") : '<span class="text-muted">暂无公开联盟</span>') + '</div><div class="alliance-id">当前玩家 ID：' + esc(AllianceApi.getPlayerId()) + '</div>'; el.innerHTML = html;
      var b = document.getElementById("btn-create-alliance"); if (b) b.onclick = function () { var input = document.getElementById("alliance-name-input"), name = input && input.value.trim(); if (!name) { msg.textContent = "请输入联盟名称"; return; } b.disabled = true; AllianceApi.createAlliance(name).then(load); };
      msg.textContent = "本地开发模式";
    }).catch(function (e) { msg.textContent = e.message || "联盟信息读取失败"; });
  }
  root.renderAlliancePage = load;
})(typeof window !== "undefined" ? window : globalThis);
