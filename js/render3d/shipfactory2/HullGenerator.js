// HullGenerator.js — 基础船体（Hull）
// 职责：返回包含「车削船体 + 中央脊线饰条 + 舰桥窗 + 后掠翼 + 翼缘辉光」的 THREE.Group。
// 不处理发光缝（RibbonGenerator）/ 装甲板（ArmorGenerator）/ 武器环（WeaponGenerator）。
// 船体形状数据来自 ctx.profile.hull（Phase 3），不依赖任何预设文件（AI Rules §19）。
import * as THREE from "three";
import { rbox } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";
import { latheHull } from "./Utils.js";

export function generateHull(ctx) {
  const hull = ctx.profile.hull;
  const { s, L, hullMat, darkMat, glassMat, steelMat, palette } = ctx;
  const g = new THREE.Group();
  g.name = "hull";

  // ══ 基础船体（修长棱角剖面）═
  g.add(new THREE.Mesh(latheHull(L, hull.noseFat, hull.mid, hull.tail), hullMat));

  // ══ 中央脊线饰条（深蓝灰，沿背脊，细长低调）═
  g.add(rbox(L * 0.72, 0.036 * s, 0.07 * s, 0.018 * s, darkMat,
    [0, hull.mid * s * 0.92, -0.02 * L]));

  // ══ 舰桥窗（小型发光区——大船上也要保持小巧，上限封顶）═
  const bridgeR = Math.min(0.10 * s, 0.12);
  const bridge = new THREE.Mesh(new THREE.SphereGeometry(bridgeR, 12, 10), glassMat);
  bridge.position.set(-0.08 * s, Math.max(0.18 * s, bridgeR + 0.04 * s), -L * 0.28);
  g.add(bridge);
  // 记录 HullGenerator 实际从 ctx.profile.hull 读取的形状参数（供 Profile Consistency Test 比对）。
  // 这把「生成器消费了哪些 DNA 字段」显式固化，若以后误回退到 HULL_PRESETS 或字段错配都会被测试捕获。
  g.userData.hullRead = {
    len: hull.len,
    noseFat: hull.noseFat,
    mid: hull.mid,
    tail: hull.tail,
    wingSpan: hull.wingSpan
  };

  return g;
}
