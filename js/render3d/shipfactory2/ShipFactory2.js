// ShipFactory2.js — 模块化舰船工厂（v2 重构版）
// 仅负责组织调用，自身不含生成逻辑；所有生成由各 Generator 模块完成。
// 对外 API 与旧版 ShipFactory 保持一致：buildShip(options) -> THREE.Group。
//
// Phase 5 Rework：Civilization Identity Layer。
//   HullGenerator（Shield 基线）→ CivilizationModifier（六族 hull 语言）→ ArmorGenerator → ...
//
// 目录结构：
//   ShipFactory2.js      （本文件：编排入口 + Anchor Bus）
//   ShipContext.js        共享数据中心（身份/几何/外观/随机）
//   HullGenerator.js      基础船体
//   ArmorGenerator.js     航行灯 + 上层建筑
//   PanelGenerator.js     贴合表面装甲板 + panelInfos Anchor
//   GrooveGenerator.js    机械刻槽（Fake Groove）
//   HeatSinkGenerator.js  散热结构（Phase 4 C3，依附 Engine）
//   HatchGenerator.js     维护舱门（Phase 4 C3，依附 Panel）
//   VentGenerator.js      通风/冷却格栅（Phase 4 C4，依附 Engine + Hull）
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
import { applyCivilization } from "./civilization/CivilizationModifier.js";
import { generateArmor } from "./ArmorGenerator.js";
import { generatePanels } from "./PanelGenerator.js";

import { generateGrooves } from "./GrooveGenerator.js";
import { generateHeatSinks } from "./HeatSinkGenerator.js";
import { generateHatches } from "./HatchGenerator.js";
import { generateVents } from "./VentGenerator.js";
import { generateRibbons } from "./RibbonGenerator.js";
import { generateWeapons } from "./WeaponGenerator.js";
import { generateEngines } from "./EngineGenerator.js";

export function buildShip(spec = {}) {
  const ctx = createShipContext(spec);

  // ── Anchor Bus：预计算引擎位置（Phase 4 Commit 3）──
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

  // ── Anchor Bus：预计算通风/冷却格栅位置（Phase 4 Commit 4）──
  // Vent 依附引擎热区（冷却进出）和船体中段（压力管理）。
  // 每个 vent point：{x, y, z, nx, ny, nz, size} — 表面位置 + 法线 + 尺寸。
  const ventPoints = [];

  // ① 引擎热区 vents：每个引擎前方 + 侧面的冷却格栅
  for (const hp of ctx._engineHeatPoints) {
    const ventZ = hp.z - 0.13 * ctx.L;  // 引擎前方
    const hullR = ctx.radiusAt(ventZ);
    // 顶面 vent（冷却进气）—— 贴 hull 表面 + 微量偏移防 z-fighting
    ventPoints.push({
      x: hp.x, y: hullR + 0.004 * ctx.s, z: ventZ,
      nx: 0, ny: 1, nz: 0,
      size: hp.radius * 1.6
    });
    // 侧面 vent（排热出气），仅外侧引擎
    if (Math.abs(hp.x) > 0.01) {
      const sign = hp.x > 0 ? 1 : -1;
      ventPoints.push({
        x: hp.x + sign * (hullR + 0.008 * ctx.s),
        y: hullR * 0.35, z: ventZ,
        nx: sign, ny: 0, nz: 0,
        size: hp.radius * 1.1
      });
    }
  }

  // ② 船体中段 vents：沿 hull 分布的冷却/压力管理格栅
  const bodyVentZones = [0.22 * ctx.L, 0.05 * ctx.L, -0.12 * ctx.L];
  for (const bvz of bodyVentZones) {
    const hullR = ctx.radiusAt(bvz);
    if (hullR < 0.15 * ctx.s) continue; // 太细的截面跳过
    // 顶面中段 vent — 贴 hull 表面
    ventPoints.push({
      x: 0, y: hullR + 0.004 * ctx.s, z: bvz,
      nx: 0, ny: 1, nz: 0,
      size: hullR * 1.0
    });
  }

  ctx._ventPoints = ventPoints;

  const ship = new THREE.Group();
  ship.name = spec.id || spec.hull || "ship";
  ship.userData = { spec: ctx.spec, role: ctx.role, family: ctx.family, palette: ctx.palette };

  // ── 依次组装各子系统 ──
  // Phase 4 完成版编排顺序（结构层 → 机械层 → 能源层 → 功能层）：
  //   Hull → Armor → Panel → Groove → HeatSink → Hatch → Vent → Ribbon → Weapon → Engine
  const parts = [];

  // 结构层
  const hullGroup = generateHull(ctx);
  const civGroup = applyCivilization(hullGroup, ctx);
  parts.push(civGroup);
  parts.push(generateArmor(ctx));

  // Panel：产出 panelInfos Anchor 供 HatchGenerator 消费
  const panelGroup = generatePanels(ctx);
  parts.push(panelGroup);
  if (panelGroup.userData && panelGroup.userData.panelInfos) {
    ctx._panelInfos = panelGroup.userData.panelInfos;
  }

  // 机械层（Surface Functional Layer — Phase 4 完整）
  parts.push(generateGrooves(ctx));
  parts.push(generateHeatSinks(ctx));
  parts.push(generateHatches(ctx));
  parts.push(generateVents(ctx));   // Phase 4 Commit 4 新增

  // 能源层
  parts.push(generateRibbons(ctx));

  // 功能层
  parts.push(generateWeapons(ctx));

  // Engine：从 ctx._engineHeatPoints 读取引擎位置
  const engineGroup = generateEngines(ctx);
  parts.push(engineGroup);

  for (const part of parts) ship.add(part);

  // ── 汇总子 Group 的 userData 到 ship ──
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
