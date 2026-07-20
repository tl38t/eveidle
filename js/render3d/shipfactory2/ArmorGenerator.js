// ArmorGenerator.js — 航行灯与舰级专属上层建筑
// 职责：返回包含「航行灯 + 各舰级专属架构(dagger/gunboat/cruiser/fortress) + 混血红色武装」的 THREE.Group。
// （Phase 4 Commit 1：贴合表面的装甲板已拆分至 PanelGenerator.js，本文件只保留上层建筑与灯饰。）
// （Commit 2：删除本地 R(z) 与 Utils.preset_mid，统一走 ctx.radiusAt / ctx.hullProfile.mid）
import * as THREE from "three";
import { rbox, material, glowMat, addPart, COLORS } from "./Materials.js";

// 护卫：紧凑，无额外大型构件（靠环和双刺就够了）
function buildDaggerExtras() {}

// 驱逐：前突喙锥 + 轻量中段模块（低矮化，避免积木感）
function buildGunboatExtras(g, s, L, palette, accentMat, spec, mid) {
  const hybrid = !!spec.hybrid;
  addPart(g, new THREE.ConeGeometry(mid * 0.5, 1.1 * s, 16),
    material(palette.hull, 0.86, 0.32), [0, 0, -L * 0.5 - 0.5 * s], [Math.PI / 2, 0, 0]);
  const stackY = 0.16 * s;
  g.add(rbox(L * 0.18, 0.22 * s, 0.50 * s, 0.03 * s,
    material(palette.hull, 0.87, 0.32), [0.12 * s, stackY, -0.08 * L]));
  g.add(rbox(L * 0.10, 0.26 * s, 0.30 * s, 0.025 * s,
    hybrid ? material(COLORS.angel.hull, 0.84, 0.34, COLORS.angel.glow, 0.35) : accentMat,
    [0.18 * s, stackY + 0.20 * s, -0.10 * L]));
}

// 巡洋：薄脊甲板（不再用大塔楼）
function buildCruiserExtras(g, s, L, palette, accentMat, spec, mid) {
  const hybrid = !!spec.hybrid;
  const deckMat = material(palette.hull, 0.87, 0.32);
  g.add(rbox(L * 0.30, 0.13 * s, 0.35 * s, 0.03 * s, deckMat,
    [0.06 * s, mid * s * 0.58, -0.02 * L]));
  g.add(rbox(L * 0.10, 0.18 * s, 0.22 * s, 0.025 * s,
    hybrid ? material(COLORS.angel.hull, 0.84, 0.34, COLORS.angel.glow, 0.4) : accentMat,
    [0.10 * s, mid * s * 0.72, -0.05 * L]));
}

// 战列：低矮城郭甲板（不再用巨型堡垒盒子）
function buildFortressExtras(g, s, L, palette, accentMat, mid) {
  const deckMat = material(palette.hull, 0.88, 0.32);
  g.add(rbox(L * 0.28, 0.20 * s, mid * s * 0.65, 0.04 * s,
    deckMat, [0.08 * s, mid * s * 0.35, 0.02 * L]));
  for (const side of [-1, 1]) {
    g.add(rbox(L * 0.18, 0.10 * s, mid * s * 0.40, 0.03 * s,
      deckMat, [side * (mid * s * 0.70), 0.06 * s, 0.06 * L]));
  }
}

// 混血专属红色武装
function buildHybridExtras(g, s, L, mid) {
  const ap = COLORS.angel;
  const redMat = material(ap.hull, 0.84, 0.34, ap.glow, 0.45);
  const redGlow = glowMat(ap, 1.8);
  addPart(g, new THREE.ConeGeometry(mid * 0.8, 2.2 * s, 16), redMat,
    [0, 0, -L * 0.5 - 1.0 * s], [Math.PI / 2, 0, 0]);
  g.add(rbox(0.07 * s, 1.1 * s, 2.2 * s, 0.02 * s, redMat, [0, 0.7 * s, 0.1 * L], [0, 0, 0.3]));
  addPart(g, new THREE.BoxGeometry(0.1 * s, 0.1 * s, L * 0.68), redGlow, [0, 0.34 * s, 0.02 * L]);
  for (const exx of [-0.9 * s, 0.9 * s]) {
    addPart(g, new THREE.CylinderGeometry(0.3 * s, 0.34 * s, 0.55 * s, 16), redMat,
      [exx, -0.06 * s, L * 0.5], [Math.PI / 2, 0, 0]);
  }
}

export function generateArmor(ctx) {
  const { s, L, palette, accentMat, hybrid, spec } = ctx;
  const mid = ctx.hullProfile.mid;

  const g = new THREE.Group();
  g.name = "armor";

  // ① 航行灯（翼尖/鼻/尾的微小辉光点）
  const nav = glowMat({ glow: palette.glow }, 2.6);
  const navPts = [
    [-0.5 * s + ctx.hullProfile.wingSpan * s * 0.45 * Math.cos(0.42), 0, -0.1 * L + ctx.hullProfile.wingSpan * s * 0.45 * Math.sin(0.42) + 0.4 * s],
    [0.5 * s + ctx.hullProfile.wingSpan * s * 0.45 * Math.cos(0.42), 0, -0.1 * L + ctx.hullProfile.wingSpan * s * 0.45 * Math.sin(0.42) + 0.4 * s],
    [0, 0.1 * s, -L * 0.46], [0, 0.08 * s, L * 0.46]
  ];
  for (const [x, y, z] of navPts) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 8, 6), nav);
    m.position.set(x, y, z);
    g.add(m);
  }

  // ② 各舰级专属架构
  if (ctx.hullProfile.body === "dagger") buildDaggerExtras(g, s, L, palette, accentMat, spec, mid);
  else if (ctx.hullProfile.body === "gunboat") buildGunboatExtras(g, s, L, palette, accentMat, spec, mid);
  else if (ctx.hullProfile.body === "cruiser") buildCruiserExtras(g, s, L, palette, accentMat, spec, mid);
  else if (ctx.hullProfile.body === "fortress") buildFortressExtras(g, s, L, palette, accentMat, mid);
  if (hybrid) buildHybridExtras(g, s, L, mid);

  return g;
}
