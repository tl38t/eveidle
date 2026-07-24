// IndustrialHull.js — Industrial / ORE 功能工业舰（采矿 / 采气 / 工业支援 / 工业旗舰）
//
// EVE 参考（ORE 系：Venture / Procurer / Retriever / Covetor / Hulk / Mackinaw / Orca / Rorqual）：
//   - 宽厚货舱体，方正实用，不是战斗舰的流线。
//   - 平头（前段留给采矿激光臂 / 采气采集器挂载）。
//   - 侧挂货舱荚（越大越明显），尾部引擎块。
//   - 大分区装甲板 + 警示条（ORE 黄黑），少见流线。
//
// 设计契约（与 FortressHull 同范式）：
//   船体比 lathe 包络更宽 → 通用 surface generator（Groove/HeatSink/Vent/Ribbon/Sensor/DroneBay）
//   产出的几何被埋在体腔内（不崩、不可见），可见表面细节由本生成器自绘。
//   本生成器比 lathe 包络大，surface generator 浮空几何被吸收。
//
// Anchor Bus：暴露 ctx._industrialDims 供 FunctionalMountGenerator 读（挂采矿臂 / 采气采集器）。
import * as THREE from "three";
import { rbox, addPart } from "../Materials.js";
import { MaterialFactory } from "../MaterialFactory.js";

// 在 box 的某个长轴面铺装甲板（凹缝露暗底）。face: top/bottom/left/right。
function tilePlates(ctx, g, o) {
  const { mat, baseMat, halfW, halfH, len, z0, thk, gap, nZ, nPerp, face } = o;
  const out = -thk * 0.4;
  for (let iz = 0; iz < nZ; iz++) {
    const zA = z0 + len * iz / nZ;
    const zB = z0 + len * (iz + 1) / nZ;
    const zC = (zA + zB) / 2;
    const segD = (zB - zA) * (1 - gap);
    const lo = (face === "top" || face === "bottom") ? -halfH : -halfW;
    const hi = (face === "top" || face === "bottom") ? halfH : halfW;
    const span = hi - lo;
    for (let ix = 0; ix < nPerp; ix++) {
      const a = lo + span * ix / nPerp;
      const b = lo + span * (ix + 1) / nPerp;
      const c = (a + b) / 2;
      const segW = (b - a) * (1 - gap);
      let box, px, py, pz = zC;
      if (face === "top")       { box = new THREE.BoxGeometry(segW, thk, segD); px = c; py = halfH + out; }
      else if (face === "bottom") { box = new THREE.BoxGeometry(segW, thk, segD); px = c; py = -halfH - out; }
      else if (face === "left")  { box = new THREE.BoxGeometry(thk, segW, segD); px = -(halfW + out); py = c; }
      else                       { box = new THREE.BoxGeometry(thk, segW, segD); px = halfW + out; py = c; }
      const plate = new THREE.Mesh(box, (iz + ix) % 5 === 0 ? baseMat : mat); // 零星暗板打破大面积
      plate.position.set(px, py, pz);
      g.add(plate);
    }
  }
}

// 货柜模块（尾部 / 顶部叠加）：波纹侧板 + 四角立柱 + 后门 + 环绕警示带
// pos: [x, y, z] 容器中心；bodyMat 箱体色，structMat 暗钢结构（立柱/肋/门）
function addCargoContainer(g, w, h, len, pos, bodyMat, structMat, hazardMat, midR) {
  const grp = new THREE.Group();
  // 主体箱
  grp.add(rbox(w, h, len, midR * 0.03, bodyMat, [0, 0, 0]));
  // 四角立柱（暗钢）
  const postW = Math.max(0.08, w * 0.035);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    grp.add(rbox(postW, h * 1.05, len * 0.99, midR * 0.01, structMat,
      [sx * (w / 2 - postW / 2), sy * (h / 2 - postW / 2), 0]));
  }
  // 波纹侧板（沿 Z 排列的竖向肋，左右两面）
  const ribs = 7;
  const ribW = Math.max(0.05, w * 0.018);
  for (const side of [-1, 1]) {
    for (let i = 0; i < ribs; i++) {
      const zz = -len / 2 + len * (i + 0.5) / ribs;
      grp.add(rbox(ribW, h * 0.94, len * 0.94, midR * 0.008, structMat,
        [side * (w / 2 - ribW / 2), 0, zz]));
    }
  }
  // 后门（尾端深色门板）
  grp.add(rbox(w * 1.02, h * 1.02, len * 0.05, midR * 0.006, structMat, [0, 0, len / 2]));
  // 环绕警示带（中段）
  grp.add(rbox(w * 1.03, h * 1.03, len * 0.14, midR * 0.006, hazardMat, [0, 0, 0]));
  grp.position.set(pos[0], pos[1], pos[2]);
  g.add(grp);
}

export function generateIndustrialHull(ctx) {
  const { s, L } = ctx;
  const p = ctx.civ.hullParams;
  const midR = ctx.hullProfile.mid * s;
  const wMul = p.widthMul || 1.35;
  const lMul = p.lengthMul || 0.95;
  const body = ctx.profile.hull.body;
  const isSupport = ctx.spec && ctx.spec.function === "support";

  // ▸ 货舱主箱体（宽厚短稳；支援船独有构型：平扁宽体 + 大鼻工程舱 + 厚侧箱）
  let hullW, hullH, hullLen;
  if (isSupport) {
    // 海豚级：扁平宽体 + 大鼻工程舱 + 厚侧箱，与采矿完全不同的轮廓
    hullW = midR * 2.2 * wMul;    // 更宽
    hullH = midR * 1.15;          // 更低扁
    hullLen = L * 0.72;           // 更短
  } else {
    hullW = midR * 2.0 * wMul;
    hullH = midR * 1.5;
    hullLen = L * 0.82 * lMul;
  }

  const g = new THREE.Group();
  g.name = "hull";

  const coreMat = ctx.hullMat;
  const plateMat = MaterialFactory.get("armorDeck", ctx);
  const seamMat = MaterialFactory.get("groove", ctx);
  const hazardMat = MaterialFactory.get("hazardStripe", ctx);

  // ══ Core 货舱主箱（仅采矿/采气使用）══
  if (!isSupport) {
    g.add(rbox(hullW, hullH, hullLen, midR * 0.05, coreMat));
  }

  if (isSupport) {
    // ══ 海豚级专属构型：长船鼻 + 中段圆柱颈（贯穿前后段）+ 后段分节模块堆叠 ══
    // 圆柱颈是核心连接结构——必须从前段尾端延伸到后段第一模块起点，把前后段"接"上。
    var midZ = hullH * 0.05;  // var 提升
    // 圆柱颈先定义，前后段咬住它的两侧
    const neckStart = -hullLen * 0.18;
    const neckEnd   =  hullLen * 0.12;
    const neckLen = neckEnd - neckStart;     // 30% hullLen
    var neckCenterZ = (neckStart + neckEnd) / 2;  // var 提升，供 Anchor Bus 使用
    const neckR = hullW * 0.30;              // 粗一些
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(neckR, neckR * 1.10, neckLen, 18), coreMat);
    neck.position.set(0, midZ, neckCenterZ);
    neck.rotation.x = Math.PI / 2;
    g.add(neck);
    // 横向垂直圆柱（沿 X 轴穿过颈中部，与纵颈形成十字交叉工业接头）
    const crossLen = hullW * 2.8;
    const crossR = neckR * 0.55;
    const crossCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(crossR, crossR * 1.10, crossLen, 14), plateMat);
    crossCyl.position.set(0, midZ, neckCenterZ);
    crossCyl.rotation.z = Math.PI / 2;
    g.add(crossCyl);
    // 前鼻段——尾端明确嵌入颈内部约 8% 船体长（与圆柱咬合 1.5+ 单位）
    const noseLen = hullLen * 0.36;
    const noseEnd = neckStart + hullLen * 0.08;   // 嵌入圆柱尾段 8% hullLen
    const noseStart = noseEnd - noseLen;
    const noseW = hullW * 0.32;
    const noseH = hullH * 0.50;
    g.add(rbox(noseW, noseH, noseLen, midR * 0.015, coreMat,
      [0, midZ, (noseStart + noseEnd) / 2]));
    // 后段：4 个矩形模块轴向并排，首块起点 = neckEnd - 7% hullLen（嵌入颈尾段 8%）
    const segStart = neckEnd - hullLen * 0.07;
    const segLen = hullLen * 0.14;
    const segGap = hullLen * 0.02;
    for (let i = 0; i < 4; i++) {
      const sz = segStart + i * (segLen + segGap);
      g.add(rbox(hullW * 0.85, hullH * 0.85, segLen, midR * 0.02,
        i % 2 === 0 ? coreMat : plateMat, [0, midZ, sz]));
    }
    // ══ 顶部连接钢梁（两根细长导轨，跨三隙串四模块）══
    const railLen = 3 * segLen + 2 * segGap;               // 仅跨过4模块+3间隙，不过分延伸
    const railMidZ = segStart + segLen * 0.5 + railLen * 0.5;
    const railPlate = hullW * 0.12;                        // 收窄
    g.add(rbox(railPlate, hullH * 0.05, railLen, midR * 0.003, seamMat,
      [-hullW * 0.20, midZ + hullH * 0.50 + hullH * 0.04, railMidZ]));
    g.add(rbox(railPlate, hullH * 0.05, railLen, midR * 0.003, seamMat,
      [hullW * 0.20, midZ + hullH * 0.50 + hullH * 0.04, railMidZ]));
    // 后封板
    const lastSegCenter = segStart + 3 * (segLen + segGap) + segLen * 0.5;
    g.add(rbox(hullW * 0.70, hullH * 0.65, hullLen * 0.03, midR * 0.01, seamMat,
      [0, midZ, lastSegCenter + segLen * 0.5 + hullLen * 0.015]));
    // 顶部指挥模块（位于后段前部上方，对齐到首模块）
    const topH = hullH * 0.32;
    g.add(rbox(hullW * 0.28, topH, hullLen * 0.13, midR * 0.02, MaterialFactory.get("armorFortress", ctx),
      [0, hullH / 2 + topH * 0.5, segStart + segLen * 0.5]));
    g.add(rbox(hullW * 0.10, topH * 0.6, hullLen * 0.06, midR * 0.01, seamMat,
      [0, hullH / 2 + topH + topH * 0.3, segStart + segLen * 0.5]));
    // 警示带（后段首模块处）
    g.add(rbox(hullW * 1.02, hullH * 1.02, hullLen * 0.07, midR * 0.006, hazardMat,
      [0, midZ, segStart + segLen * 0.4]));
    // 鼻尖 2 根细长天线触须
    const antMat = MaterialFactory.get("commandAntenna", ctx);
    for (const side of [-1, 1]) {
      addPart(g, new THREE.CylinderGeometry(midR * 0.012, midR * 0.022, hullLen * 0.10, 6), antMat,
        [side * noseW * 0.32, midZ + noseH * 0.45, noseStart]);
    }
    // 鼻上指挥天线（居中加粗带红灯）
    addPart(g, new THREE.CylinderGeometry(midR * 0.035, midR * 0.055, hullLen * 0.18, 8), antMat,
      [0, midZ + noseH * 0.55, (noseStart + noseEnd) * 0.5 + hullLen * 0.02]);
    // 红灯信标（命名"beacon_red"供查看器做闪烁动画）
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(midR * 0.040, 8, 6),
      MaterialFactory.getGlowColor(0xff0000, 2.8));
    beacon.name = "beacon_red";
    beacon.position.set(0, midZ + noseH * 0.55 + hullLen * 0.09, (noseStart + noseEnd) * 0.5 + hullLen * 0.02);
    g.add(beacon);
  } else {

  // ══ 装甲板拼贴（工业大分区 + 零星暗缝）══
  const thk = midR * 0.03;
  const gap = 0.12;
  const nZ = body === "dagger" ? 4 : body === "gunboat" ? 5 : body === "fortress" ? 7 : 6;
  const nPerp = body === "dagger" ? 2 : body === "gunboat" ? 3 : 3;
  const halfW = hullW / 2, halfH = hullH / 2;
  for (const face of ["top", "bottom", "left", "right"]) {
    tilePlates(ctx, g, { mat: plateMat, baseMat: seamMat, halfW, halfH, len: hullLen, z0: -hullLen / 2, thk, gap, nZ, nPerp, face });
  }

  // ══ 平头楔形（前段留给采矿臂 / 采气采集器）══
  const nose = rbox(hullW * 1.04, hullH * 0.5, hullLen * 0.1, midR * 0.03, MaterialFactory.get("armorFortress", ctx), [0, 0, -hullLen / 2 - hullLen * 0.04]);
  nose.rotation.x = -0.05;
  g.add(nose);

  // ══ 警示条（ORE 黄黑对角斜纹，前段 + 中段两圈）══
  const hzThick = hullLen * 0.07;
  const hz1 = rbox(hullW * 1.03, hullH * 1.03, hzThick, midR * 0.008, hazardMat, [0, 0, -hullLen * 0.30]);
  g.add(hz1);
  const hz2 = rbox(hullW * 1.01, hullH * 1.01, hzThick, midR * 0.008, hazardMat, [0, 0, -hullLen * 0.08]);
  g.add(hz2);

  // ══ 侧挂货舱荚（X 镜像；巡洋以上更明显）══
  const podT = body === "dagger" ? 0.0 : body === "gunboat" ? 0.5 : 0.8;
  if (podT > 0) {
    const podLen = hullLen * (0.4 + 0.15 * podT);
    const podW = midR * (0.5 + 0.2 * podT);
    const podH = hullH * (0.55 + 0.1 * podT);
    for (const side of [-1, 1]) {
      const pod = rbox(podW, podH, podLen, midR * 0.04, coreMat, [side * (hullW / 2 + podW * 0.5), -hullH * 0.1, 0]);
      g.add(pod);
      // 荚顶警示条（对角斜纹）
      const pstripe = rbox(podW * 1.03, podH * 1.03, podLen * 0.10, midR * 0.008, hazardMat, [side * (hullW / 2 + podW * 0.5), -hullH * 0.1, podLen * 0.15]);
      g.add(pstripe);
    }
  }

  // ══ 尾部货柜模块（小尾柜；巡洋+ 顶部叠小柜）══
  const tailW = hullW * 1.04, tailH = hullH * 1.04, tailLen = hullLen * 0.16;
  const structMat = MaterialFactory.get("groove", ctx);  // 暗钢结构
  addCargoContainer(g, tailW, tailH, tailLen, [0, 0, hullLen / 2 + tailLen / 2], coreMat, structMat, hazardMat, midR);
  if (ctx.classTier >= 2) {
    addCargoContainer(g, tailW * 0.6, tailH * 0.42, tailLen * 0.8,
      [0, tailH * 0.71, hullLen / 2 + tailLen * 0.5], coreMat, structMat, hazardMat, midR);
  }

  // ══ 冷却鳍（采矿激光高发热；尾部两舷单排）══
  const finCnt = body === "dagger" ? 2 : body === "gunboat" ? 3 : 4;
  for (const side of [-1, 1]) {
    for (let i = 0; i < finCnt; i++) {
      const fz = hullLen * 0.5 - i * hullLen * 0.07;
      addPart(g, new THREE.BoxGeometry(midR * 0.05, hullH * 0.7, midR * 0.28),
        MaterialFactory.get("heatSinkFin", ctx),
        [side * (hullW / 2 + midR * 0.06), 0, fz], [0, 0, side * 0.2]);
    }
  }

  // ══ 加强装甲带（fortress 专属：船体腰线厚装甲板 + 结构加强肋）══
  if (body === "fortress") {
    const beltMat = MaterialFactory.get("armorFortress", ctx);
    const bThk = midR * 0.07;
    const bLen = hullLen * 0.60;
    // 上装甲带
    g.add(rbox(hullW * 1.01, bThk, bLen, midR * 0.02, beltMat, [0, hullH / 2 - bThk * 0.5, 0]));
    // 下装甲带
    g.add(rbox(hullW * 1.01, bThk, bLen, midR * 0.02, beltMat, [0, -hullH / 2 + bThk * 0.5, 0]));
    // 左装甲带
    g.add(rbox(bThk, hullH * 1.01, bLen, midR * 0.02, beltMat, [hullW / 2 - bThk * 0.5, 0, 0]));
    // 右装甲带
    g.add(rbox(bThk, hullH * 1.01, bLen, midR * 0.02, beltMat, [-hullW / 2 + bThk * 0.5, 0, 0]));

    // 结构加强肋（船体顶部纵梁 + 斜撑）
    const ribMat = MaterialFactory.get("groove", ctx);
    const rT = midR * 0.025;
    // 两条纵梁（顶部两侧）
    for (const side of [-1, 1]) {
      g.add(rbox(rT, rT * 0.4, hullLen * 0.7, rT * 0.1, ribMat,
        [side * hullW * 0.30, hullH / 2 + midR * 0.01, 0]));
    }
    // 斜撑（X 形，每侧 3 组）
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const zz = -hullLen * 0.25 + i * hullLen * 0.25;
        // 前斜撑
        const strut1 = rbox(rT * 0.5, rT, hullW * 0.35, rT * 0.1, ribMat,
          [side * hullW * 0.12, hullH / 2 + midR * 0.005, zz]);
        strut1.rotation.y = side * 0.3;
        g.add(strut1);
      }
    }
    // ══ 工业表面特征：排气槽 + 顶部导轨 + 侧面管线（fortress 专属）══
    // 侧面排气槽（每侧 5 道暗色竖行散热口）
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const vz = -hullLen * 0.30 + i * hullLen * 0.13;
        g.add(rbox(midR * 0.025, hullH * 0.18, midR * 0.12, midR * 0.003, seamMat,
          [side * (hullW / 2 + midR * 0.02), hullH * 0.15, vz]));
      }
    }
    // 顶部导轨（两条平行轨道线，从舰桥延伸到尾部）
    for (const side of [-1, 1]) {
      g.add(rbox(midR * 0.015, midR * 0.02, hullLen * 0.55, midR * 0.003, seamMat,
        [side * hullW * 0.20, hullH / 2 + midR * 0.02, hullLen * 0.10]));
    }
    // 侧面管线（船身两侧斜向管路）
    for (const side of [-1, 1]) {
      const pipe = rbox(midR * 0.018, midR * 0.018, hullLen * 0.35, 0, seamMat,
        [side * hullW * 0.35, hullH * 0.30, hullLen * 0.05]);
      pipe.rotation.x = 0.25;
      g.add(pipe);
    }
  }
  } // ← 闭合 else {（采矿船 hull 专用块）

  // ══ 顶部舰桥 / 指挥塔（仅非支援；支援舰有自己专属的塔楼布局）══
  if (!isSupport) {
    const bridge = rbox(hullW * 0.3, hullH * 0.4, hullLen * 0.16, midR * 0.03, MaterialFactory.get("armorFortress", ctx), [0, hullH / 2 + hullH * 0.18, hullLen * 0.05]);
    g.add(bridge);
  }

  // ══ Anchor Bus ══
  ctx._industrialDims = { hullW, hullH, hullLen, midR, noseZ: -hullLen / 2 - hullLen * 0.04 };
  if (isSupport) {
    ctx._industrialDims.crossArmX = hullW * 1.4;
    ctx._industrialDims.crossArmZ = isSupport ? neckCenterZ : 0;
    ctx._industrialDims.crossArmY = midZ + hullW * 0.165;  // 横筒半径 = hullW*0.3*0.55 = hullW*0.165
  }

  return g;
}
