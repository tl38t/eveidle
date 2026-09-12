(function (root) {
  "use strict";

  // CloudBase PG public client configuration. This key is intentionally a
  // Publishable Key; database access is still restricted by RLS policies.
  var ENV_ID = "deepspace-d4govx4ikc2e937c5";
  var PUBLISHABLE_KEY = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImJlYThhN2MzLWVmMTAtNDZlYS1hNDMwLWZkZTE0MzcyOWU0ZiJ9.eyJpc3MiOiJodHRwczovL2RlZXBzcGFjZS1kNGdvdng0aWtjMmU5MzdjNS5hcC1zaGFuZ2hhaS50Y2ItYXBpLnRlbmNlbnRjbG91ZGFwaS5jb20iLCJzdWIiOiJhbm9uIiwiYXVkIjoiZGVlcHNwYWNlLWQ0Z292eDRpa2MyZTkzN2M1IiwiZXhwIjo0MDkxNzQ5NDY2LCJpYXQiOjE3ODgwNjYyNjYsIm5vbmNlIjoiODUzWVZEWGJRSkNOWUk4Vl9RNDRSQSIsImF0X2hhc2giOiI4NTNZVkRYYlFKQ05ZSThWX1E0NFJBIiwibmFtZSI6IkFub255bW91cyIsInNjb3BlIjoiYW5vbnltb3VzIiwicHJvamVjdF9pZCI6ImRlZXBzcGFjZS1kNGdvdng0aWtjMmU5MzdjNSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.wAynz2miz35rasq0LGGFu0raNSfBLfPoOoC2pjXMssCFPdJgXHnAcR1ocABxPUgpPWwU-WdEOo7RYx8EftYCEoOXsN8YKChMkS6tWlGDtY6y4-d7DAeRm16sH4d4ceg5ZN7PBefLereV1AFJIwEVz3TNhpUiX9MZQBb1dt2K8h1uKa5j6lLMqDTGCoSdnTQHw6-FMqgvGbN6WstAQTI2bJ1jUDLX10_p-Yw_2883QpU7rhsKkLU76GjUwNEVb_5DIoIYeNEP7GehCXL5M_o4ZnwTcvKQGmTpalyjZCkjK6T8IX4mN0oKqW7ErvLDsLAezJ0yxSYnTCq8XOOba2K-fg";
  var BASE_URL = "https://" + ENV_ID + ".api.tcloudbasegateway.com";
  var TAPTAP_AUTH_URL = "https://deepspace-d4govx4ikc2e937c5-1477691191.ap-shanghai.app.tcloudbase.com/taptap-auth";
  var playerKey = "eve_idle_alliance_player_id";
  var tokenKey = "eve_idle_alliance_access_token";
  var allianceSessionKey = "eve_idle_alliance_session_token";
  var steamSessionPromise = null;
  var steamPersonaName = "";
  var allianceSessionToken = "";

  function getPlayerId() {
    var value = localStorage.getItem(playerKey);
    if (!value) {
      value = "local_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(playerKey, value);
    }
    return value;
  }

  function initializeSteamIdentity() {
    if (steamSessionPromise) return steamSessionPromise;
    var tap = root.tap || (typeof globalThis !== "undefined" && globalThis.tap);
    if (tap && typeof tap.login === "function") return initializeTapTapIdentity(tap);
    var session = root.SteamAllianceSession;
    // TapTap H5 may inject window.tap shortly after the game scripts have
    // loaded. Do not immediately fall back to a local ID: that would open the
    // cloud alliance with local_xxx and taptap-auth would never be called.
    if (!session || typeof session.authenticate !== "function") {
      return waitForTapTapIdentity(0);
    }
    steamSessionPromise = session.authenticate().then(function (result) {
      if (!result || !result.ok || !result.steamId) throw new Error("Steam 联盟认证失败");
      var steamId = String(result.steamId);
      localStorage.setItem(playerKey, steamId);
        return (typeof session.getIdentity === "function" ? session.getIdentity() : Promise.resolve(null)).then(function (identity) {
        steamPersonaName = identity && identity.personaName ? String(identity.personaName).trim() : "";
        if (!steamPersonaName) return steamId;
        return upsertPlayerName(steamPersonaName).catch(function () { return null; }).then(function () { return steamId; });
      });
    }).catch(function (error) {
      steamSessionPromise = null;
      throw error;
    });
    return steamSessionPromise;
  }

  function waitForTapTapIdentity(attempt) {
    var tap = root.tap || (typeof globalThis !== "undefined" && globalThis.tap);
    if (tap && typeof tap.login === "function") return initializeTapTapIdentity(tap);
    if (attempt >= 40) return Promise.reject(new Error("TapTap SDK 未就绪，无法获取玩家身份"));
    return new Promise(function (resolve) { setTimeout(resolve, 200); }).then(function () {
      return waitForTapTapIdentity(attempt + 1);
    });
  }

  // TapTap 小游戏登录：tap.login() 的临时 code 只交给服务端换取 openid，
  // 客户端不保存 secret/session_key。联盟 player_id 使用 taptap_<openid>，
  // 与 SteamID / 本地设备 ID 隔离，云端回传后不会误显示为 Steam 玩家。
  function initializeTapTapIdentity(tap) {
    steamSessionPromise = new Promise(function (resolve, reject) {
      var settled = false;
      function done(fn, value) { if (settled) return; settled = true; fn(value); }
      function success(result) {
        var code = result && (result.code || result.js_code);
        if (!code) { done(reject, new Error("TapTap 登录未返回 code")); return; }
        fetch(TAPTAP_AUTH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code }) })
          .then(function (response) { return response.text().then(function (text) { var body = parseResponseJson(text); if (!response.ok || !body || !body.ok || !body.openid) throw new Error(body && body.error || "TapTap 身份验证失败"); return body; }); })
          .then(function (body) {
            var id = "taptap_" + String(body.openid);
            allianceSessionToken = body.sessionToken || "";
            if (allianceSessionToken) sessionStorage.setItem(allianceSessionKey, allianceSessionToken);
            localStorage.setItem(playerKey, id);
            done(resolve, id);
          }).catch(function (error) { done(reject, error); });
      }
      try {
        var returned = tap.login({ success: success, fail: function (error) { done(reject, new Error(error && (error.errMsg || error.message) || "TapTap 登录失败")); } });
        if (returned && typeof returned.then === "function") returned.then(success).catch(function (error) { done(reject, error); });
      } catch (error) { done(reject, error); }
    }).catch(function (error) { steamSessionPromise = null; throw error; });
    return steamSessionPromise;
  }

  function upsertPlayerName(username) {
    return authed("/v1/rdb/rest/players", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ player_id: getPlayerId(), username: username.slice(0, 32) })
    });
  }

  function request(path, options) {
    options = options || {};
    options.headers = Object.assign({
      "Content-Type": "application/json"
    }, options.headers || {});
    return fetch(BASE_URL + path, options).then(function (response) {
      return response.text().then(function (text) {
        var body = parseResponseJson(text);
        if (!response.ok) {
          var failure = new Error(body && (body.message || body.error || body.error_description) || "联盟服务器请求失败（" + response.status + "）");
          failure.status = response.status;
          throw failure;
        }
        return body;
      });
    });
  }

  // CloudBase gateway occasionally appends a transport marker after an
  // otherwise valid JSON document. Parse the first complete JSON value so a
  // harmless gateway suffix does not break alliance refresh.
  function parseResponseJson(text) {
    var source = String(text == null ? "" : text).replace(/^\uFEFF/, "").trim();
    if (!source) return null;
    try { return JSON.parse(source); } catch (_) {}
    var first = source.charAt(0);
    if (first !== "{" && first !== "[") return {};
    var depth = 0, quoted = false, escaped = false;
    for (var i = 0; i < source.length; i++) {
      var ch = source.charAt(i);
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === "{" || ch === "[") depth++;
      if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) return JSON.parse(source.slice(0, i + 1));
      }
    }
    return {};
  }

  function getAccessToken(forceRefresh) {
    if (forceRefresh) localStorage.removeItem(tokenKey);
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
    }).catch(function (error) {
      if (error && error.status === 401) {
        return getAccessToken(true).then(function (freshToken) {
          options = options || {};
          options.headers = Object.assign({ Authorization: "Bearer " + freshToken }, options.headers || {});
          return request(path, options);
        });
      }
      throw error;
    });
  }

  function getAlliance() {
    var player = encodeURIComponent("eq." + getPlayerId());
    return authed("/v1/rdb/rest/alliance_members?select=alliance_id&player_id=" + player + "&limit=1")
      .then(function (members) {
        if (!members || !members[0]) return null;
        return authed("/v1/rdb/rest/alliances?select=id,code,name,owner_player_id,member_count,created_at&id=eq." + encodeURIComponent(members[0].alliance_id) + "&limit=1");
      })
      .then(function (rows) {
        if (!rows || !rows[0]) return null;
        var alliance = mapAlliance(rows[0]);
        return getBuildings(alliance.id).then(function (buildings) {
          alliance.buildings = buildings;
          alliance.memberCap = root.AllianceBuildingConfig
            ? root.AllianceBuildingConfig.memberCap(buildings) : 10;
          return getConstruction(alliance.id).then(function (construction) {
            alliance.construction = construction;
            return alliance;
          });
        });
      });
  }

  function listAlliances() {
    return authed("/v1/rdb/rest/alliances?select=id,code,name,owner_player_id,member_count,created_at&order=created_at.desc&limit=100")
      .then(function (rows) {
        var alliances = (rows || []).map(mapAlliance);
        return Promise.all(alliances.map(function (alliance) {
          return getBuildings(alliance.id).then(function (buildings) {
            alliance.buildings = buildings;
            alliance.memberCap = root.AllianceBuildingConfig
              ? root.AllianceBuildingConfig.memberCap(buildings) : 10;
            return getConstruction(alliance.id).then(function (construction) {
              alliance.construction = construction;
              return alliance;
            });
          });
        }));
      });
  }

  function getBuildings(allianceId) {
    return authed("/v1/rdb/rest/alliance_buildings?select=building_type,level,points_spent&alliance_id=eq." + encodeURIComponent(Number(allianceId)) + "&limit=20")
      .then(function (rows) { return rows || []; });
  }

  function getConstruction(allianceId) {
    return authed("/v1/rdb/rest/alliance_construction?select=points_balance,total_points_earned&alliance_id=eq." + encodeURIComponent(Number(allianceId)) + "&limit=1")
      .then(function (rows) { return rows && rows[0] ? rows[0] : { points_balance: 0, total_points_earned: 0 }; });
  }

  function getMembers(allianceId) {
    var id = Number(allianceId);
    if (!Number.isSafeInteger(id) || id <= 0) return Promise.reject(new Error("联盟 ID 无效"));
    return authed("/v1/rdb/rest/alliance_members?select=player_id&alliance_id=eq." + encodeURIComponent(id) + "&limit=30")
      .then(function (members) {
        members = members || [];
        var ids = members.map(function (member) { return member.player_id; }).filter(Boolean);
        if (!ids.length) return [];
        // Player IDs from TapTap may contain `/` and `=`. PostgREST's `in`
        // operator requires each value to be quoted; encoding individual
        // values is not sufficient because the gateway decodes them before
        // parsing the filter.
        var quotedIds = ids.map(function (id) {
          return '"' + String(id).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
        }).join(",");
        return authed("/v1/rdb/rest/players?select=player_id,username&player_id=" + encodeURIComponent("in.(" + quotedIds + ")"))
          .then(function (players) {
            var names = {};
            (players || []).forEach(function (player) { names[player.player_id] = player.username || ""; });
            return members.map(function (member) {
              return { playerId: member.player_id, username: names[member.player_id] || (String(member.player_id) === String(getPlayerId()) ? steamPersonaName : "") };
            });
          });
      });
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
      return authed("/v1/rdb/rest/alliances?select=id,member_count&id=eq." + encodeURIComponent(Number(allianceId)) + "&limit=1").then(function (rows) {
        if (!rows || !rows[0]) return rows;
        return getBuildings(rows[0].id).then(function (buildings) {
          rows[0].member_cap = root.AllianceBuildingConfig
            ? root.AllianceBuildingConfig.memberCap(buildings) : 10;
          return rows;
        });
      });
    }).then(function (rows) {
      if (!rows || !rows[0]) throw new Error("联盟不存在");
      var cap = Number(rows[0].member_cap) || 10;
      if (Number(rows[0].member_count) >= cap) throw new Error("该联盟已满，最多只能有 " + cap + " 名成员");
      return authed("/rpc/join_alliance_with_capacity", {
        method: "POST",
        body: JSON.stringify({ p_alliance_id: Number(allianceId), p_player_id: getPlayerId() })
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
      memberCap: 10,
      createdAt: row.created_at
    };
  }

  function diagnose() {
    var report = {
      protocol: root.location && root.location.protocol || "unknown",
      userAgent: root.navigator && root.navigator.userAgent || "unknown",
      endpoint: BASE_URL,
      deviceId: getPlayerId(),
      steps: []
    };
    function step(name, fn) {
      var started = Date.now();
      return Promise.resolve().then(fn).then(function (value) {
        report.steps.push({ name: name, ok: true, ms: Date.now() - started, detail: value || "OK" });
        return value;
      }).catch(function (error) {
        report.steps.push({ name: name, ok: false, ms: Date.now() - started, detail: error && error.message || String(error) });
        return null;
      });
    }
    return step("匿名登录", getAccessToken)
      .then(function (token) { return token ? step("联盟列表读取", listAlliances) : null; })
      .then(function () { return report; });
  }

  root.AllianceApi = {
    isOnline: function () { return true; },
    getPlayerId: getPlayerId,
    getPlayerName: function () { return steamPersonaName; },
    getAllianceSessionToken: function () {
      if (allianceSessionToken) return allianceSessionToken;
      try { return sessionStorage.getItem(allianceSessionKey) || ""; } catch (_) { return ""; }
    },
    initializeSteamIdentity: initializeSteamIdentity,
    getAlliance: getAlliance,
    listAlliances: listAlliances,
    getMembers: getMembers,
    createAlliance: createAlliance,
    joinAlliance: joinAlliance,
    diagnose: diagnose
  };
})(typeof window !== "undefined" ? window : globalThis);
