(function (root) {
  "use strict";

  var AUTH_URL = "https://deepspace-d4govx4ikc2e937c5-1477691191.ap-shanghai.app.tcloudbase.com/alliance-auth";
  var TOKEN_KEY = "eve_idle_alliance_session_token";
  var IDENTITY = "deep-space-idle-alliance";

  function bridge() { return root.SteamBridge || null; }
  function getToken() { try { return root.sessionStorage.getItem(TOKEN_KEY) || ""; } catch (_) { return ""; } }
  function saveToken(value) { try { root.sessionStorage.setItem(TOKEN_KEY, value); } catch (_) {} }

  function authenticate() {
    var steam = bridge();
    if (!steam || typeof steam.getAuthTicket !== "function") return Promise.reject(new Error("Steam 身份接口不可用"));
    return Promise.resolve(steam.getAuthTicket(IDENTITY)).then(function (ticket) {
      if (!ticket) throw new Error("无法取得 Steam 认证票据");
      return fetch(AUTH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket: ticket }) });
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok || !body.sessionToken) throw new Error(body && body.error || "联盟身份验证失败");
        saveToken(body.sessionToken);
        return body;
      });
    });
  }

  root.SteamAllianceSession = {
    identity: IDENTITY,
    getToken: getToken,
    authenticate: authenticate,
    clear: function () { try { root.sessionStorage.removeItem(TOKEN_KEY); } catch (_) {} }
  };
})(typeof window !== "undefined" ? window : globalThis);
