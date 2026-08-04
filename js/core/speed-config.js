// 单一速度源（十倍速开关）
// 默认 1（实时）。切换方式（按顺序生效，前者优先）：
//   1) URL 参数 ?speed=10
//   2) localStorage('eve_speed') = "10"
//   3) 兼容旧 window.TEST_ACTIVE_SPEED = 10
// 仅影响「产出 / 进度积累」速度；冷却 / 到期保持实时（用户拍板 2026-08-04）。
// 同时挂到 globalThis，使 Node 测试环境与浏览器一致可用。
(function () {
  "use strict";
  var speed = 1;
  try {
    var urlSpeed = NaN, storeSpeed = NaN, legacy = NaN;
    if (typeof location !== "undefined" && location && typeof location.search === "string") {
      var params = new URLSearchParams(location.search);
      urlSpeed = Number(params.get("speed"));
    }
    if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.getItem === "function") {
      storeSpeed = Number(localStorage.getItem("eve_speed"));
    }
    if (typeof window !== "undefined" && window && Number(window.TEST_ACTIVE_SPEED) > 0) {
      legacy = Number(window.TEST_ACTIVE_SPEED);
    }
    if (Number.isFinite(urlSpeed) && urlSpeed > 0) speed = urlSpeed;
    else if (Number.isFinite(storeSpeed) && storeSpeed > 0) speed = storeSpeed;
    else if (Number.isFinite(legacy) && legacy > 0) speed = legacy;
  } catch (e) {
    speed = 1;
  }
  if (!(Number.isFinite(speed) && speed > 0)) speed = 1;

  var G = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : {});
  G.GAME_SPEED = speed;
  G.getGameSpeed = function () {
    var s = (typeof G.GAME_SPEED === "number" && G.GAME_SPEED > 0) ? G.GAME_SPEED : 1;
    return s;
  };
  // 累积型 delta（秒）→ 游戏内秒；冷却 / 到期不套用此函数（保持实时）。
  G.gameDeltaSec = function (realSec) {
    var s = (typeof G.getGameSpeed === "function") ? G.getGameSpeed() : 1;
    return (typeof realSec === "number" && Number.isFinite(realSec)) ? realSec * s : 0;
  };
  // 统一时钟入口（当前透传 Date.now；预留给未来整体 game-clock）。
  G.gameNow = function () { return (typeof Date !== "undefined" && Date.now) ? Date.now() : 0; };
})();
