/*
 * 3D 舰船模块加载兜底。
 * 主页面脚本很多且包含大量 defer 脚本；这里用普通 defer 脚本启动动态模块，
 * 确保 Ship3D 完成注册后再通知等待中的采集/战斗 UI。
 */
(function () {
  "use strict";

  function loadShip3D() {
    if (window.Ship3D) return;
    import("./ship3d.js?v=10").catch(function (error) {
      console.error("[ship3d] module load failed", error);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadShip3D, { once: true });
  } else {
    loadShip3D();
  }
})();
