// ShipFactory2.js — 模块化舰船工厂（v2 重构版）
// 仅负责组织调用，自身不含生成逻辑；所有生成由各 Generator 模块完成。
// 对外 API 与旧版 ShipFactory 保持一致：buildShip(options) -> THREE.Group。
//
// Phase 4 Commit 3：引入 Generator 间 Anchor 传递机制。
//   ShipFactory2 作为 Anchor Bus：预计算引擎位置 → 注入 ctx → Generator 消费；
//   PanelGenerator 产出 panelInfos → ShipFactory2 提取 → HatchGenerator 消费。
//   这是 ShipFactory2 从「随机模型生成器」迈向「舰船设计系统」的关键一步。
//
// 目录结构：
//   ShipFactory2.js      （本文件：编排入口 + Anchor Bus）
//   ShipContext.js        共享数据中心（身份/几何/外观/随机）
//   HullGenerator.js      基础船体
//   ArmorGenerator.js     航行灯 + 上层建筑
//   PanelGenerator.js     贴合表面装甲板 + panelInfos Anchor
//   GrooveGenerator.js    机械刻槽（Fake Groove）
//   HeatSinkGenerator.js  散热结构（Phase 4 Commit 3，依附 Engine）
//   HatchGenerator.js     维护舱门（Phase 4 Commit 3，依附 Panel）
//   RibbonGenerator.js    发光能源缝
//   WeaponGenerator.js    武器/护盾
//   EngineGenerator.js    引擎舱 + heatPoints Anchor
//   Utils.js              几何工具
//   Materials.js          调色板与材质工厂
import * as THREE from "three";
import { COLORS } from "./Materials.js";
import { SHIP_CLASSES } from "./ShipProfile.js";
import { createShipContext } from "./ShipContext.js";
import { generateHull } from "./HullGenerator.js";
import { generateArmor } from "./ArmorGenerator.js";
import { generatePanels } from "./PanelGenerator.js";
import { generateGrooves } from "./GrooveGenerator.js";
import { generateHeatSinks } from "./HeatSinkGenerator.js";
import { generateHatches } from "./HatchGenerator.js";
import { generateRibbons } from "./RibbonGenerator.js";
import { generateWeapons } from "./WeaponGenerator.js";
import { generateEngines } from "./EngineGenerator.js";

export function buildShip(spec = {}) {
  const ctx = createShipContext(spec);

  // ── Anchor Bus：预计算引擎位置（Phase 4 Commit 3）──
  // EngineGenerator 和 HeatSinkGenerator 共享同一组引擎位置。
  // 从 profile.hull 推导，与 EngineGenerator 原有逻辑完全一致。
  // 这是 Generator 间数据传递的第一步：ShipFactory2 作为唯一定位仲裁者。
  const hull = ctx.profile.hull;
  let engineXs;
  if (hull.body === "gunboat") engineXs = [-0.9 * ctx.s, 0.9 * ctx.s];
  else if (hull.engines === 3) engineXs = [-0.65 * ctx.s, 0, 0.65 * ctx.s];
  else engineXs = [-0.5 * ctx.s, 0.5 * ctx.s];

  ctx._engineHeatPoints = engineXs.map(ex => ({
    x: ex,
    y: -0.08 * ctx.s,
    z: ctx.L * 0.5,
    radius: 0.24 * ctx.s
  }));

  const ship = new THREE.Group();
  ship.name = spec.id || spec.hull || "ship";
  ship.userData = { spec: ctx.spec, role: ctx.role, family: ctx.family, palette: ctx.palette };

  // ── 依次组装各子系统（每个返回独立 THREE.Group）──
  // Phase 4 Commit 3 编排顺序（结构层 → 机械层 → 能源层 → 功能层）：
  //   Hull → Armor → Panel → Groove → HeatSink → Hatch → Ribbon → Weapon → Engine
  const parts = [];

  // 结构层
  parts.push(generateHull(ctx));
  parts.push(generateArmor(ctx));

  // Panel：产出 panelInfos Anchor 供 HatchGenerator 消费
  const panelGroup = generatePanels(ctx);
  parts.push(panelGroup);
  if (panelGroup.userData && panelGroup.userData.panelInfos) {
    ctx._panelInfos = panelGroup.userData.panelInfos;
  }

  // 机械层（Phase 4 Commit 3 新增）
  parts.push(generateGrooves(ctx));
  parts.push(generateHeatSinks(ctx));
  parts.push(generateHatches(ctx));

  // 能源层
  parts.push(generateRibbons(ctx));

  // 功能层
  parts.push(generateWeapons(ctx));

  // Engine：从 ctx._engineHeatPoints 读取引擎位置（不再内部计算）
  const engineGroup = generateEngines(ctx);
  parts.push(engineGroup);

  for (const part of parts) ship.add(part);

  // ── 汇总子 Group 的 userData（floaters / shield / heatPoints）到 ship ──
  for (const part of parts) {
    if (part.userData && part.userData.floaters) {
      if (!ship.userData.floaters) ship.userData.floaters = [];
      ship.userData.floaters.push(...part.userData.floaters);
    }
    if (part.userData && part.userData.shield) ship.userData.shield = part.userData.shield;
    if (part.userData && part.userData.heatPoints) {
      if (!ship.userData.heatPoints) ship.userData.heatPoints = [];
      ship.userData.heatPoints.push(...part.userData.heatPoints);
    }
  }

  return ship;
}

// 透出便于原型页/外部直接取用
export { COLORS, SHIP_CLASSES };
