// shipfactory2-smoke.mjs — ShipFactory2 全家族生成冒烟测试
//
// 用途：捕获"只对某一种族/舰级触发的运行时错误"。这类 bug 的特征：
//   1) node --check 语法检查抓不到（是 ReferenceError / TypeError，不是语法错）；
//   2) 只对 player_armor 等特定路径触发，其他种族正常 → 浏览器里整船空白却无任何提示；
//   3) 容易在"补回丢失的 helper 函数"时因作用域写错而复现。
//
// 运行（需本地 three，node_modules 已被 .gitignore 忽略）：
//   npm install three            # 首次
//   node shipfactory2-smoke.mjs
//
// 退出码：全部通过 0；任一失败 1。CI / 提交前跑一遍即可锁住回归。
import { buildShip } from "./js/render3d/shipfactory2/ShipFactory2.js";

// 真实种族（见 js/ship-lab.js 的 RACES + CivilizationProfile.js 的 CIVILIZATIONS key）。
// 各自映射不同 hull generator：lathe / box / frame / organic / overloaded / modular。
const FACTIONS = [
  "player_shield", "player_armor", "player_structure",
  "angel", "blood", "sansha",
];
const CLASSES = ["frigate", "destroyer", "cruiser", "battleship"];

let pass = 0, fail = 0;
for (const f of FACTIONS) {
  for (const c of CLASSES) {
    const spec = {
      id: `smoke-${f}-${c}`, anchor: "Spear", race: f, line: f, hull: c,
      seed: 20260719, faction: f, family: f.replace("player_", ""), weapon: "laser",
    };
    try {
      const ship = buildShip(spec);
      let meshes = 0; ship.traverse((o) => { if (o.isMesh) meshes++; });
      if (meshes === 0) throw new Error("生成了空船（0 mesh）");
      // ── 关键回归检查：transform 必须是有限数（NaN 会让浏览器一片黑但 Node 数 mesh 仍通过）──
      ship.updateMatrixWorld(true);
      let nanCount = 0;
      ship.traverse((o) => {
        for (const v of [o.position.x, o.position.y, o.position.z,
                         o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]) {
          if (!Number.isFinite(v)) { nanCount++; break; }
        }
      });
      if (nanCount > 0) throw new Error(`Transform 含 NaN/Infinity（${nanCount} 个对象）— 浏览器里会整船空白`);
      // ── 包围盒必须非零（fitCamera 靠它取景，NaN 包围球会让相机飞到 NaN 坐标）──
      const { Box3, Sphere, Vector3 } = await import("three");
      const box = new Box3().setFromObject(ship);
      if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
        throw new Error("包围盒含 NaN（fitCamera 看不到船）");
      }
      console.log(`OK   ${f.padEnd(16)} / ${c.padEnd(11)} meshes=${meshes}`);
      pass++;
    } catch (e) {
      console.log(`FAIL ${f.padEnd(16)} / ${c.padEnd(11)} :: ${e && e.message ? e.message : e}`);
      fail++;
    }
  }
}
console.log(`\n=== pass=${pass} fail=${fail}（六族战斗）===`);

// ── 功能舰（工业 / 考古）设计语言冒烟 ──
// 不传 anchor（ShipContext 按 faction 选 Industrial / Archaeology 专属锚点）；
// function 区分采矿 / 采气 / 支援挂载；capital 覆盖 orca / illuminator 旗舰。
const UTILITY = [
  { faction: "industrial", fn: "mining",   hull: "frigate" },
  { faction: "industrial", fn: "mining",   hull: "destroyer" },
  { faction: "industrial", fn: "mining",   hull: "cruiser" },
  { faction: "industrial", fn: "mining",   hull: "battleship" },
  { faction: "industrial", fn: "gas",      hull: "frigate" },
  { faction: "industrial", fn: "gas",      hull: "cruiser" },
  { faction: "industrial", fn: "support",  hull: "cruiser" },   // dolphin 工业支援
  { faction: "industrial", fn: "mining",   hull: "capital" },    // orca 工业旗舰
  { faction: "archaeology", hull: "frigate" },                   // heron
  { faction: "archaeology", hull: "destroyer" },                 // tracer
  { faction: "archaeology", hull: "cruiser" },                   // starmap
  { faction: "archaeology", hull: "battleship" },                // farscope
  { faction: "archaeology", hull: "capital" },                   // illuminator 考古旗舰
];
for (const u of UTILITY) {
  const spec = {
    id: `smoke-${u.faction}-${u.fn || "scan"}-${u.hull}`,
    hull: u.hull, faction: u.faction, function: u.fn, seed: 20260719,
  };
  try {
    const ship = buildShip(spec);
    let meshes = 0; ship.traverse((o) => { if (o.isMesh) meshes++; });
    if (meshes === 0) throw new Error("生成了空船（0 mesh）");
    ship.updateMatrixWorld(true);
    let nanCount = 0;
    ship.traverse((o) => {
      for (const v of [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]) {
        if (!Number.isFinite(v)) { nanCount++; break; }
      }
    });
    if (nanCount > 0) throw new Error(`Transform 含 NaN/Infinity（${nanCount} 个对象）`);
    const { Box3 } = await import("three");
    const box = new Box3().setFromObject(ship);
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) throw new Error("包围盒含 NaN");
    console.log(`OK   ${u.faction.padEnd(12)} / ${u.fn || "scan"} / ${u.hull.padEnd(11)} meshes=${meshes}`);
    pass++;
  } catch (e) {
    console.log(`FAIL ${u.faction.padEnd(12)} / ${u.fn || "scan"} / ${u.hull.padEnd(11)} :: ${e && e.message ? e.message : e}`);
    fail++;
  }
}

console.log(`\n=== pass=${pass} fail=${fail}（合计）===`);
process.exit(fail === 0 ? 0 : 1);
