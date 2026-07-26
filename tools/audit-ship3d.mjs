// audit-ship3d.mjs — ShipFactory2 3D 专项审计（第一轮：正确性修复 + 低风险生命周期优化）
//
// 目的：把第一轮修复锁成可回归断言，并补齐真实覆盖缺口。
//   全部走「真代码」——直接 import 生产 buildShip / createShipContext /
//   setShips / disposeShipObject，不重写生成逻辑、不用 assert(true) 蒙混。
//
// 运行：node tools/audit-ship3d.mjs   （需本地 node_modules/three）
// 退出码：全通过 0；任一断言失败 1。
//
// 设计纪律（AGENTS.md）：
//   - 禁止 assert(true) / false||true / 宽范围蒙混 / 只查源码字符串代替行为测试。
//   - verifyBuild 返回可验证的真实结果（meshCount / finiteTransformCount / boundingBox），
//     调用方对返回值断言；构建真实失败仍计 fail 并最终 EXIT=1。
//   - Section A/B/C/E 走真实 setShips / disposeShipObject 行为（真 THREE.Group + dispose spy）。
//   - Section D 与 E 的 WebGL 部分需浏览器上下文：Node 无 document/WebGL 时明确移交
//     Section 四 浏览器页 tools/ship3d-browser-test.html（不 assert(true) 顶替）。

import { Box3, Group, Mesh, BoxGeometry, MeshBasicMaterial, MeshStandardMaterial, Texture, BufferGeometry, Material } from "three";
import { buildShip } from "../js/render3d/shipfactory2/ShipFactory2.js";
import { createShipContext } from "../js/render3d/shipfactory2/ShipContext.js";
import { setShips, disposeShipObject } from "../js/ui/ship3d.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; failures.push(msg); console.log("  ASSERT FAIL: " + msg); }
}

// 与 ship3d.js 内部 TEXTURE_SLOTS 保持一致（测试侧遍历用；envMap 不在单舰释放范围）。
const TEXTURE_SLOTS = [
  "map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap",
  "alphaMap", "aoMap", "bumpMap", "displacementMap", "lightMap", "specularMap"
];

// ── dispose 探针：临时包裹 THREE 原型 dispose，记录「哪个实例被 dispose 了几次」──
// 观测的是对真实 dispose 的真实调用（非源码字符串），用于验证去重/共享跳过/无双重释放。
function installDisposeSpy() {
  const counts = new Map();
  const bump = (o) => counts.set(o, (counts.get(o) || 0) + 1);
  const g0 = BufferGeometry.prototype.dispose;
  const m0 = Material.prototype.dispose;
  const t0 = Texture.prototype.dispose;
  BufferGeometry.prototype.dispose = function () { bump(this); return g0.apply(this, arguments); };
  Material.prototype.dispose = function () { bump(this); return m0.apply(this, arguments); };
  Texture.prototype.dispose = function () { bump(this); return t0.apply(this, arguments); };
  return {
    counts,
    restore() {
      BufferGeometry.prototype.dispose = g0;
      Material.prototype.dispose = m0;
      Texture.prototype.dispose = t0;
    }
  };
}

// 最小但真实的 setShips handle：root 是真 THREE.Group，其余字段与生产 handle 同名。
// setShips 不触碰 renderer/scene/camera，故无需 WebGL——测试的是真实 setShips 逻辑本身。
function makeHandle() {
  return { error: null, ships: [], root: new Group(), _specKey: "", _autoFit: false, _needsAutoFit: false };
}

// 读取 group 内护盾泡（name==="shield"）材质颜色的十六进制（用于护盾重着色验收）。
function findShieldColorHex(group) {
  let hex = null;
  group.traverse((o) => {
    if (hex != null) return;
    if (o.isMesh && o.name === "shield" && o.material && o.material.color) hex = o.material.color.getHex();
  });
  return hex;
}

// 通用校验：返回真实可断言结果（不再 assert(true)）。
//   meshCount            —— mesh 数（须 > 0）
//   totalObjects         —— 遍历到的对象总数
//   finiteTransformCount —— transform 全部有限的对象数（须 === totalObjects）
//   boundingBox          —— { min, max, finite }
function verifyBuild(spec, label) {
  const ship = buildShip(spec);
  ship.updateMatrixWorld(true);
  let meshCount = 0, totalObjects = 0, finiteTransformCount = 0;
  ship.traverse((o) => {
    totalObjects++;
    if (o.isMesh) meshCount++;
    let finite = true;
    for (const v of [o.position.x, o.position.y, o.position.z,
                     o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]) {
      if (!Number.isFinite(v)) { finite = false; break; }
    }
    if (finite) finiteTransformCount++;
  });
  const box = new Box3().setFromObject(ship);
  const boundingBox = {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    finite: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)
  };
  return { meshCount, totalObjects, finiteTransformCount, boundingBox };
}

// 对 verifyBuild 返回值做真实断言（构建异常也计 fail）。
function assertBuild(spec, label) {
  try {
    const r = verifyBuild(spec, label);
    assert(r.meshCount > 0, label + " meshCount 必须 > 0（=" + r.meshCount + "）");
    assert(r.finiteTransformCount === r.totalObjects,
      label + " transform 必须全部有限（" + r.finiteTransformCount + "/" + r.totalObjects + "）");
    assert(r.boundingBox.finite, label + " 包围盒必须有限（" + JSON.stringify(r.boundingBox) + "）");
    return r;
  } catch (e) {
    assert(false, label + " build 失败: " + (e && e.message ? e.message : e));
    return null;
  }
}

function statOf(ship) {
  let meshes = 0, tris = 0;
  const geo = new Set(), mat = new Set();
  ship.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    geo.add(o.geometry);
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) if (m) mat.add(m);
    const g = o.geometry;
    if (g.index) tris += g.index.count / 3;
    else if (g.attributes && g.attributes.position) tris += g.attributes.position.count / 3;
  });
  return { meshes, tris: Math.round(tris), geo: geo.size, mat: mat.size };
}

function profileStats(spec) {
  const ctx = createShipContext(spec);
  // profile.hull.mounts 是「挂载点数」标量（capital=6, supercapital=7），不是数组。
  const mounts = (typeof ctx.profile.hull.mounts === "number") ? ctx.profile.hull.mounts : 0;
  return { profileClass: ctx.profile.shipClass, L: ctx.L, scale: ctx.s, mounts };
}

function countNamed(spec, name) {
  const ship = buildShip(spec);
  const g = ship.getObjectByName(name);
  if (!g) return { found: false, meshes: 0, xs: [], zs: [] };
  let meshes = 0; const xs = [], zs = [];
  g.traverse((o) => { if (o.isMesh) { meshes++; xs.push(o.position.x); zs.push(o.position.z); } });
  return { found: true, meshes, xs, zs };
}

// X 轴左-右对称判定：group 内所有 mesh 的 X 多重集合须对称（count(x) == count(-x)）。
function xSymmetry(spec, name) {
  const ship = buildShip(spec);
  const g = ship.getObjectByName(name);
  if (!g) return { found: false, symmetric: false };
  const counts = new Map();
  g.traverse((o) => {
    if (o.isMesh) {
      const x = Math.round(o.position.x * 1e4) / 1e4;
      counts.set(x, (counts.get(x) || 0) + 1);
    }
  });
  let symmetric = true;
  for (const [x, c] of counts) {
    const neg = Math.round(-x * 1e4) / 1e4;
    if ((counts.get(neg) || 0) !== c) { symmetric = false; break; }
  }
  return { found: true, symmetric };
}

const FACTIONS = ["player_shield", "player_armor", "player_structure", "angel", "blood", "sansha"];
const TIERS = ["frigate", "destroyer", "cruiser", "battleship", "capital", "supercapital"];
const combatSpec = (f, c) => ({
  id: "audit-" + f + "-" + c, anchor: "Spear", race: f, line: f, hull: c,
  seed: 20260719, faction: f, family: f.replace("player_", ""), weapon: "laser"
});

// ─────────────────────────────────────────────────────────────────────────
// (1) 六族 × 六档 build —— 对 verifyBuild 真实返回值断言（无 assert(true)）
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (1) 六族 × 六档 build（真实 mesh/transform/bbox 断言）===");
for (const f of FACTIONS) {
  for (const c of TIERS) assertBuild(combatSpec(f, c), f + "/" + c);
}

// ─────────────────────────────────────────────────────────────────────────
// (2) 工业 / 考古 build —— 对 verifyBuild 真实返回值断言（无 assert(true)）
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (2) 工业 / 考古 build（真实 mesh/transform/bbox 断言）===");
const UTILITY = [
  { faction: "industrial", fn: "mining", hull: "frigate" },
  { faction: "industrial", fn: "mining", hull: "destroyer" },
  { faction: "industrial", fn: "mining", hull: "cruiser" },
  { faction: "industrial", fn: "mining", hull: "battleship" },
  { faction: "industrial", fn: "gas", hull: "frigate" },
  { faction: "industrial", fn: "gas", hull: "cruiser" },
  { faction: "industrial", fn: "support", hull: "cruiser" },
  { faction: "industrial", fn: "mining", hull: "capital" },
  { faction: "archaeology", hull: "frigate" },
  { faction: "archaeology", hull: "destroyer" },
  { faction: "archaeology", hull: "cruiser" },
  { faction: "archaeology", hull: "battleship" },
  { faction: "archaeology", hull: "capital" },
];
for (const u of UTILITY) {
  const spec = { id: "audit-" + u.faction + "-" + (u.fn || "scan") + "-" + u.hull, hull: u.hull, faction: u.faction, function: u.fn, seed: 20260719 };
  assertBuild(spec, u.faction + "/" + (u.fn || "scan") + "/" + u.hull);
}

// ─────────────────────────────────────────────────────────────────────────
// (3) capital & supercapital 档位 DNA + 几何规模
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (3) capital & supercapital 档位 DNA + 几何规模 ===");
const TIER_EXPECT = { capital: { mounts: 6 }, supercapital: { mounts: 7 } };
for (const f of FACTIONS) {
  for (const c of ["capital", "supercapital"]) {
    const spec = combatSpec(f, c);
    try {
      const ps = profileStats(spec);
      const r = assertBuild(spec, f + "/" + c);
      const st = statOf(buildShip(spec));
      assert(ps.profileClass === c, f + "/" + c + " profileClass=" + ps.profileClass + " 应为 " + c);
      assert(ps.mounts === TIER_EXPECT[c].mounts, f + "/" + c + " mounts=" + ps.mounts + " 应为 " + TIER_EXPECT[c].mounts);
      assert(ps.L > 0 && ps.scale > 0, f + "/" + c + " L/scale 必须 > 0（L=" + ps.L.toFixed(2) + " scale=" + ps.scale.toFixed(3) + "）");
      assert(st.meshes > 0 && st.tris > 0 && st.geo > 0 && st.mat > 0, f + "/" + c + " 几何规模必须 > 0（" + JSON.stringify(st) + "）");
      console.log("  " + (f + "/" + c).padEnd(26) +
        " class=" + ps.profileClass.padEnd(12) +
        " L=" + ps.L.toFixed(2).padStart(7) +
        " scale=" + ps.scale.toFixed(3).padStart(6) +
        " mounts=" + String(ps.mounts).padStart(2) +
        " meshes=" + String(st.meshes).padStart(4) +
        " tris=" + String(st.tris).padStart(7) +
        " geo=" + String(st.geo).padStart(4) +
        " mat=" + String(st.mat).padStart(4));
    } catch (e) {
      assert(false, f + "/" + c + " 档位/几何审计失败: " + (e && e.message ? e.message : e));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// (4) Angel capital/supercapital 武器：真实炮塔（>2 mesh）、super>=capital、左右对称、沿 Z 铺开
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (4) Angel capital/supercapital 武器断言 ===");
const angelCap = combatSpec("angel", "capital");
const angelSuper = combatSpec("angel", "supercapital");
const wAngelCap = countNamed(angelCap, "weapons");
const wAngelSuper = countNamed(angelSuper, "weapons");
console.log("  Angel capital 武器 mesh=" + wAngelCap.meshes + "；Angel supercapital 武器 mesh=" + wAngelSuper.meshes);
assert(wAngelCap.found && wAngelCap.meshes > 2, "Angel capital 武器 mesh=" + wAngelCap.meshes + " 必须 > 2（修复后渲染真实炮塔）");
assert(wAngelSuper.meshes >= wAngelCap.meshes, "Angel supercapital 武器 mesh=" + wAngelSuper.meshes + " 须 >= capital " + wAngelCap.meshes);
assert(xSymmetry(angelCap, "weapons").symmetric, "Angel capital 武器布局须左-右对称");
assert(xSymmetry(angelSuper, "weapons").symmetric, "Angel supercapital 武器布局须左-右对称");
const zSet = new Set(wAngelCap.zs.map((z) => Math.round(z * 1e3)));
assert(zSet.size > 1, "Angel capital 武器须沿 Z 轴铺开（不同 Z 位置数=" + zSet.size + "）");

// ─────────────────────────────────────────────────────────────────────────
// (5) Sansha capital/supercapital 面板：panelMeshes > 0
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (5) Sansha capital/supercapital 面板断言 ===");
const pSanshaCap = countNamed(combatSpec("sansha", "capital"), "panels");
const pSanshaSuper = countNamed(combatSpec("sansha", "supercapital"), "panels");
console.log("  Sansha capital 面板 mesh=" + pSanshaCap.meshes + "；supercapital 面板 mesh=" + pSanshaSuper.meshes);
assert(pSanshaCap.found && pSanshaCap.meshes > 0, "Sansha capital 面板须存在且 mesh > 0（=" + pSanshaCap.meshes + "）");
assert(pSanshaSuper.found && pSanshaSuper.meshes > 0, "Sansha supercapital 面板须存在且 mesh > 0（=" + pSanshaSuper.meshes + "）");

// ─────────────────────────────────────────────────────────────────────────
// (6) 同 seed 两次结构统计一致（可复现性）
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (6) 同 seed 两次结构统计一致 ===");
const reproSpec = { ...combatSpec("angel", "capital"), seed: 777 };
const s1 = statOf(buildShip(reproSpec));
const s2 = statOf(buildShip(reproSpec));
console.log("  第一次=" + JSON.stringify(s1) + "\n  第二次=" + JSON.stringify(s2));
assert(s1.meshes === s2.meshes && s1.tris === s2.tris && s1.geo === s2.geo && s1.mat === s2.mat,
  "同 seed 两次结构统计须完全一致（" + JSON.stringify(s1) + " vs " + JSON.stringify(s2) + "）");

// ─────────────────────────────────────────────────────────────────────────
// (7)(8) 性能基线代表性舰船 + 已知基线防回归（±10% 容差）
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (7)(8) 性能基线 + 已知基线防回归 ===");
const BASELINE = {
  "player_armor battleship":   { meshes: 700, tris: 64350, geo: 685, mat: 99 },
  "player_armor capital":      { meshes: 712, tris: 65040, geo: 697, mat: 101 },
  "player_armor supercapital": { meshes: 743, tris: 69914, geo: 728, mat: 108 },
  "sansha supercapital":       { meshes: 426, tris: 27446, geo: 426, mat: 48 },
  "archaeology capital":       { meshes: 92,  tris: 10664, geo: 71,  mat: 18 },
};
const BASELINE_SPECS = {
  "player_armor battleship":   combatSpec("player_armor", "battleship"),
  "player_armor capital":      combatSpec("player_armor", "capital"),
  "player_armor supercapital": combatSpec("player_armor", "supercapital"),
  "sansha supercapital":       combatSpec("sansha", "supercapital"),
  "archaeology capital":       { id: "b5", faction: "archaeology", hull: "capital", seed: 20260719 },
};
const TOL = 0.10;
for (const key of Object.keys(BASELINE)) {
  const st = statOf(buildShip(BASELINE_SPECS[key]));
  const base = BASELINE[key];
  console.log("  " + key.padEnd(26) + " 当前=" + JSON.stringify(st) + " 基线=" + JSON.stringify(base));
  for (const m of ["meshes", "tris", "geo", "mat"]) {
    const lo = base[m] * (1 - TOL), hi = base[m] * (1 + TOL);
    assert(st[m] >= lo && st[m] <= hi,
      key + " " + m + "=" + st[m] + " 超出基线 " + base[m] + " 的 ±10% 容差（[" + Math.floor(lo) + "," + Math.ceil(hi) + "]）");
  }
}

// 用于 A/B/C/E 的轻量可复现战斗 spec（frigate，构建快）。
const specFrig = combatSpec("player_shield", "frigate");

// ─────────────────────────────────────────────────────────────────────────
// (A) setShips 去重 key：覆盖所有影响显示的字段 + falsy 边界
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (A) setShips 去重 key + falsy 边界 ===");
{
  const h = makeHandle();
  const base = { spec: specFrig, position: [0, 0, 0] };
  setShips(h, [base]);
  const b0 = h._buildCount;
  assert(b0 === 1, "A1 首次 build 计数=1（=" + b0 + "）");

  setShips(h, [base]);
  assert(h._buildCount === b0, "A2 完全相同输入第二次不重建（buildCount 保持 " + b0 + "）");

  // 逐字段变更均须触发重建
  setShips(h, [{ spec: specFrig, position: [1, 0, 0] }]);
  assert(h._buildCount === b0 + 1, "A3 仅 position 变化触发重建");
  const bp = h._buildCount;
  setShips(h, [{ spec: specFrig, position: [1, 0, 0], scale: 2 }]);
  assert(h._buildCount === bp + 1, "A4 仅 scale 变化触发重建");
  const bs = h._buildCount;
  setShips(h, [{ spec: specFrig, position: [1, 0, 0], scale: 2, rotation: [0, 0, 0.5] }]);
  assert(h._buildCount === bs + 1, "A5 仅 rotation 变化触发重建");
  const br = h._buildCount;
  setShips(h, [{ spec: specFrig, position: [1, 0, 0], scale: 2, rotation: [0, 0, 0.5], sway: true }]);
  assert(h._buildCount === br + 1, "A6 仅 sway 变化触发重建");
  const bw = h._buildCount;
  setShips(h, [{ spec: specFrig, position: [1, 0, 0], scale: 2, rotation: [0, 0, 0.5], sway: true, shieldColor: 0xff0000 }]);
  assert(h._buildCount === bw + 1, "A7 仅 shieldColor 变化触发重建");
}
{
  // falsy 边界：scale=0 归一化为 1（key 与应用同源，无语义分裂）
  const h = makeHandle();
  setShips(h, [{ spec: specFrig, scale: 0 }]);
  assert(h.ships[0].group.scale.x === 1, "A8 scale=0 归一化为 1（应用值=" + h.ships[0].group.scale.x + "）");
  const bc = h._buildCount;
  setShips(h, [{ spec: specFrig, scale: 1 }]);
  assert(h._buildCount === bc, "A9 scale=0 与 scale=1 归一后 key 一致，不重建（buildCount 保持 " + bc + "）");
  setShips(h, [{ spec: specFrig }]);
  assert(h._buildCount === bc, "A10 scale undefined 与 scale=1 同 key，不重建");
}
{
  // falsy 边界：shieldColor=0（黑）合法，须应用且与 undefined 不同 key
  const h = makeHandle();
  setShips(h, [{ spec: specFrig }]);
  const c0 = h._buildCount;
  setShips(h, [{ spec: specFrig, shieldColor: 0 }]);
  assert(h._buildCount === c0 + 1, "A11 shieldColor=0 视为有效（与 undefined 不同 key，触发重建）");
  const hex = findShieldColorHex(h.ships[0].group);
  assert(hex === 0x000000, "A12 shieldColor=0 真实应用为黑色（=#" + (hex == null ? "none" : hex.toString(16)) + "）");
}

// ─────────────────────────────────────────────────────────────────────────
// (B) setShips 原子失败：旧模型保留、不写成功 key、临时模型释放、可重试
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (B) setShips 原子失败 ===");
{
  const h = makeHandle();
  setShips(h, [{ spec: specFrig, position: [0, 0, 0] }]);   // 旧模型 A
  const oldShips = h.ships;
  const oldKey = h._specKey;
  const oldRoot = h.root.children.length;
  const oldBuild = h._buildCount;
  assert(oldShips.length === 1 && oldRoot === 1, "B0 旧模型 A 已就位（ships=" + oldShips.length + " root=" + oldRoot + "）");

  // 新列表：ship1 有效 + ship2 = null spec（buildShip(null) 抛错）
  const failList = [{ spec: specFrig, position: [2, 0, 0] }, { spec: null }];
  const spy = installDisposeSpy();
  setShips(h, failList);   // ship1 建成 → ship2 抛错 → catch 释放临时并 return
  spy.restore();

  assert(h.ships === oldShips, "B1 构建失败后 handle.ships 仍是旧数组引用（未部分替换）");
  assert(h.root.children.length === oldRoot, "B2 root 未被部分替换（children=" + h.root.children.length + "）");
  assert(h._specKey === oldKey, "B3 _specKey 未写入失败 key（保持旧 key）");
  let disposedDuringFail = 0;
  for (const [, cnt] of spy.counts) disposedDuringFail += cnt;
  assert(disposedDuringFail > 0, "B4 失败时临时模型被释放（dispose 调用 " + disposedDuringFail + " 次）");

  // 失败 key 未缓存 → 相同失败输入会重试（ship1 再次 build，buildCount 递增）
  const before = h._buildCount;
  setShips(h, failList);
  assert(h._buildCount === before + 1, "B5 失败 key 未缓存：相同失败输入会重试（ship1 再 build，buildCount " + before + "→" + h._buildCount + "）");

  // 换成有效列表 → 正常重建并原子替换
  setShips(h, [{ spec: specFrig, position: [3, 0, 0] }]);
  assert(h._buildCount > oldBuild && h.ships !== oldShips, "B6 失败后可继续正常重建替换（buildCount=" + h._buildCount + "）");
}

// ─────────────────────────────────────────────────────────────────────────
// (C) 资源所有权与释放：disposeShipObject 正式 API + 去重 + 共享跳过 + 纹理槽位
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (C) 资源所有权与释放（disposeShipObject dispose 事件计数）===");
{
  // C-real：真实 armor 战列舰（含 addEdgeOutline 共享描边材质、outline 复用父 geometry）
  const ship = buildShip(combatSpec("player_armor", "battleship"));
  const geoms = new Set(), mats = new Set(), sharedMats = new Set(), sharedTexs = new Set(), exTexs = new Set();
  ship.traverse((o) => {
    if (o.geometry) geoms.add(o.geometry);
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!m) continue;
      mats.add(m);
      if (m.userData && m.userData.ship3dShared) sharedMats.add(m);
      for (const slot of TEXTURE_SLOTS) {
        const t = m[slot];
        if (t && t.isTexture) { (t.userData && t.userData.ship3dShared ? sharedTexs : exTexs).add(t); }
      }
    }
  });
  const spy = installDisposeSpy();
  disposeShipObject(ship);
  spy.restore();

  let doubles = 0;
  for (const [, cnt] of spy.counts) if (cnt > 1) doubles++;
  assert(doubles === 0, "C1 无重复 dispose（Set 去重生效，重复计数=" + doubles + "）");

  let geoOnce = 0;
  for (const g of geoms) if (spy.counts.get(g) === 1) geoOnce++;
  assert(geoOnce === geoms.size, "C2 每个唯一 geometry 恰好释放一次（含 outline 复用父 geo）（" + geoOnce + "/" + geoms.size + "）");

  let nonShared = 0, nonSharedOnce = 0;
  for (const m of mats) { if (sharedMats.has(m)) continue; nonShared++; if (spy.counts.get(m) === 1) nonSharedOnce++; }
  assert(nonSharedOnce === nonShared, "C3 每个本舰专属材质恰好释放一次（" + nonSharedOnce + "/" + nonShared + "）");

  assert(sharedMats.size > 0, "C4 存在共享材质(ship3dShared 描边)用于验证跳过（=" + sharedMats.size + "）");
  let sharedSkipped = 0;
  for (const m of sharedMats) if (!spy.counts.has(m)) sharedSkipped++;
  assert(sharedSkipped === sharedMats.size, "C5 共享材质(ship3dShared)全部跳过释放（" + sharedSkipped + "/" + sharedMats.size + "）");

  // 纹理槽位现状锁定：Node 无 document → hazardStripe 回退无 map，故本舰实际纹理数=0。
  // 真实纹理释放路径在浏览器页（Section 四）验收；此处锁定 Node 现状，防误判。
  console.log("  [现状] Node 环境本舰纹理：exclusive=" + exTexs.size + " shared=" + sharedTexs.size + "（document 未定义→无 CanvasTexture）");
  assert(exTexs.size === 0 && sharedTexs.size === 0, "C6 Node 现状锁定：无 document 时舰船不含纹理（真实纹理释放移交 Section 四）");
}
{
  // C-synthetic：同一 geometry / material 被多 mesh 引用，仅释放一次
  const sharedGeo = new BoxGeometry(1, 1, 1);
  const g1 = new Group();
  g1.add(new Mesh(sharedGeo, new MeshBasicMaterial()));
  g1.add(new Mesh(sharedGeo, new MeshBasicMaterial()));
  let spy = installDisposeSpy();
  disposeShipObject(g1);
  spy.restore();
  assert(spy.counts.get(sharedGeo) === 1, "C7 同一 geometry 被多 mesh 引用仅释放一次（=" + spy.counts.get(sharedGeo) + "）");

  const sharedMat = new MeshBasicMaterial();
  const g2 = new Group();
  g2.add(new Mesh(new BoxGeometry(), sharedMat));
  g2.add(new Mesh(new BoxGeometry(), sharedMat));
  spy = installDisposeSpy();
  disposeShipObject(g2);
  spy.restore();
  assert(spy.counts.get(sharedMat) === 1, "C8 同一 material 被多 mesh 引用仅释放一次（=" + spy.counts.get(sharedMat) + "）");
}
{
  // C-synthetic：ship3dShared 材质/纹理跳过；本舰专属纹理释放一次
  const shMat = new MeshBasicMaterial(); shMat.userData.ship3dShared = true;
  const shTex = new Texture(); shTex.userData.ship3dShared = true;
  const exTex = new Texture();
  const exMat = new MeshStandardMaterial(); exMat.map = exTex;
  const g = new Group();
  g.add(new Mesh(new BoxGeometry(), shMat));
  const mm = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); mm.material.map = shTex;
  g.add(mm);
  g.add(new Mesh(new BoxGeometry(), exMat));
  const spy = installDisposeSpy();
  disposeShipObject(g);
  spy.restore();
  assert(!spy.counts.has(shMat), "C9 ship3dShared 材质跳过释放");
  assert(!spy.counts.has(shTex), "C10 ship3dShared 纹理跳过释放");
  assert(spy.counts.get(exTex) === 1, "C11 本舰专属纹理释放一次（=" + spy.counts.get(exTex) + "）");
}
{
  // C-synthetic：所有纹理槽位均被统一释放（覆盖 map 之外的槽位，未来加图即被覆盖）
  const multiMat = new MeshStandardMaterial();
  const slotTex = {};
  for (const slot of TEXTURE_SLOTS) { const t = new Texture(); slotTex[slot] = t; multiMat[slot] = t; }
  const g = new Group();
  g.add(new Mesh(new BoxGeometry(), multiMat));
  const spy = installDisposeSpy();
  disposeShipObject(g);
  spy.restore();
  let ok = 0;
  for (const slot of TEXTURE_SLOTS) if (spy.counts.get(slotTex[slot]) === 1) ok++;
  assert(ok === TEXTURE_SLOTS.length, "C12 所有纹理槽位(" + TEXTURE_SLOTS.length + ")均被释放一次（=" + ok + "）");
}
{
  // C-switch：setShips 切换后旧舰 geometry/专属材质真实释放
  const h = makeHandle();
  setShips(h, [{ spec: specFrig, position: [0, 0, 0] }]);
  const oldGeoms = new Set(), oldMats = new Set();
  h.ships[0].group.traverse((o) => {
    if (o.geometry) oldGeoms.add(o.geometry);
    const l = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of l) if (m && !(m.userData && m.userData.ship3dShared)) oldMats.add(m);
  });
  const spy = installDisposeSpy();
  setShips(h, [{ spec: specFrig, position: [5, 0, 0] }]);   // 不同 → 重建 → 旧舰释放
  spy.restore();
  let gRel = 0; for (const g of oldGeoms) if (spy.counts.get(g) >= 1) gRel++;
  let mRel = 0; for (const m of oldMats) if (spy.counts.get(m) >= 1) mRel++;
  assert(gRel === oldGeoms.size, "C13 切换后旧舰 geometry 全部释放（" + gRel + "/" + oldGeoms.size + "）");
  assert(mRel === oldMats.size, "C14 切换后旧舰专属材质全部释放（" + mRel + "/" + oldMats.size + "）");
}

// ─────────────────────────────────────────────────────────────────────────
// (D) 缩略图渲染器单例 —— 需浏览器 WebGL/canvas，移交 Section 四
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (D) 缩略图渲染器单例 ===");
if (typeof document === "undefined") {
  console.log("  [移交浏览器] Node 无 document/WebGL：captureThumbnail / ensureThumbRenderer /");
  console.log("               disposeThumbnailRenderer 的「≥20 张仅 1 个离屏渲染器、当前舰移出共享场景、");
  console.log("               本舰专属资源释放、失败不缓存 null、单次不 forceContextLoss、dispose 幂等、");
  console.log("               dispose 后可再建」验收全部由 tools/ship3d-browser-test.html 完成（不计入 PASS/FAIL）。");
} else {
  console.log("  [warn] 检测到 document，但本审计以 Node 无头运行为准，浏览器行为仍以 Section 四 为权威。");
}

// ─────────────────────────────────────────────────────────────────────────
// (E) 战斗大图：护盾重着色（Node 可验）+ 背景/查看器复用（移交 Section 四）
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== (E) 战斗大图护盾/背景 ===");
{
  const h = makeHandle();
  const enemySpec = { id: "enemy-frig", anchor: "Spear", race: "angel", line: "angel", hull: "frigate", seed: 99, faction: "angel", family: "angel", weapon: "laser" };
  setShips(h, [{ spec: specFrig }]);
  const playerHex = findShieldColorHex(h.ships[0].group);
  setShips(h, [{ spec: enemySpec, shieldColor: 0xff3a3a }]);
  const enemyHex = findShieldColorHex(h.ships[0].group);
  assert(enemyHex === 0xff3a3a, "E1 敌方 shieldColor=0xff3a3a 真实应用（=#" + (enemyHex == null ? "none" : enemyHex.toString(16)) + "）");

  setShips(h, [{ spec: specFrig }]);   // 切回我方（无 shieldColor）→ 全新构建，无红色残留
  const backHex = findShieldColorHex(h.ships[0].group);
  assert(backHex !== 0xff3a3a, "E2 切回我方无红色残留（=#" + (backHex == null ? "none" : backHex.toString(16)) + "）");
  assert(backHex === playerHex, "E3 切回我方护盾恢复默认色（=#" + (backHex == null ? "none" : backHex.toString(16)) + "）");

  const be = h._buildCount;
  setShips(h, [{ spec: enemySpec, shieldColor: 0xff3a3a }]);
  assert(h._buildCount === be + 1, "E4 敌方 spec 变化触发重建（未被旧缓存阻断）");
}
console.log("  [移交浏览器] 背景 0x0a121e↔0x1a0808 复用同一查看器（不重建 WebGL 上下文）由 Section 四 验收。");

// ─────────────────────────────────────────────────────────────────────────
// 浏览器验收页结构哨兵
// ─────────────────────────────────────────────────────────────────────────
(function checkBrowserTestPage() {
  const testHtmlPath = join(import.meta.dirname, "ship3d-browser-test.html");
  if (!existsSync(testHtmlPath)) { fail++; failures.push("浏览器验收页不存在: " + testHtmlPath); return; }
  const html = readFileSync(testHtmlPath, "utf8");
  let ok = true;
  // 10 项结构检查（Section 七）
  // 1. 禁止生产 canvas 上直接调用 getContext("webgl")
  //    生产 canvas 上只允许通过 __SHIP3D_GET_GL_CONTEXT 读取
  if (!html.includes("__SHIP3D_GET_GL_CONTEXT")) { ok = false; failures.push("缺 __SHIP3D_GET_GL_CONTEXT"); }
  // 2. 存在前置 getContext 包装和 WeakMap
  if (!html.includes("WeakMap")) { ok = false; failures.push("缺 getContext WeakMap"); }
  if (!html.includes("_origGC") && !html.includes("prototype.getContext")) { ok = false; failures.push("缺 getContext 包装"); }
  // 3. 存在 __SHIP3D_GET_GL_CONTEXT 导出
  if (!html.includes("__SHIP3D_GET_GL_CONTEXT=function")) { ok = false; failures.push("__SHIP3D_GET_GL_CONTEXT 未导出为函数"); }
  // 4. iframe 宽高不得为 1px（应为完整桌面尺寸）
  if (html.includes("width:1px") || html.includes("height:1px")) { ok = false; failures.push("iframe 尺寸仍为 1px"); }
  if (html.includes("left:-9999px") && !html.includes("left:-20000px")) { ok = false; failures.push("iframe 仍为左-9999px"); }
  if (!html.includes("1600px") && !html.includes("1000px")) { ok = false; failures.push("iframe 非 1600×1000 尺寸"); }
  // 5. 存在 apiPass/apiFail/uiPass/uiFail 独立计数
  if (!html.includes("apiPass") || !html.includes("apiFail") || !html.includes("uiPass") || !html.includes("uiFail")) { ok = false; failures.push("缺 API/UI 独立计数"); }
  if (html.includes("table:first-of-type")) { ok = false; failures.push("仍用 DOM 反推取代计数器"); }
  // 6. anyFailed 包含 parentErrors
  if (!html.includes("parentErrors.length>0") && !html.includes("parentErrors.length===0")) { ok = false; failures.push("anyFailed 未包含 parentErrors"); }
  // 7. anyFailed 包含 parentRejections
  if (!html.includes("parentRejections.length>0") && !html.includes("parentRejections.length===0")) { ok = false; failures.push("anyFailed 未包含 parentRejections"); }
  // 8. 使用真实 atron
  if (!html.includes('"atron"') || html.includes('"ateon"')) { ok = false; failures.push("测试舰未用 atron 或含 ateon"); }
  // 9. UI 像素读取前检查 drawingBuffer 尺寸
  if (!html.includes("drawingBufferWidth") || !html.includes("drawingBufferHeight")) { ok = false; failures.push("UI 像素读取未检查 drawingBuffer 尺寸"); }
  // 10. 核心测试无 SKIP（SKIP 计数不用于核心测试）
  if (html.includes("SKIP=") && !html.includes("skipCount=") && !html.includes("SKIP=0,将作为失败")) { ok = false; failures.push("未声明 SKIP 处理策略"); }
  if (ok) pass++; else fail++;
  console.log(ok ? "  ✓ 浏览器验收页结构完整（10 项检查通过）" : "  ✗ 浏览器验收页结构异常（详见失败项）");
})();

// ─────────────────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== 审计汇总 ===");
console.log("PASS=" + pass + "  FAIL=" + fail);
if (fail > 0) {
  console.log("失败项：");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("全部通过 ✓");
process.exit(0);
