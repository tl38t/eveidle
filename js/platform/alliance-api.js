(function (root) {
  "use strict";
  var key = "eve_idle_alliance_mock", playerKey = "eve_idle_alliance_player_id";
  function id() { var v = localStorage.getItem(playerKey); if (!v) { v = "local_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); localStorage.setItem(playerKey, v); } return v; }
  function read() { try { return JSON.parse(localStorage.getItem(key) || "null") || { playerId:id(), alliance:null, alliances:[] }; } catch (_) { return { playerId:id(), alliance:null, alliances:[] }; } }
  function write(v) { v.playerId = id(); localStorage.setItem(key, JSON.stringify(v)); return v; }
  root.AllianceApi = {
    isOnline: function () { return false; }, getPlayerId: id,
    getAlliance: function () { return Promise.resolve(read().alliance); },
    listAlliances: function () { return Promise.resolve(read().alliances); },
    createAlliance: function (name) { var check = AlliancePolicy.validate(name); if (!check.ok) return Promise.reject(new Error(check.reason)); var s = read(); if (s.alliance) return Promise.reject(new Error("你已经加入一个联盟")); var a = { id:"mock_" + Date.now().toString(36), name:check.code, ownerId:id(), memberCount:1, createdAt:Date.now() }; s.alliance = a; s.alliances.push(a); write(s); return Promise.resolve(a); }
  };
})(typeof window !== "undefined" ? window : globalThis);
