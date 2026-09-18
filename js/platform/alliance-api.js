(function (root) {
  "use strict";

  // CloudBase PG public client configuration. This key is intentionally a
  // Publishable Key; database access is still restricted by RLS policies.
  var ENV_ID = "deepspace-d4govx4ikc2e937c5";
  var PUBLISHABLE_KEY = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImJlYThhN2MzLWVmMTAtNDZlYS1hNDMwLWZkZTE0MzcyOWU0ZiJ9.eyJpc3MiOiJodHRwczovL2RlZXBzcGFjZS1kNGdvdng0aWtjMmU5MzdjNS5hcC1zaGFuZ2hhaS50Y2ItYXBpLnRlbmNlbnRjbG91ZGFwaS5jb20iLCJzdWIiOiJhbm9uIiwiYXVkIjoiZGVlcHNwYWNlLWQ0Z292eDRpa2MyZTkzN2M1IiwiZXhwIjo0MDkxNzQ5NDY2LCJpYXQiOjE3ODgwNjYyNjYsIm5vbmNlIjoiODUzWVZEWGJRSkNOWUk4Vl9RNDRSQSIsImF0X2hhc2giOiI4NTNZVkRYYlFKQ05ZSThWX1E0NFJBIiwibmFtZSI6IkFub255bW91cyIsInNjb3BlIjoiYW5vbnltb3VzIiwicHJvamVjdF9pZCI6ImRlZXBzcGFjZS1kNGdvdng0aWtjMmU5MzdjNSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.wAynz2miz35rasq0LGGFu0raNSfBLfPoOoC2pjXMssCFPdJgXHnAcR1ocABxPUgpPWwU-WdEOo7RYx8EftYCEoOXsN8YKChMkS6tWlGDtY6y4-d7DAeRm16sH4d4ceg5ZN7PBefLereV1AFJIwEVz3TNhpUiX9MZQBb1dt2K8h1uKa5j6lLMqDTGCoSdnTQHw6-FMqgvGbN6WstAQTI2bJ1jUDLX10_p-Yw_2883QpU7rhsKkLU76GjUwNEVb_5DIoIYeNEP7GehCXL5M_o4ZnwTcvKQGmTpalyjZCkjK6T8IX4mN0oKqW7ErvLDsLAezJ0yxSYnTCq8XOOba2K-fg";
  var BASE_URL = "https://" + ENV_ID + ".api.tcloudbasegateway.com";
  var TAPTAP_AUTH_URL = "https://deepspace-d4govx4ikc2e937c5-1477691191.ap-shanghai.app.tcloudbase.com/taptap-auth";
  var IDENTITY_GATEWAY = "https://deepspace-d4govx4ikc2e937c5-1477691191.ap-shanghai.app.tcloudbase.com/alliance-identity";
  var playerKey = "eve_idle_alliance_player_id";
  var deviceSecretKey = "eve_idle_alliance_device_secret";
  var tokenKey = "eve_idle_alliance_access_token";
  var allianceSessionKey = "eve_idle_alliance_session_token";
  var steamSessionPromise = null;
  var steamPersonaName = "";
  var allianceSessionToken = "";
  // 平台身份归并失败的留痕（2026-09-18）：归并失败此前只在 console.warn 里出现，
  // 玩家会永久停在 local_ 设备身份且毫无察觉。此处保留最近一次失败供 UI 展示与重试。
  var identityMergeIssue = null;
  var lastPlatformId = "";
  // 身份等待窗口：联盟页走完整 8s（40×200ms）；启动预热用短窗口 2s（10×200ms）。
  var IDENTITY_WAIT_ATTEMPTS = 40;
  var IDENTITY_WARMUP_ATTEMPTS = 10;

  // 设备密钥：128bit 随机十六进制，只存本机、只走云函数转发（绝不进 URL）。
  // 它是设备身份的唯一凭证：签发转移码、兑换转移码、被并入平台身份都要用它自证。
  function randomHex(byteLength) {
    var out = "";
    try {
      var buffer = new Uint8Array(byteLength);
      var webCrypto = root.crypto || root.msCrypto;
      webCrypto.getRandomValues(buffer);
      for (var i = 0; i < buffer.length; i++) out += ("0" + buffer[i].toString(16)).slice(-2);
      return out;
    } catch (_) {
      out = "";
      for (var j = 0; j < byteLength * 2; j++) out += Math.floor(Math.random() * 16).toString(16);
      return out;
    }
  }

  function getDeviceSecret() {
    var value = "";
    try { value = localStorage.getItem(deviceSecretKey) || ""; } catch (_) { value = ""; }
    if (!/^[0-9a-f]{32,64}$/.test(value)) {
      value = randomHex(16);
      try { localStorage.setItem(deviceSecretKey, value); } catch (_) {}
    }
    return value;
  }

  function isDeviceIdentity(value) {
    return /^local_/.test(String(value || "")) || /^dev_/.test(String(value || ""));
  }

  // 设备身份 id 由密钥前 12 位派生（local_<12hex>）。服务端能用密钥复算出 id，
  // 所以「知道 id」不等于「持有密钥」，无法抢注他人身份。
  // 注意：已存在的老 id（local_<ts36>_<rand6>）一律原样保留，不做迁移。
  function getPlayerId() {
    var value = localStorage.getItem(playerKey);
    if (!value) {
      value = "local_" + getDeviceSecret().slice(0, 12);
      localStorage.setItem(playerKey, value);
    }
    return value;
  }

  function getAllianceSessionToken() {
    if (allianceSessionToken) return allianceSessionToken;
    try { return sessionStorage.getItem(allianceSessionKey) || ""; } catch (_) { return ""; }
  }

  // 身份类动作的唯一入口：全部经 alliance-identity 云函数转发
  // （对应 RPC 在库里已 revoke all from public，anon 拿不到）。
  function identityRequest(action, payload) {
    var headers = { "Content-Type": "application/json" };
    var token = getAllianceSessionToken();
    if (token) headers["x-alliance-session"] = token;
    return fetch(IDENTITY_GATEWAY, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    }).then(function (response) {
      return response.text().then(function (text) {
        var parsed = parseResponseJson(text);
        if (!response.ok || !parsed || !parsed.ok) {
          throw new Error(parsed && parsed.error || "身份服务请求失败（" + response.status + "）");
        }
        return parsed;
      });
    });
  }

  function rememberPlayerId(id) {
    try { localStorage.setItem(playerKey, id); } catch (_) {}
    // 匿名访问令牌是按旧身份领的，切换身份后必须重新领取。
    try { localStorage.removeItem(tokenKey); } catch (_) {}
    return id;
  }

  // 平台身份就绪时的切换动作：若此前已固化设备身份，先把它并入平台身份再切换，
  // 否则同一人在云端会变成两条成员记录（这正是「换设备多一个 id」的成因）。
  // 归并不成功（例如两个身份各自已在不同联盟）时不静默丢弃设备身份。
  function adoptPlatformIdentity(platformId) {
    var previous = "";
    try { previous = localStorage.getItem(playerKey) || ""; } catch (_) { previous = ""; }
    if (!previous || previous === platformId || !isDeviceIdentity(previous)) {
      identityMergeIssue = null;
      return Promise.resolve(rememberPlayerId(platformId));
    }
    lastPlatformId = platformId;
    return identityRequest("merge_local", {
      devicePlayerId: previous,
      secret: getDeviceSecret(),
      platformPlayerId: platformId
    }).then(function () {
      identityMergeIssue = null;
      return rememberPlayerId(platformId);
    }).catch(function (error) {
      // 静默吞掉 = 玩家永久卡在 local_ 且不知情（原先只 console.warn 后保持设备身份）。
      // 现在留痕 + 报错，并由联盟页提供「重新绑定平台身份」入口重试。
      var message = (error && error.message) || String(error || "未知错误");
      identityMergeIssue = { message: message, platformId: platformId, at: Date.now() };
      if (typeof console !== "undefined" && console.error) {
        console.error("Alliance identity merge failed:", message);
      }
      return previous;
    });
  }

  // 归并失败后的重试入口：仍以设备密钥自证，云端条件改善（例如两个身份已在同一联盟）即可并入。
  function retryPlatformIdentity() {
    if (!lastPlatformId) return Promise.reject(new Error("没有待重试的平台身份"));
    return adoptPlatformIdentity(lastPlatformId);
  }

  function getIdentityIssue() {
    return identityMergeIssue;
  }

  // options.maxAttempts：等待 window.tap 注入的轮询次数（每次 200ms）。
  // 不传 = 40 次（8s，联盟页长等待）；启动预热传 10（2s 短窗口，失败即静默放弃）。
  function initializeSteamIdentity(options) {
    if (steamSessionPromise) return steamSessionPromise;
    var maxAttempts = options && typeof options.maxAttempts === "number" && options.maxAttempts > 0
      ? options.maxAttempts
      : IDENTITY_WAIT_ATTEMPTS;
    var tap = root.tap || (typeof globalThis !== "undefined" && globalThis.tap);
    if (tap && typeof tap.login === "function") return initializeTapTapIdentity(tap);
    var session = root.SteamAllianceSession;
    // TapTap H5 may inject window.tap shortly after the game scripts have
    // loaded. Do not immediately fall back to a local ID: that would open the
    // cloud alliance with local_xxx and taptap-auth would never be called.
    if (!session || typeof session.authenticate !== "function") {
      // 登记单例：启动预热与联盟页共享同一次 tap.login（避免并发重复取 code）。
      // 拒绝时清空，使后续调用（联盟页长窗口重试）能完整重新尝试。
      steamSessionPromise = waitForTapTapIdentity(0, maxAttempts).catch(function (error) {
        steamSessionPromise = null;
        throw error;
      });
      return steamSessionPromise;
    }
    steamSessionPromise = session.authenticate().then(function (result) {
      if (!result || !result.ok || !result.steamId) throw new Error("Steam 联盟认证失败");
      var steamId = String(result.steamId);
      // SteamID64 本来就是账号级；若本机此前已固化设备身份，先并入再切换。
      return adoptPlatformIdentity(steamId).then(function (activeId) {
        return (typeof session.getIdentity === "function" ? session.getIdentity() : Promise.resolve(null)).then(function (identity) {
          steamPersonaName = identity && identity.personaName ? String(identity.personaName).trim() : "";
          if (!steamPersonaName) return activeId;
          return upsertPlayerName(steamPersonaName).catch(function () { return null; }).then(function () { return activeId; });
        });
      });
    }).catch(function (error) {
      steamSessionPromise = null;
      throw error;
    });
    return steamSessionPromise;
  }

  function waitForTapTapIdentity(attempt, maxAttempts) {
    var limit = typeof maxAttempts === "number" && maxAttempts > 0 ? maxAttempts : IDENTITY_WAIT_ATTEMPTS;
    var tap = root.tap || (typeof globalThis !== "undefined" && globalThis.tap);
    if (tap && typeof tap.login === "function") return initializeTapTapIdentity(tap);
    if (attempt >= limit) return Promise.reject(new Error("TapTap SDK 未就绪，无法获取玩家身份"));
    return new Promise(function (resolve) { setTimeout(resolve, 200); }).then(function () {
      return waitForTapTapIdentity(attempt + 1, limit);
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
            // 账号级身份就绪：把此前固化的设备身份并入它，而不是丢掉。
            return adoptPlatformIdentity(id).then(function (activeId) { done(resolve, activeId); });
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

  // 联盟成员统计：当日贡献 / 总贡献 / 最后上线 / 是否盟主。
  // 云端与原生共用同一 RPC，保证两侧数据一致。
  function getMemberStats(allianceId) {
    var id = Number(allianceId);
    if (!Number.isSafeInteger(id) || id <= 0) return Promise.reject(new Error("联盟 ID 无效"));
    return authed("/v1/rdb/rest/rpc/get_alliance_member_stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_alliance_id: id })
    }).then(function (rows) {
      return (rows || []).map(function (r) {
        return {
          playerId: r.player_id,
          username: r.username || "",
          isOwner: !!r.is_owner,
          totalPoints: Number(r.total_points) || 0,
          dailyPoints: Number(r.daily_points) || 0,
          lastOnlineAt: r.last_online_at || null
        };
      });
    });
  }

  // 心跳：玩家打开联盟面板时更新最后上线时间（失败不影响主流程）
  function pingOnline() {
    var pid = getPlayerId();
    if (!pid) return Promise.resolve();
    return authed("/v1/rdb/rest/rpc/touch_player_online", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_player_id: pid })
    }).catch(function () { /* 心跳失败静默 */ });
  }

  function createAlliance(value) {
    var check = root.AlliancePolicy.validate(value);
    if (!check.ok) return Promise.reject(new Error(check.reason));
    return getAlliance().then(function (existing) {
      if (existing) throw new Error("你已经建立了一个联盟");
      // ⚠️ 必须带 /v1/rdb/rest 前缀（裸 /rpc/ 会被网关 404）。
      // 建盟走 RPC 而非「先插 alliances 再插成员」两步 REST：两步写法在「已在联盟者再建盟」时
      // 第一步成功、第二步撞 alliance_members.UNIQUE(player_id) 失败 ⇒ 留下 0 成员孤儿联盟。
      return authed("/v1/rdb/rest/rpc/create_alliance_with_owner", {
        method: "POST",
        body: JSON.stringify({ p_code: check.code, p_name: check.code, p_player_id: getPlayerId() })
      });
    }).then(function (rows) {
      var row = rows && rows[0] ? rows[0] : rows;
      if (!row || row.alliance_id == null) return null;
      return mapAlliance({
        id: row.alliance_id,
        code: row.code,
        name: row.name,
        owner_player_id: row.owner_player_id,
        member_count: row.member_count
      });
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
      // ⚠️ 必须带 /v1/rdb/rest 前缀：走裸 /rpc/ 会命中网关照不存在的路由 → HTTP 404，
      //    游戏内「加入联盟」会 100% 失败。本文件其余 11 处调用均带此前缀。
      return authed("/v1/rdb/rest/rpc/join_alliance_with_capacity", {
        method: "POST",
        body: JSON.stringify({ p_alliance_id: Number(allianceId), p_player_id: getPlayerId() })
      });
    }).then(function () {
      return getAlliance();
    });
  }

  // 普通成员主动退出联盟。盟主会收到服务端拒绝（请先转让盟主或解散联盟）——
  // 该规则由 DB 函数 leave_alliance_member 唯一实现，前端不复制判据。
  function leaveAlliance(allianceId) {
    var id = Number(allianceId);
    if (!Number.isSafeInteger(id) || id <= 0) return Promise.reject(new Error("联盟 ID 无效"));
    return authed("/v1/rdb/rest/rpc/leave_alliance_member", {
      method: "POST",
      body: JSON.stringify({ p_alliance_id: id, p_player_id: getPlayerId() })
    }).then(function () { return null; });
  }

  // 解散联盟（仅盟主）。服务端 disband_alliance 会二次校验 owner，前端只做提示。
  function disbandAlliance(allianceId) {
    var id = Number(allianceId);
    if (!Number.isSafeInteger(id) || id <= 0) return Promise.reject(new Error("联盟 ID 无效"));
    return authed("/v1/rdb/rest/rpc/disband_alliance", {
      method: "POST",
      body: JSON.stringify({ p_alliance_id: id, p_owner_player_id: getPlayerId() })
    }).then(function (rows) {
      return (rows && rows[0]) || { disbanded_alliance_id: id, removed_members: 0 };
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

  // 把本机设备身份登记到云端（幂等）。只有登记过密钥的身份才能签发转移码 / 被并入。
  function registerDeviceIdentity() {
    var playerId = getPlayerId();
    if (!isDeviceIdentity(playerId)) return Promise.resolve(true);
    return identityRequest("register", { playerId: playerId, secret: getDeviceSecret() })
      .then(function (result) { return !!result.registered; });
  }

  // 旧设备签发转移码：码绑定「本机身份」（被保留方），拿到码的新设备把自己的身份并进来。
  function createIdentityCode(ttlSeconds) {
    return registerDeviceIdentity().then(function () {
      return identityRequest("create_code", {
        playerId: getPlayerId(),
        secret: getDeviceSecret(),
        ttlSeconds: Number(ttlSeconds) || undefined
      });
    });
  }

  // 新设备兑换转移码：成功后本机身份并入码绑定的保留方，本机 playerId 切换为保留方。
  function redeemIdentityCode(code) {
    return registerDeviceIdentity().then(function () {
      return identityRequest("redeem_code", {
        playerId: getPlayerId(),
        secret: getDeviceSecret(),
        code: String(code || "").trim().toUpperCase()
      });
    }).then(function (result) {
      if (result && result.keeperPlayerId) rememberPlayerId(result.keeperPlayerId);
      return result;
    });
  }

  // 盟主合并成员身份（清理库里的重复设备身份）；权限由服务端与 DB 双重校验。
  function adminMergeIdentity(allianceId, fromPlayerId, toPlayerId) {
    return identityRequest("admin_merge", {
      allianceId: Number(allianceId),
      fromPlayerId: fromPlayerId,
      toPlayerId: toPlayerId
    });
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
    isDeviceIdentity: function () { return isDeviceIdentity(getPlayerId()); },
    getAllianceSessionToken: getAllianceSessionToken,
    initializeSteamIdentity: initializeSteamIdentity,
    retryPlatformIdentity: retryPlatformIdentity,
    getIdentityIssue: getIdentityIssue,
    IDENTITY_WARMUP_ATTEMPTS: IDENTITY_WARMUP_ATTEMPTS,
    registerDeviceIdentity: registerDeviceIdentity,
    createIdentityCode: createIdentityCode,
    redeemIdentityCode: redeemIdentityCode,
    adminMergeIdentity: adminMergeIdentity,
    getAlliance: getAlliance,
    listAlliances: listAlliances,
    getMembers: getMembers,
    getMemberStats: getMemberStats,
    pingOnline: pingOnline,
    createAlliance: createAlliance,
    joinAlliance: joinAlliance,
    leaveAlliance: leaveAlliance,
    disbandAlliance: disbandAlliance,
    diagnose: diagnose
  };
})(typeof window !== "undefined" ? window : globalThis);
