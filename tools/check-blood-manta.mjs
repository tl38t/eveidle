// tools/check-blood-manta.mjs — 校验 blood 鳐鱼船体：表面细节是否贴住曲面（不浮空）
// 方法：复刻 OverloadedHull.buildManta 的 W(z)/H(z) 椭圆截面公式，
//   对每个表面 Generator（panels/grooves/ribbon/vents/heatsinks）的网格质心，
//   计算径向比 radial = sqrt((cx/W(z))^2 + (cy/H(z))^2)。
//   贴附 → radial ≈ 1.0~1.2；浮空（如旧 vent 按圆形半径算，落在薄身之上）→ radial 远大于 1。
import * as THREE from "three";
import { buildShip } from "../js/render3d/shipfactory2/ShipFactory2.js";

const spec = { id: "check-blood", anchor: "Spear", race: "blood", line: "blood", hull: "battleship", seed: 20260719, faction: "blood", family: "armor", weapon: "missile" };
const ship = buildShip(spec);

let maxAbsX = 0, maxAbsZ = 0;
const v = new THREE.Vector3();
ship.traverse((o) => {
  if (!o.isMesh) return;
  let g = o.parent, inHull = false;
  while (g) { if (g.name === "hull") { inHull = true; break; } g = g.parent; }
  if (!inHull) return;
  const pos = o.geometry.getAttribute("position");
  if (!pos) return;
  o.updateWorldMatrix(true, false);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); o.localToWorld(v);
    maxAbsX = Math.max(maxAbsX, Math.abs(v.x));
    maxAbsZ = Math.max(maxAbsZ, Math.abs(v.z));
  }
});

// maxAbsX = 翼尖 = Wmax（尾刺/头鳍在 x≈0，不影响）；maxAbsZ = 尾刺末端 ≈ 0.56L
const R = maxAbsX / 3.2;
const L = maxAbsZ / 0.56;
const Wmax = R * 3.2;
const Hmax = R * 0.66;
const zN = -0.46 * L, zT = 0.46 * L;
const tp = 0.30, td = 0.60;

const Wof = (z) => {
  const t = (z - zN) / (zT - zN);
  let w;
  if (t <= tp) w = 0.06 + 0.94 * Math.pow(t / tp, 0.78);
  else if (t <= td) { const u = (t - tp) / (td - tp); w = 1.0 - 0.82 * Math.pow(u, 0.92); }
  else { const u = (t - td) / (1 - td); w = 0.18 * (1 - u) + 0.03; }
  return Wmax * Math.max(0.03, w);
};
const Hof = (z) => {
  const t = (z - zN) / (zT - zN);
  const body = Math.exp(-Math.pow((t - 0.28) / 0.42, 2));
  return Hmax * (0.12 + 0.88 * body);
};

const CATS = new Set(["panels", "grooves", "ribbon", "ribbons", "vents", "heatsinks", "hatches"]);
const stats = {};
const c = new THREE.Vector3();
ship.traverse((o) => {
  if (!o.isMesh) return;
  let g = o.parent, cat = null;
  while (g) { if (CATS.has(g.name)) { cat = g.name; break; } g = g.parent; }
  if (!cat) return;
  o.updateWorldMatrix(true, false);
  o.geometry.computeBoundingBox();
  o.geometry.boundingBox.getCenter(c); o.localToWorld(c);
  const z = Math.max(zN, Math.min(zT, c.z));
  const W = Wof(z), H = Hof(z);
  const radial = Math.sqrt((c.x / W) * (c.x / W) + (c.y / H) * (c.y / H));
  if (!stats[cat]) stats[cat] = { n: 0, max: 0, sum: 0 };
  stats[cat].n++; stats[cat].max = Math.max(stats[cat].max, radial); stats[cat].sum += radial;
});

console.log(`R=${R.toFixed(3)} L=${L.toFixed(3)} Wmax=${Wmax.toFixed(3)} Hmax=${Hmax.toFixed(3)}`);
console.log("category        n    maxRadial  avgRadial   verdict");
for (const cat of Object.keys(stats)) {
  const s = stats[cat];
  const avg = s.sum / s.n;
  const ok = s.max < 1.35;
  console.log(`${cat.padEnd(14)} ${String(s.n).padStart(4)} ${s.max.toFixed(2).padStart(9)} ${avg.toFixed(2).padStart(10)}   ${ok ? "ATTACHED" : "FLOATING?"}`);
}
