// FortressHull.js — Player Armor：移动堡垒（Fortress Engineering）
//
// 设计哲学："不是穿着装甲的船，是被推进器推动的太空堡垒。"
//
// 结构层次：
//   Core Hull    — 厚重盒形主箱体（宽厚短稳）
//   Armor Shell  — 包裹 Core 的第二层壳（台阶感，比 Core 大一圈）
//   （External Armor Blocks 由 ArmorBlockGenerator 负责）
//   （Surface Details 由 Panel/Groove/Hatch/HeatSink 负责）
//
// Anchor Bus：把 hull 尺寸写入 ctx._fortressDims，
//   供 ArmorBlockGenerator / WeaponGenerator 等下游读取。
import * as THREE from "three";
import { rbox } from "../Materials.js";
import { buildSpine, buildBridge } from "./CivHelpers.js";
import { MaterialFactory } from "../MaterialFactory.js";

// 长度方向梯形壳（frustum）：front 半宽 wF/2，back 半宽 wB/2，高度 h，长度 len。
// 侧面轮廓即梯形（尾宽头窄）。用 BufferGeometry 手写，确保锥度可控。
function makeFrustum(wF, wB, h, len) {
  const z0 = -len / 2, z1 = len / 2;
  const hwF = wF / 2, hwB = wB / 2, hh = h / 2;
  const v = [
    -hwF, -hh, z0,  hwF, -hh, z0,  hwF, hh, z0,  -hwF, hh, z0, // 0-3 前
    -hwB, -hh, z1,  hwB, -hh, z1,  hwB, hh, z1,  -hwB, hh, z1, // 4-7 后
  ];
  const idx = [
    0, 1, 2, 0, 2, 3,    // 前
    4, 6, 5, 4, 7, 6,    // 后
    0, 4, 5, 0, 5, 1,    // 底
    3, 2, 6, 3, 6, 7,    // 顶
    0, 3, 7, 0, 7, 4,    // 左
    1, 5, 6, 1, 6, 2,    // 右
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// 在 frustum 的某个长轴面上铺独立装甲板。face: top/bottom/left/right。
// 板间留 gap 比例的细缝，露出底下深色基底 → 真实"甲缝"（凹缝，非凸条）。
// 梯形锥度自动贴合：每个 Z 切片用该处的局部半宽。
function tileArmorPlates(ctx, g, o) {
  const { mat, halfWF, halfWB, hh, len, z0, plateThk, gap, nZ, nPerp, face } = o;
  const hw = (z) => { const t = (z - z0) / len; return halfWF + (halfWB - halfWF) * t; };
  const out = -plateThk * 0.4;   // 板内嵌于 frustum 表面 → 缝里露出有深度的暗灰凹槽
  for (let iz = 0; iz < nZ; iz++) {
    const zA = z0 + len * iz / nZ;
    const zB = z0 + len * (iz + 1) / nZ;
    const zC = (zA + zB) / 2;
    const segD = (zB - zA) * (1 - gap);
    const wHere = hw(zC);
    const lo = (face === "top" || face === "bottom") ? -wHere : -hh;
    const hi = (face === "top" || face === "bottom") ? wHere : hh;
    const span = hi - lo;
    for (let ix = 0; ix < nPerp; ix++) {
      const a = lo + span * ix / nPerp;
      const b = lo + span * (ix + 1) / nPerp;
      const c = (a + b) / 2;
      const segW = (b - a) * (1 - gap);
      let box, px, py, pz = zC;
      if (face === "top") { box = new THREE.BoxGeometry(segW, plateThk, segD); px = c; py = hh + out; }
      else if (face === "bottom") { box = new THREE.BoxGeometry(segW, plateThk, segD); px = c; py = -hh - out; }
      else if (face === "left") { box = new THREE.BoxGeometry(plateThk, segW, segD); px = -(wHere + out); py = c; }
      else { box = new THREE.BoxGeometry(plateThk, segW, segD); px = wHere + out; py = c; }
      const plate = new THREE.Mesh(box, mat);
      plate.position.set(px, py, pz);
      g.add(plate);
    }
  }
}

export function generateFortressHull(ctx) {
  const { s, L } = ctx;
  const p = ctx.civ.hullParams;
  const midR = ctx.hullProfile.mid * s;
  const wMul = p.widthMul || 1.25;
  const lMul = p.lengthMul || 0.9;
  const mass = p.mass || 1.5;

  // ▸ Core Hull 尺寸 — 宽厚短稳
  const hullW = midR * 1.7 * wMul;        // 宽（比 Shield 宽 25%）
  const hullH = midR * 1.45 * wMul;       // 厚（比 Shield 高 25%）
  const hullLen = L * 0.88 * lMul;        // 短（比 Shield 短 10%）

  const g = new THREE.Group();
  g.name = "hull";

  const coreMat = ctx.hullMat;
  const deckMat = MaterialFactory.get("armorDeck", ctx);
  const fortressMat = MaterialFactory.get("armorFortress", ctx);
  const body = ctx.profile.hull.body;   // dagger / gunboat / cruiser / fortress

  // ══ Core Hull — 厚重盒形主箱体 ══
  const core = rbox(hullW, hullH, hullLen, midR * 0.06, coreMat);
  g.add(core);

  // ══ Armor Shell — 长度方向梯形（尾宽头窄）第二层壳 + 装甲甲缝 ══
  // 用 makeFrustum 让主装甲体沿 Z 轴呈微妙楔形（尾比头宽 ~12%），
  // 侧面轮廓即梯形；表面叠加黑色细凹槽（armor seam）打破大面积纯色。
  const shellThick = midR * 0.10 * mass;
  const shellLen = hullLen * 0.78;
  const shellWF = hullW + shellThick * 1.0;        // 头部（窄）
  const shellWB = hullW + shellThick * 3.0;         // 尾部（宽）— 梯形（尾比头宽 ~12%）
  const shellH = hullH + shellThick * 2;

  // frustum 基底用近黑，作为板缝露出的底色（更深，凹缝更明显）
  const shellBaseMat = MaterialFactory.get("groove", ctx);  // 0x14110d 近黑缝底
  const shellGeo = makeFrustum(shellWF, shellWB, shellH, shellLen);
  const shell = new THREE.Mesh(shellGeo, shellBaseMat);
  g.add(shell);

  // ── 装甲板拼贴（Plate Tiling）──
  // 把大白面拆成独立亮色装甲板，板间留细缝露出暗灰基底 → 真实"甲缝"（凹缝，非凸条）。
  // 在 frustum 4 个长轴面（顶/底/左/右）上铺板，梯形锥度自动贴合。
  const plateMat = MaterialFactory.get("armorDeck", ctx);
  const plateThk = midR * 0.028;   // 板更厚 → 凹槽更深
  const gap = 0.15;                  // 缝更宽（15%）→ 暗灰基底更明显
  const nZ = body === "dagger" ? 4 : body === "gunboat" ? 5 : body === "fortress" ? 7 : 6;
  const nPerp = body === "dagger" ? 2 : body === "gunboat" ? 3 : body === "fortress" ? 4 : 3;
  const hh = shellH / 2;
  const halfWF = shellWF / 2, halfWB = shellWB / 2;
  for (const face of ["top", "bottom", "left", "right"]) {
    tileArmorPlates(ctx, g, {
      mat: plateMat, halfWF, halfWB, hh, len: shellLen,
      z0: -shellLen / 2, plateThk, gap, nZ, nPerp, face,
    });
  }

  // ══ 鼻部装甲楔形 — 平头斜切面 ══
  const nose = rbox(
    hullW * 1.02, hullH * 0.45, hullLen * 0.08,
    midR * 0.03, fortressMat,
    [0, 0, -hullLen / 2 - hullLen * 0.03]
  );
  nose.rotation.x = -0.06; // 轻微下倾
  g.add(nose);

  // ══ 中段装甲裙带 — 侧面凸出的防护裙 ══
  const skirtThick = midR * 0.08 * mass;
  const skirtLen = hullLen * 0.5;
  for (const side of [-1, 1]) {
    const skirt = rbox(
      skirtThick, hullH * 0.85, skirtLen,
      midR * 0.02, fortressMat,
      [side * (hullW / 2 + skirtThick * 0.5), 0, 0]
    );
    g.add(skirt);
  }

  // ══ 尾部装甲封板 — 保护引擎区域 ══
  const tail = rbox(
    hullW * 1.05, hullH * 1.05, hullLen * 0.06,
    midR * 0.03, deckMat,
    [0, 0, hullLen / 2 + hullLen * 0.02]
  );
  g.add(tail);

  // ══ 共享元素 ══
  buildSpine(ctx, g, hullH / midR * 0.5, 0.7);
  buildBridge(ctx, g);

  // ══ Anchor Bus：暴露 hull 尺寸供下游 Generator 读取 ══
  ctx._fortressDims = { hullW, hullH, hullLen, midR };

  return g;
}
