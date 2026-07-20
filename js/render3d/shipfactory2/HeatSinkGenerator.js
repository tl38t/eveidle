// HeatSinkGenerator.js — 散热结构（Phase 4 Commit 3）
// 职责：返回包含「贴合表面的散热片组」的 THREE.Group。
//   代表热管理系统，位于引擎前方船体表面。
//
// 设计原则：
//   - 不是装饰片，是功能型表面组件（热管理）
//   - 位置来自 ctx._engineHeatPoints（ShipFactory2 Anchor Bus 预计算）
//   - HeatSink 自己不找位置——消费上游 Anchor
//   这是 ShipFactory2 从「随机模型生成器」迈向「舰船设计系统」的关键一步。
//
// 第一版实现：Base plate + thin fins，BoxGeometry 组合。
//   遵循 AI Rules §5（单一职责，返回 Group，无全局状态）
//   §6（材质走 Materials.js）§19（不 import 配置）。
import * as THREE from "three";
import { rbox, material } from "./Materials.js";

export function generateHeatSinks(ctx) {
  const { s, L, palette, _engineHeatPoints } = ctx;
  const rng = ctx.scope("heatSink").random;

  const g = new THREE.Group();
  g.name = "heatSinks";

  const baseMat = material(palette.dark, 0.92, 0.35);
  const finMat = material(palette.steel, 0.88, 0.42);

  const heatPoints = _engineHeatPoints || [];
  if (heatPoints.length === 0) return g;

  for (const hp of heatPoints) {
    // ── 散热片位置：引擎前方船体顶部表面 ──
    const sinkZ = hp.z - 0.09 * L;          // 引擎前方
    const hullR = ctx.radiusAt(sinkZ);
    const sinkY = hullR * 0.88;             // 船体顶部

    // ── 基板：贴合表面的扁平矩形 ──
    const bw = hp.radius * 2.2;             // X 宽度
    const bd = hp.radius * 1.2;             // Z 深度
    const bt = 0.025 * s;                   // Y 厚度（薄）

    const base = rbox(bw, bt, bd, 0.008 * s, baseMat,
      [hp.x, sinkY, sinkZ]);
    g.add(base);

    // ── 散热鳍片：基板上方的薄垂直板 ──
    const finCount = 4 + Math.floor(rng() * 2); // 4~5 片
    const finT = 0.012 * s;                     // 鳍片厚度
    const finH = hp.radius * 0.38;              // 鳍片高度（背离船体）
    const finSpan = bd * 0.75;                  // 鳍片分布范围（Z 方向）
    const step = finSpan / (finCount - 1);

    for (let i = 0; i < finCount; i++) {
      const fz = sinkZ - finSpan * 0.5 + i * step;
      const fin = rbox(bw * 0.88, finH, finT, 0.004 * s, finMat,
        [hp.x, sinkY + bt + finH * 0.5, fz]);
      g.add(fin);
    }
  }

  return g;
}
