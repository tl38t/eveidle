// ArmorBlockGenerator.js — External Armor Blocks（巨型外挂装甲块）
//
// Player Armor 设计语言的第三层：
//   Core Hull → Armor Shell → External Armor Blocks → Surface Details
//
// 职责：生成数量少、尺寸大的装甲块，贴附在 Armor Shell 外侧。
//   不是 Panel（表面细节），是结构层 —— 船头船侧的巨型凸起防护块。
//
// 数量按舰级：
//   Frigate (dagger):    2-4 块
//   Destroyer (gunboat): 3-4 块
//   Cruiser:             6-8 块
//   Battleship (fortress): 10-14 块
//
// 位置：船头到中段（避开发动机区域 z > 0.3*hullLen）
// 尺寸：blockSize = hullSize * 0.25~0.4
//
// 仅 Player Armor 路线生成（ctx.civ.hullType === "box"）。
// 读取 ctx._fortressDims（FortressHull 暴露的 Anchor Bus）。
import * as THREE from "three";
import { rbox, addEdgeOutline } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

export function generateArmorBlocks(ctx) {
  const g = new THREE.Group();
  g.name = "armorBlocks";

  // 仅 Player Armor 路线生成
  if (!ctx.civ || ctx.civ.hullType !== "box") return g;

  // 读取 FortressHull 暴露的尺寸
  const dims = ctx._fortressDims;
  if (!dims) return g;
  const { hullW, hullH, hullLen, midR } = dims;
  const s = ctx.s; // 缩放因子：本函数及内部 helper（addHazardStripe 等）统一用 s 引用

  const blockMat = MaterialFactory.get("armorFortress", ctx);
  const hazardMat = MaterialFactory.get("hazardStripe", ctx);
  const rng = ctx.scope("armorBlock").random;

  // 警示条：随机给部分装甲块贴一条黄色警示带（C 方向细节密度）
  const addHazardStripe = (block, w, h, d) => {
    const stripe = rbox(w * 0.55, 0.026 * s, d * 0.72, 0.005 * s, hazardMat, [0, h * 0.5 + 0.014 * s, 0]);
    block.add(stripe);
  };

  // 装甲块辅助：rbox + 边缘描边（深色棱线勾轮廓，强化"堡垒"厚重感）
  const edgeColor = ctx.palette?.dark ?? 0x2a2620;
  const blockWithEdges = (...args) => {
    const m = rbox(...args);
    addEdgeOutline(m, edgeColor, 0.75, 50);
    return m;
  };

  // ── 按舰级确定数量 ──
  const body = ctx.profile.hull.body;
  let blockCount;
  if (body === "dagger")       blockCount = 2 + Math.floor(rng() * 3);   // 2-4
  else if (body === "gunboat") blockCount = 3 + Math.floor(rng() * 2);   // 3-4
  else if (body === "cruiser") blockCount = 6 + Math.floor(rng() * 3);   // 6-8
  else                         blockCount = 10 + Math.floor(rng() * 5);  // 10-14 (fortress/battleship)

  // ── blockSize = hullSize * 0.30~0.45 ──
  const hullSize = Math.min(hullW, hullH);
  const blockBase = hullSize * (0.30 + rng() * 0.15);

  // ── 装甲块分布区域：船头到中段（避开发动机区域）──
  const zMin = -hullLen * 0.40;
  const zMax = hullLen * 0.18;

  // ── 生成装甲块 ──
  // 面分配：左右两侧优先（船侧核心区域），顶底次之
  for (let i = 0; i < blockCount; i++) {
    const t = blockCount > 1 ? i / (blockCount - 1) : 0.5;
    const z = zMin + (zMax - zMin) * t + (rng() - 0.5) * hullLen * 0.04;

    // 轮流分配面，保证两侧均匀
    const faceCycle = i % 4; // 0=top, 1=bottom, 2=left, 3=right

    // 尺寸变化（低变异——统一模板感，但不是完全相同）
    const sizeVar = 0.85 + rng() * 0.3;
    const bw = blockBase * sizeVar;
    const bh = blockBase * (0.65 + rng() * 0.25);
    const protrusion = blockBase * (0.35 + rng() * 0.20); // 凸出量增大

    const cornerR = midR * 0.025;

    if (faceCycle === 0) {
      // ── 顶面装甲块 ──
      const px = (rng() - 0.5) * hullW * 0.45;
      const py = hullH * 0.5 + protrusion * 0.5;
      const block = blockWithEdges(bw, protrusion, bh * 1.3, cornerR, blockMat, [px, py, z]);
      if (rng() < 0.55) addHazardStripe(block, bw, protrusion, bh * 1.3);
      g.add(block);
    } else if (faceCycle === 1) {
      // ── 底面装甲块 ──
      const px = (rng() - 0.5) * hullW * 0.45;
      const py = -hullH * 0.5 - protrusion * 0.5;
      const block = blockWithEdges(bw, protrusion, bh * 1.3, cornerR, blockMat, [px, py, z]);
      if (rng() < 0.55) addHazardStripe(block, bw, protrusion, bh * 1.3);
      g.add(block);
    } else if (faceCycle === 2) {
      // ── 左侧面装甲块 ──
      const px = -hullW * 0.5 - protrusion * 0.5;
      const py = (rng() - 0.5) * hullH * 0.35;
      const block = blockWithEdges(protrusion, bh, bw * 1.3, cornerR, blockMat, [px, py, z]);
      if (rng() < 0.55) addHazardStripe(block, protrusion, bh, bw * 1.3);
      g.add(block);
    } else {
      // ── 右侧面装甲块 ──
      const px = hullW * 0.5 + protrusion * 0.5;
      const py = (rng() - 0.5) * hullH * 0.35;
      const block = blockWithEdges(protrusion, bh, bw * 1.3, cornerR, blockMat, [px, py, z]);
      if (rng() < 0.55) addHazardStripe(block, protrusion, bh, bw * 1.3);
      g.add(block);
    }
  }

  // ── 船头防护楔块（所有舰级都有，强化"堡垒"感）──
  const noseBlockW = hullW * 0.8;
  const noseBlockH = hullH * 0.35;
  const noseBlockD = hullLen * 0.12;
  const noseBlock = blockWithEdges(
    noseBlockW, noseBlockH, noseBlockD,
    midR * 0.03, blockMat,
    [0, 0, -hullLen * 0.5 - noseBlockD * 0.3]
  );
  noseBlock.rotation.x = -0.08;
  g.add(noseBlock);

  // ── 工业管线带（Armor 路线专属 — Fortress Engineering 工业感）──
  // 贴着船体表面的粗管道，沿 Z 轴走向（船头→船尾方向）。
  // 数量按舰级递增，体现"装甲内部有管线穿行"的工业逻辑。
  const pipeMat = MaterialFactory.get("armorDeck", ctx);
  const pipeR = hullSize * 0.045;
  const pipeLen = hullLen * 0.72;
  const pipeZ = -hullLen * 0.05;

  let pipeCount;
  if (body === "dagger")       pipeCount = 2;
  else if (body === "gunboat") pipeCount = 3;
  else if (body === "cruiser") pipeCount = 4;
  else                         pipeCount = 6;

  // 顶部管线（沿 Z 轴，左右分布）
  const topPipes = Math.ceil(pipeCount / 2);
  for (let i = 0; i < topPipes; i++) {
    const t = topPipes > 1 ? i / (topPipes - 1) - 0.5 : 0;
    const px = t * hullW * 0.55;
    const py = hullH * 0.5 + pipeR * 0.6;
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(pipeR, pipeR, pipeLen, 10),
      pipeMat
    );
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(px, py, pipeZ);
    g.add(pipe);
  }

  // 侧面管线（沿 Z 轴，贴侧壁）
  const sidePipes = Math.floor(pipeCount / 2);
  for (let i = 0; i < sidePipes; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const yFrac = sidePipes > 1 ? (Math.floor(i / 2) / (sidePipes - 1) - 0.5) : 0;
    const px = side * (hullW * 0.5 + pipeR * 0.6);
    const py = yFrac * hullH * 0.5;
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(pipeR * 0.85, pipeR * 0.85, pipeLen * 0.82, 10),
      pipeMat
    );
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(px, py, pipeZ);
    g.add(pipe);
  }

  // ── 舷号识别牌（左侧面中线，金属底板 + 黄色编号段，模拟舰体识别牌）──
  const plateX = -hullW * 0.5;            // 左舷外表面
  const plateW = 0.16 * s;                // 向外凸起的厚度（可见为实体牌，而非线）
  const plateH = hullH * 0.32;
  const plateL = hullLen * 0.24;          // 缩短为离散牌，不再贯穿全船
  const plateZ = -hullLen * 0.05;
  const basePlate = new THREE.Mesh(
    new THREE.BoxGeometry(plateW, plateH, plateL),
    MaterialFactory.get("armorDeck", ctx)   // 金属灰底板，区别于近黑 groove
  );
  basePlate.position.set(plateX - plateW * 0.5, 0, plateZ);
  g.add(basePlate);
  // 黄色编号段（贴在底板正面，朝外）
  const nDots = 3;
  const dotW = 0.05 * s;
  const dotH = hullH * 0.1;
  const dotL = plateL * 0.18;
  for (let i = 0; i < nDots; i++) {
    const dz = plateZ - plateL * 0.5 + plateL * (i + 0.5) / nDots;
    const dot = new THREE.Mesh(
      new THREE.BoxGeometry(dotW, dotH, dotL),
      MaterialFactory.get("hazardStripe", ctx)
    );
    dot.position.set(plateX - plateW - 0.01 * s, hullH * 0.05 * (rng() - 0.5) * 2, dz);
    g.add(dot);
  }

  return g;
}
