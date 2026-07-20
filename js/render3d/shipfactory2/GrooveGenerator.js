// GrooveGenerator.js — 机械刻槽（Fake Groove / 视觉凹槽）
// 职责：返回包含「贴合表面的暗色凹槽线」的 THREE.Group。
//
// 与 RibbonGenerator 的边界划分（Phase 4 Commit 2）：
//   Ribbon = 能源视觉语言（emissive / glow / 颜色 / 动画）——「能量导管」
//   Groove = 工程制造语言（装甲接缝 / 机械加工槽 / 结构分割线）——「表面被切开」
//
// 实现方式：Fake Groove（游戏工业标准）
//   不做 boolean 凹槽（慢 / 容易炸拓扑 / 不适合大量船），
//   而是用 dark Ribbon Mesh + 轻微 offset 模拟视觉凹陷。
//
// 材质区别：
//   Ribbon: glow material, emissive=high, roughness=low, width=small → 发光
//   Groove: dark metal, emissive=0, roughness=0.8, width=larger → 阴影缝
//
// Seed 隔离：ctx.scope("groove") 确保 groove 的随机不影响其他 Generator。
// 编排顺序：Hull → Armor → Panel → Groove → Ribbon（结构层在能源层之下）。
//
// 不依赖任何配置文件（AI Rules §19），只读 ctx。
import * as THREE from "three";
import { MaterialFactory } from "./MaterialFactory.js";

// 按舰级推导 groove 数量（frigate 少 / battleship 多）
const BODY_GROOVES = { dagger: 3, gunboat: 5, cruiser: 7, fortress: 9 };

export function generateGrooves(ctx) {
  const { L } = ctx;
  const hull = ctx.profile.hull;
  const g = new THREE.Group();
  g.name = "grooves";

  // 暗色金属材质：emissive=0, roughness=0.8, metalness 低（视觉凹陷感）
  const grooveMat = MaterialFactory.get("groove", ctx);
  grooveMat.polygonOffset = true;          // 防止与船体 z 冲突
  grooveMat.polygonOffsetFactor = -1;
  grooveMat.polygonOffsetUnits = -1;
  grooveMat.side = THREE.DoubleSide;

  // 隔离的随机子流（seed 变化只影响 groove，不串扰其他 Generator）
  const rng = ctx.scope("groove").random;

  // ── Groove 角度分布（对称，顶部必有一条）──
  // Phase 5 C3-A：grooveDensity 控制刻槽数量
  const baseCount = BODY_GROOVES[hull.body] || 5;
  const count = Math.max(2, Math.round(baseCount * ctx.style.grooveDensity));
  const angles = [0]; // 顶部中线
  for (let i = 0; i < Math.floor(count / 2); i++) {
    const a = 0.35 + rng() * 0.85; // 0.35~1.20 弧度
    angles.push(a, -a);            // 左右对称
  }

  // ── 每条 groove：沿 z 轴的 Ribbon Mesh，贴合表面 ──
  const N = 24;
  const z0 = -0.42 * L, z1 = 0.42 * L;
  const halfW = 0.022; // 半角宽（比发光缝稍宽 → 视觉凹陷感更强）

  for (const phi of angles) {
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const z = z0 + (z1 - z0) * (i / N);
      const off = ctx.radiusAt(z) * 0.006; // 略高于表面，避免 z-fighting
      const pL = ctx.sampleHullSurface(z, phi - halfW, off);
      const pR = ctx.sampleHullSurface(z, phi + halfW, off);
      pos.push(pL.x, pL.y, pL.z, pR.x, pR.y, pR.z);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, grooveMat));
  }

  return g;
}
