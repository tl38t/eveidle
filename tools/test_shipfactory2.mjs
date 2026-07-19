import { buildShip, COLORS, HULL_PRESETS } from "../js/render3d/shipfactory2/ShipFactory2.js";
import * as THREE from "three";

const specs = [
  { id: "rifter",    line: "player_shield", family: "shield", hull: "frigate",    weapon: "laser", highSlots: 2 },
  { id: "raylight",  line: "player_shield", family: "shield", hull: "destroyer",  weapon: "laser", highSlots: 3 },
  { id: "gale",      line: "player_shield", family: "shield", hull: "destroyer",  weapon: "laser", hybrid: true, highSlots: 3 },
  { id: "dawnlight", line: "player_shield", family: "shield", hull: "cruiser",    weapon: "laser", highSlots: 4 },
  { id: "sunlance",  line: "player_shield", family: "shield", hull: "battleship", weapon: "laser", highSlots: 5 }
];

// 几何指纹：遍历整艘船，统计网格数/顶点数/位置总和/包围盒。
// 若某次提交后指纹变化 => 几何被改 => 视觉变化（本阶段每个 commit 必须不变）。
function fingerprint(ship) {
  let posSum = 0, verts = 0, meshes = 0;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  ship.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      meshes++;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        posSum += x + y + z;
        verts++;
        if (x < min.x) min.x = x; if (y < min.y) min.y = y; if (z < min.z) min.z = z;
        if (x > max.x) max.x = x; if (y > max.y) max.y = y; if (z > max.z) max.z = z;
      }
    }
  });
  return {
    meshes,
    verts,
    posSum: +posSum.toFixed(4),
    bbox: [min.x, min.y, min.z, max.x, max.y, max.z].map((v) => +v.toFixed(3))
  };
}

const fp = {};
let total = 0;
for (const spec of specs) {
  try {
    const ship = buildShip(spec);
    const n = ship.children.length;
    total += n;
    const f = fingerprint(ship);
    fp[spec.id] = f;
    console.log(
      `OK   ${spec.id.padEnd(10)} children=${n} meshes=${f.meshes} verts=${f.verts} ` +
      `posSum=${f.posSum} bbox=${f.bbox.join(",")} floaters=${ship.userData.floaters?.length || 0} shield=${!!ship.userData.shield}`
    );
  } catch (e) {
    console.log(`FAIL ${spec.id}: ${e.message}`);
    console.log(e.stack.split("\n").slice(0, 5).join("\n"));
  }
}
console.log("TOTAL children =", total);
console.log("FINGERPRINT_JSON=" + JSON.stringify(fp));
