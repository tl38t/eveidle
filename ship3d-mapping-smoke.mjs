// ship3d-mapping-smoke.mjs — 主界面 3D 实装映射冒烟测试
//
// 用途：验证 js/ui/ship3d.js 的 buildSpecForShip / buildEnemySpec 对
//   「游戏真实全部舰船」产出的 spec 都能被 ShipFactory2.buildShip 成功构建，
//   且无空船 / 无 NaN transform / 包围盒有限。这是把 3D 建模实装进
//   战斗 / 船坞 / 制造三界面后的端到端映射防回归。
//
// 关键：测的是「真代码」——通过 vm 加载真实 js/data/ships.js 得到 SHIP_DATA，
//   再 stub global.window 后动态 import ship3d.js 的真实 buildSpecForShip，
//   不重写映射逻辑，避免与生产代码漂移。
//
// 运行：node ship3d-mapping-smoke.mjs   （需本地 node_modules/three）
// 退出码：全通过 0；任一失败 1。

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Box3 } from "three";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── 1. 用 vm 沙箱加载真实 ships.js，提取 window.SHIP_DATA ── */
function loadShipData() {
  const src = readFileSync(path.join(__dirname, "js/data/ships.js"), "utf8");
  const fakeWindow = {};
  const sandbox = { window: fakeWindow, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "ships.js" });
  if (!fakeWindow.SHIP_DATA) throw new Error("ships.js 未暴露 window.SHIP_DATA");
  return fakeWindow.SHIP_DATA;
}

const SHIP_DATA = loadShipData();

/* ── 2. stub 全局 window，供 ship3d.js 的 getShipData() 读取 ── */
globalThis.window = { SHIP_DATA, devicePixelRatio: 1 };

/* ── 3. 动态 import 生产映射函数（真代码，无重写）── */
const { buildSpecForShip, buildEnemySpec } = await import("./js/ui/ship3d.js");
const { buildShip } = await import("./js/render3d/shipfactory2/ShipFactory2.js");

/* ── 4. 通用校验：buildShip 后须非空、无 NaN、包围盒有限 ── */
function verify(spec, label) {
  const ship = buildShip(spec);
  let meshes = 0;
  ship.traverse((o) => { if (o.isMesh) meshes++; });
  if (meshes === 0) throw new Error("空船（0 mesh）");
  ship.updateMatrixWorld(true);
  let nan = 0;
  ship.traverse((o) => {
    for (const v of [o.position.x, o.position.y, o.position.z,
                     o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]) {
      if (!Number.isFinite(v)) { nan++; break; }
    }
  });
  if (nan > 0) throw new Error(`Transform 含 NaN（${nan} 个对象）`);
  const box = new Box3().setFromObject(ship);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) throw new Error("包围盒含 NaN");
  return meshes;
}

let pass = 0, fail = 0;

function runShip(shipId, category) {
  const spec = buildSpecForShip(shipId);
  try {
    const meshes = verify(spec, shipId);
    console.log(`OK   ${category.padEnd(11)} ${shipId.padEnd(22)} → ${spec.faction.padEnd(16)}/${String(spec.hull).padEnd(12)} meshes=${meshes}`);
    pass++;
  } catch (e) {
    console.log(`FAIL ${category.padEnd(11)} ${shipId.padEnd(22)} spec=${JSON.stringify(spec)} :: ${e.message || e}`);
    fail++;
  }
}

/* ── 5. 遍历真实全部舰船 ── */
console.log("=== 战斗舰 STARTER_SHIPS ===");
for (const id of Object.keys(SHIP_DATA.STARTER_SHIPS)) runShip(id, "combat");
console.log("\n=== 工业舰 INDUSTRIAL_SHIPS ===");
for (const id of Object.keys(SHIP_DATA.INDUSTRIAL_SHIPS)) runShip(id, "industrial");
console.log("\n=== 考古舰 ARCHAEOLOGY_SHIPS ===");
for (const id of Object.keys(SHIP_DATA.ARCHAEOLOGY_SHIPS)) runShip(id, "archaeology");

/* ── 6. 战斗敌人 spec（三海盗族 × 各威胁档，含 supercapital）── */
console.log("\n=== 战斗敌人 buildEnemySpec ===");
const zones = ["angel", "blood", "sansha"];
const levels = [1, 10, 20, 35, 50, 70, 90];
for (const z of zones) {
  for (const lv of levels) {
    const spec = buildEnemySpec(z, lv);
    try {
      const meshes = verify(spec, spec.id);
      console.log(`OK   enemy ${z.padEnd(7)} lv${String(lv).padEnd(3)} → ${spec.hull.padEnd(12)} meshes=${meshes}`);
      pass++;
    } catch (e) {
      console.log(`FAIL enemy ${z} lv${lv} spec=${JSON.stringify(spec)} :: ${e.message || e}`);
      fail++;
    }
  }
}

/* ── 7. 未知 id fallback 路径 ── */
console.log("\n=== fallback（未知 id）===");
runShip("__nonexistent_ship__", "fallback");

console.log(`\n=== pass=${pass} fail=${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
