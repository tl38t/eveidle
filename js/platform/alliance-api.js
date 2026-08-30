(function (root) {
  "use strict";

  // CloudBase PG public client configuration. This key is intentionally a
  // Publishable Key; database access is still restricted by RLS policies.
  var ENV_ID = "deepspace-d4govx4ikc2e937c5";
  var PUBLISHABLE_KEY = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImJlYThhN2MzLWVmMTAtNDZlYS1hNDMwLWZkZTE0MzcyOWU0ZiJ9.eyJpc3MiOiJodHRwczovL2RlZXBzcGFjZS1kNGdvdng0aWtjMmU5MzdjNS5hcC1zaGFuZ2hhaS50Y2ItYXBpLnRlbmNlbnRjbG91ZGFwaS5jb20iLCJzdWIiOiJhbm9uIiwiYXVkIjoiZGVlcHNwYWNlLWQ0Z292eDRpa2MyZTkzN2M1IiwiZXhwIjo0MDkxNzQ5NDY2LCJpYXQiOjE3ODgwNjYyNjYsIm5vbmNlIjoiODUzWVZEWGJRSkNOWUk4Vl9RNDRSQSIsImF0X2hhc2giOiI4NTNZVkRYYlFKQ05ZSThWX1E0NFJBIiwibmFtZSI6IkFub255bW91cyIsInNjb3BlIjoiYW5vbnltb3VzIiwicHJvamVjdF9pZCI6ImRlZXBzcGFjZS1kNGdvdng0aWtjMmU5MzdjNSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.wAynz2miz35rasq0LGGFu0raNSfBLfPoOoC2pjXMssCFPdJgXHnAcR1ocABxPUgpPWwU-WdEOo7RYx8EftYCEoOXsN8YKChMkS6tWlGDtY6y4-d7DAeRm16sH4d4ceg5ZN7PBefLereV1AFJIwEVz3TNhpUiX9MZQBb1dt2K8h1uKa5j6lLMqDTGCoSdnTQHw6-FMqgvGbN6WstAQTI2bJ1jUDLX10_p-Yw_2883QpU7rhsKkLU76GjUwNEVb_5DIoIYeNEP7GehCXL5M_o4ZnwTcvKQGmTpalyjZCkjK6T8IX4mN0oKqW7ErvLDsLAezJ0yxSYnTCq8XOOba2K-fg";
  var BASE_URL = "https://" + ENV_ID + ".api.tcloudbasegateway.com";
  var playerKey = "eve_idle_alliance_player_id";
  var tokenKey = "eve_idle_alliance_access_token";

  function getPlayerId() {
    var value = localStorage.getItem(playerKey);
    if (!value) {
      value = "local_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(playerKey, value);
    }
    return value;
  }

  function request(path, options) {
    options = options || {};
    options.headers = Object.assign({
      "Content-Type": "application/json"
    }, options.headers || {});
    return fetch(BASE_URL + path, options).then(function (response) {
      return response.text().then(function (text) {
        var body = text ? JSON.parse(text) : null;
        if (!response.ok) {
          throw new Error(body && (body.message || body.error || body.error_description) || "联盟服务器请求失败（" + response.status + "）");
        }
        return body;
      });
    });
  }

  function getAccessToken() {
    var cached = localStorage.getItem(tokenKey);
    if (cached) return Promise.resolve(cached);
    return request("/auth/v1/signin/anonymously", {
      method: "POST",
      headers: { "x-device-id": getPlayerId() },
      body: "{}"
    }).then(function (body) {
      var token = body && (body.access_token || body.token);
      if (!token) throw new Error("联盟登录未返回访问令牌");
      localStorage.setItem(tokenKey, token);
      return token;
    });
  }

  function authed(path, options) {
    return getAccessToken().then(function (token) {
      options = options || {};
      options.headers = Object.assign({ Authorization: "Bearer " + token }, options.headers || {});
      return request(path, options);
    });
  }

  function getAlliance() {
    var player = encodeURIComponent("eq." + getPlayerId());
    return authed("/v1/rdb/rest/alliance_members?select=alliance_id&player_id=" + player + "&limit=1")
      .then(function (members) {
        if (!members || !members[0]) return null;
        return authed("/v1/rdb/rest/alliances?select=id,code,name,owner_player_id,member_count,created_at&id=eq." + encodeURIComponent(members[0].alliance_id) + "&limit=1");
      })
      .then(function (rows) { return rows && rows[0] ? mapAlliance(rows[0]) : null; });
  }

  function listAlliances() {
    return authed("/v1/rdb/rest/alliances?select=id,code,name,owner_player_id,member_count,created_at&order=created_at.desc&limit=100")
      .then(function (rows) { return (rows || []).map(mapAlliance); });
  }

  function createAlliance(value) {
    var check = root.AlliancePolicy.validate(value);
    if (!check.ok) return Promise.reject(new Error(check.reason));
    return getAlliance().then(function (existing) {
      if (existing) throw new Error("你已经建立了一个联盟");
      return authed("/v1/rdb/rest/alliances", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ code: check.code, name: check.code, owner_player_id: getPlayerId() })
      });
    }).then(function (rows) {
      var alliance = mapAlliance(rows && rows[0] ? rows[0] : rows);
      return authed("/v1/rdb/rest/alliance_members", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ alliance_id: alliance.id, player_id: getPlayerId() })
      }).then(function () { return alliance; });
    });
  }

  function joinAlliance(allianceId) {
    return getAlliance().then(function (existing) {
      if (existing) throw new Error("你已经加入了一个联盟");
      return authed("/v1/rdb/rest/alliances?select=id,member_count&id=eq." + encodeURIComponent(Number(allianceId)) + "&limit=1");
    }).then(function (rows) {
      if (!rows || !rows[0]) throw new Error("联盟不存在");
      if (Number(rows[0].member_count) >= 10) throw new Error("该联盟已满，最多只能有 10 名成员");
      return authed("/v1/rdb/rest/alliance_members", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ alliance_id: Number(allianceId), player_id: getPlayerId() })
      });
    }).then(function () {
      return getAlliance();
    });
  }

  function mapAlliance(row) {
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      ownerId: row.owner_player_id,
      memberCount: row.member_count,
      createdAt: row.created_at
    };
  }

  root.AllianceApi = {
    isOnline: function () { return true; },
    getPlayerId: getPlayerId,
    getAlliance: getAlliance,
    listAlliances: listAlliances,
    createAlliance: createAlliance,
    joinAlliance: joinAlliance
  };
})(typeof window !== "undefined" ? window : globalThis);
