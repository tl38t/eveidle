// HatchGenerator.js — 维护舱门（Phase 4 Commit 3）
// 职责：返回包含「矩形维护舱门」的 THREE.Group。
//   依附 PanelGenerator 产出的面板表面，给船加入"人类尺度"。
//
// 设计原则：
//   - 不是随机圆圈，是第一版矩形舱门
//   - 位置来自 ctx._panelInfos（PanelGenerator → ShipFactory2 Anchor Bus → HatchGenerator）
//   - Hatch 自己不找位置——消费上游 Anchor
//   - 每个 panel 上一个舱门，体现"此处有人维护"
//
// 第一版实现：稍小的暗色矩形，贴合 panel 表面。
//   遵循 AI Rules §5/§6/§19。
import * as THREE from "three";
import { rbox } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

export function generateHatches(ctx) {
  const { s, _panelInfos } = ctx;
  const rng = ctx.scope("hatch").random;

  const g = new THREE.Group();
  g.name = "hatches";

  const hatchMat = MaterialFactory.get("hatchDoor", ctx);

  const panelInfos = _panelInfos || [];

  // Phase 5 C3-A：hatchDensity 控制舱门出现概率
  // Phase 5 Rework：hatchSize 控制舱门尺寸倍率（Armor=2.0 巨大入口）
  const hatchChance = Math.min(1.0, 0.7 * ctx.style.hatchDensity); // clamp 防止 >1.0
  const sizeMul = ctx.style.hatchSize || 1.0;

  for (const pi of panelInfos) {
    // ── 舱门出现概率检查 ──
    if (rng() >= hatchChance) continue;

    // ── 舱门尺寸：面板的 40%~55%，体现"人类尺度"（Armor 用 sizeMul 放大）──
    const hw = pi.w * 0.42 * sizeMul;
    const hd = pi.d * 0.55 * sizeMul;
    const ht = 0.018 * s; // 薄，略凸出面板表面

    // ── 向外偏移：沿面板法线方向 ──
    const ox = Math.sin(pi.phi);
    const oy = Math.cos(pi.phi);
    const off = 0.024 * s;

    const hatch = rbox(hw, ht, hd, 0.008 * s, hatchMat,
      [pi.x + ox * off, pi.y + oy * off, pi.z]);
    hatch.rotation.z = -pi.phi; // 与所在面板相同朝向

    g.add(hatch);

    // ── 舱门把手（微小的横向暗色条，强调"可操作"）──
    if (rng() > 0.3) {
      const handleW = hw * 0.55;
      const handleH = 0.008 * s;
      const handleD = hd * 0.15;
      const handle = rbox(handleW, handleH, handleD, 0.003 * s,
        MaterialFactory.get("hatchHandle", ctx),
        [pi.x + ox * (off + ht), pi.y + oy * (off + ht), pi.z + hd * 0.2]);
      handle.rotation.z = -pi.phi;
      g.add(handle);
    }
  }

  return g;
}
