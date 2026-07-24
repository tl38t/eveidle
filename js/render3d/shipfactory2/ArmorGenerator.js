// ArmorGenerator.js — 航行灯与舰级专属上层建筑
// 职责：返回包含「航行灯 + 各舰级专属架构(dagger/gunboat/cruiser/fortress) + 混血红色武装」的 THREE.Group。
// （Phase 4 Commit 1：贴合表面的装甲板已拆分至 PanelGenerator.js，本文件只保留上层建筑与灯饰。）
// （Commit 2：删除本地 R(z) 与 Utils.preset_mid，统一走 ctx.radiusAt / ctx.hullProfile.mid）
import * as THREE from "three";
import { rbox, addPart } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

// 护卫：紧凑，无额外大型构件（靠环和双刺就够了）
function buildDaggerExtras(g, s, L, accentMat, spec, mid, ctx, t) {}

// 驱逐：前突喙锥 + 轻量中段模块（低矮化，避免积木感）
function buildGunboatExtras(g, s, L, accentMat, spec, mid, ctx, t) {
  const hybrid = !!spec.hybrid;
  addPart(g, new THREE.ConeGeometry(mid * 0.5 * t, 1.1 * s * t, 16),
    MaterialFactory.get("armorPrimary", ctx), [0, 0, -L * 0.5 - 0.5 * s * t], [Math.PI / 2, 0, 0]);
  const stackY = 0.16 * s;
  g.add(rbox(L * 0.18, 0.22 * s * t, 0.50 * s * t, 0.03 * s,
    MaterialFactory.get("armorDeck", ctx), [0.12 * s, stackY, -0.08 * L]));
  g.add(rbox(L * 0.10, 0.26 * s * t, 0.30 * s * t, 0.025 * s,
    hybrid ? MaterialFactory.get("hybridAccent", ctx, { emissiveIntensity: 0.35 }) : accentMat,
    [0.18 * s, stackY + 0.20 * s, -0.10 * L]));
}

// 巡洋：薄脊甲板（不再用大塔楼）
function buildCruiserExtras(g, s, L, accentMat, spec, mid, ctx, t) {
  const hybrid = !!spec.hybrid;
  const deckMat = MaterialFactory.get("armorDeck", ctx);
  g.add(rbox(L * 0.30, 0.13 * s * t, 0.35 * s, 0.03 * s * t, deckMat,
    [0.06 * s, mid * s * 0.58 * t, -0.02 * L]));
  g.add(rbox(L * 0.10, 0.18 * s * t, 0.22 * s, 0.025 * s,
    hybrid ? MaterialFactory.get("hybridAccent", ctx, { emissiveIntensity: 0.4 }) : accentMat,
    [0.10 * s, mid * s * 0.72 * t, -0.05 * L]));
}

// 战列：低矮城郭甲板（不再用巨型堡垒盒子）
function buildFortressExtras(g, s, L, accentMat, mid, ctx, t) {
  const deckMat = MaterialFactory.get("armorFortress", ctx);
  g.add(rbox(L * 0.28, 0.20 * s * t, mid * s * 0.65, 0.04 * s * t,
    deckMat, [0.08 * s, mid * s * 0.35 * t, 0.02 * L]));
  for (const side of [-1, 1]) {
    g.add(rbox(L * 0.18 * t, 0.10 * s * t, mid * s * 0.40, 0.03 * s * t,
      deckMat, [side * (mid * s * 0.70), 0.06 * s * t, 0.06 * L]));
  }
}

// 混血专属红色武装（Phase 5 C4-A：t = armorThickness factor）
function buildHybridExtras(g, s, L, mid, ctx, t) {
  const redMat = MaterialFactory.get("hybridRed", ctx, { emissiveIntensity: 0.45 });
  const redGlow = MaterialFactory.getGlow("hybridGlow", ctx, 1.8);
  addPart(g, new THREE.ConeGeometry(mid * 0.8 * t, 2.2 * s * t, 16), redMat,
    [0, 0, -L * 0.5 - 1.0 * s * t], [Math.PI / 2, 0, 0]);
  g.add(rbox(0.07 * s, 1.1 * s * t, 2.2 * s * t, 0.02 * s, redMat, [0, 0.7 * s * t, 0.1 * L], [0, 0, 0.3]));
  addPart(g, new THREE.BoxGeometry(0.1 * s, 0.1 * s, L * 0.68), redGlow, [0, 0.34 * s * t, 0.02 * L]);
  for (const exx of [-0.9 * s, 0.9 * s]) {
    addPart(g, new THREE.CylinderGeometry(0.3 * s * t, 0.34 * s * t, 0.55 * s * t, 16), redMat,
      [exx, -0.06 * s, L * 0.5], [Math.PI / 2, 0, 0]);
  }
}

export function generateArmor(ctx) {
  const { s, L, accentMat, hybrid, spec } = ctx;
  const mid = ctx.hullProfile.mid;

  // Phase 5 C4-A：armorThickness 控制装甲厚重感
  //   归一化：player_shield=0.5 → factor=1.0（基准），armor=0.8 → 1.6x，structure=0.3 → 0.6x
  const thickness = ctx.style.armorThickness;
  const t = Math.max(0.4, Math.min(2.0, thickness / 0.5));

  const g = new THREE.Group();
  g.name = "armor";

  // ① 航行灯（翼尖/鼻/尾的微小辉光点）—— 尺寸随 armorThickness 缩放
  const nav = MaterialFactory.getGlow("nav", ctx);
  const navRadius = 0.05 * s * Math.sqrt(t);  // sqrt 压缩极端值
  const navGeom = new THREE.SphereGeometry(navRadius, 8, 6);
  const navPts = [
    [-0.5 * s + ctx.hullProfile.wingSpan * s * 0.45 * Math.cos(0.42), 0, -0.1 * L + ctx.hullProfile.wingSpan * s * 0.45 * Math.sin(0.42) + 0.4 * s],
    [0.5 * s + ctx.hullProfile.wingSpan * s * 0.45 * Math.cos(0.42), 0, -0.1 * L + ctx.hullProfile.wingSpan * s * 0.45 * Math.sin(0.42) + 0.4 * s],
    [0, 0.1 * s, -L * 0.46], [0, 0.08 * s, L * 0.46]
  ];
  for (const [x, y, z] of navPts) {
    const m = new THREE.Mesh(navGeom, nav);
    m.position.set(x, y, z);
    g.add(m);
  }

  // ② 各舰级专属架构（Phase 5 C4-A：t = armorThickness factor）
  //   结构船（frame）跳过实心上层建筑盒子（城郭/脊甲板等），保持桁架通透，仅保留航行灯
  const isFrame = ctx.civ && ctx.civ.hullType === "frame";
  if (!isFrame) {
    if (ctx.hullProfile.body === "dagger") buildDaggerExtras(g, s, L, accentMat, spec, mid, ctx, t);
    else if (ctx.hullProfile.body === "gunboat") buildGunboatExtras(g, s, L, accentMat, spec, mid, ctx, t);
    else if (ctx.hullProfile.body === "cruiser") buildCruiserExtras(g, s, L, accentMat, spec, mid, ctx, t);
    else if (ctx.hullProfile.body === "fortress") buildFortressExtras(g, s, L, accentMat, mid, ctx, t);
    if (hybrid) buildHybridExtras(g, s, L, mid, ctx, t);
  }

  return g;
}
