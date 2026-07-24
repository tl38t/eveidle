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
//   HeroStructureGenerator.js  大船专属结构（舰桥塔/桅阵/外挂舱/脊甲，仅巡洋/战列）
//   Utils.js              几何工具
//   Materials.js          调色板与材质工厂
import * as THREE from "three";
import { COLORS } from "./Materials.js";
import { SHIP_CLASSES } from "./ShipProfile.js";
import { createShipContext } from "./ShipContext.js";
import { generateHull } from "./HullGenerator.js";
import { applyCivilization } from "./civilization/CivilizationModifier.js";
import { generateArmor } from "./ArmorGenerator.js";
import { generateArmorBlocks } from "./ArmorBlockGenerator.js";
import { generatePanels } from "./PanelGenerator.js";

import { generateGrooves } from "./GrooveGenerator.js";
import { generateHeatSinks } from "./HeatSinkGenerator.js";
import { generateHatches } from "./HatchGenerator.js";
import { generateVents } from "./VentGenerator.js";
import { generateRibbons } from "./RibbonGenerator.js";
import { generateBloodVeins } from "./BloodVeinGenerator.js";
import { generateAngelVeins } from "./AngelVeinGenerator.js";   // 战列舰血袭者专属血祭纹路
import { generateWeapons } from "./WeaponGenerator.js";
import { generateEngines } from "./EngineGenerator.js";
import { generateHeroStructures } from "./HeroStructureGenerator.js";
import { generateSensors } from "./SensorGenerator.js";        // P5 大型组件：传感器阵列
import { generateDroneBay } from "./DroneBayGenerator.js";     // P5 大型组件：无人机机库
import { generateFunctionalMounts } from "./FunctionalMountGenerator.js"; // 功能舰签名挂载（采矿臂/采气采集器/扫描阵列/探针）

export function buildShip(spec = {}) {
  const ctx = createShipContext(spec);

  // ── Anchor Bus：预计算引擎位置（Phase 4 Commit 3）──
  const hull = ctx.profile.hull;
  if (ctx.civ && ctx.civ.hullType === "frame") {
    // Structure 棱柱尾：三引擎三角簇（品字形），同轴于船体中心线（y=0），落在尾部开放框架环内。
    // 原单引擎对大船显小；改成「三个一捆」后整体推进器组明显更大，且呼应骨架外露语言。
    // 尾环半径与 SkeletalHull 一致：baseR*frameExp(0.85)*尾部收缩减率(约0.45)*1.12 ≈ baseR*0.43
    const baseR = ctx.hullProfile.mid * ctx.s * 0.95;   // 与 SkeletalHull.baseR 一致
    const tailRingR = baseR * 0.43;                     // ≈ SkeletalHull 尾部外框环半径
    const d = tailRingR * 0.52;                          // 三角簇顶点到中心距离
    const er = tailRingR * 0.42;                          // 单个引擎半径（簇外接≈d+er<tailRingR）
    const ez = ctx.L * 0.47;                             // 对齐尾环(z=0.46L)略靠前
    // 品字形：上1 + 下2（y 轴向上为正）
    const tri = [[0, d], [-d * 0.87, -d * 0.5], [d * 0.87, -d * 0.5]];
    ctx._engineHeatPoints = tri.map(([px, py]) => ({
      x: px,
      y: py,                                             // 同轴于中心线，三引擎在尾环内品字排布
      z: ez,
      radius: er
    }));
  } else {
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
  }

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
  // Phase 5 Rework 编排顺序（结构层 → 机械层 → 能源层 → 功能层）：
  //   Hull → Civ → Armor → ArmorBlock → Panel → Groove → HeatSink → Hatch → Vent → Ribbon → Weapon → Engine
  //   ArmorBlockGenerator 仅 Player Armor 路线生成（其他族返回空 Group）
  //   Sansha（modular）= 笼子+立方体 主体，启用：武器（顶点炮塔）/ 护盾泡 /
  //     面板（笼面五边形板）/ 能量线（核心→笼供能束）/ P5 大型组件（sensors/droneBay，贴笼面）
  //     禁用：Armor / ArmorBlock / Groove / HeatSink / Hatch / Vent / Engine / Hero / 血脉纹路
  //   功能舰（industrial / archaeology）= 自定义功能船体 + 自绘表面细节 + 签名挂载；
  //     与 modular 同范式禁用依赖 lathe 包络的 surface generator（会浮空/被体腔吸收），
  //     并禁用 Sensors/DroneBay（同样依赖 lathe 表面采样），改由 FunctionalMountGenerator 提供识别度。
  const isModularShip = ctx.civ && ctx.civ.hullType === "modular";
  const isUtilityShip = ctx.civ && (ctx.civ.hullType === "industrial" || ctx.civ.hullType === "archaeology");
  const parts = [];

  // 结构层
  const hullGroup = generateHull(ctx);
  const civGroup = applyCivilization(hullGroup, ctx);
  parts.push(civGroup);

  if (!isModularShip && !isUtilityShip) {
    parts.push(generateArmor(ctx));
    parts.push(generateArmorBlocks(ctx));   // Phase 5 Rework：External Armor Blocks（仅 Armor 路线）
  }

  // Panel：产出 panelInfos Anchor 供 HatchGenerator 消费（sansha 分支 = 笼面五边形板）。
  //   功能舰自绘装甲板（IndustrialHull/ArchaeologyHull），跳过通用 Panel（其默认路径依赖 lathe 包络）。
  if (!isUtilityShip) {
    const panelGroup = generatePanels(ctx);
    parts.push(panelGroup);
    if (panelGroup.userData && panelGroup.userData.panelInfos) {
      ctx._panelInfos = panelGroup.userData.panelInfos;
    }
  }

  // 机械层（Surface Functional Layer — Phase 4 完整）
  if (!isModularShip && !isUtilityShip) parts.push(generateGrooves(ctx));
  if (!isModularShip && !isUtilityShip) parts.push(generateHeatSinks(ctx));
  if (!isModularShip && !isUtilityShip) {
    parts.push(generateHatches(ctx));
    parts.push(generateVents(ctx));   // Phase 4 Commit 4 新增
  }

  // 能源层
  if (!isUtilityShip) parts.push(generateRibbons(ctx));         // sansha 分支 = 核心→笼子供能束
  if (!isModularShip && !isUtilityShip) {
    parts.push(generateBloodVeins(ctx));   // 战列舰血袭者专属血祭纹路（hero 元素）
    parts.push(generateAngelVeins(ctx));   // 巡洋/战列 Angel 冰蓝脉纹（hero 元素）
  }

  // 功能层（护盾泡对所有舰种统一；战斗炮塔仅六族生成，功能舰由 FunctionalMountGenerator 提供挂载）
  parts.push(generateWeapons(ctx));

  if (!isModularShip) {
    // Engine：从 ctx._engineHeatPoints 读取引擎位置（功能舰走默认引擎分支）
    parts.push(generateEngines(ctx));

    if (!isUtilityShip) {
      // 大船专属结构层（仅巡洋/战列生成舰桥塔/桅阵/外挂舱/脊甲）
      parts.push(generateHeroStructures(ctx));
    }
  }

  // ── P5 大型组件（六族通用，Anchor Bus 挂载；严格 X 镜像对称）──
  //   sensors / droneBay 均消费 hull 表面采样（sansha 用笼面），
  //   不依赖 Engine/Panel 等上游 Anchor，故对所有种族统一启用。
  //   （radar / commArray 已于 2026-07-23 移除——视觉不佳，用户决定删除）
  //   功能舰禁用（依赖 lathe 表面采样会浮空），改由 FunctionalMountGenerator 提供扫描阵列/探针/采矿臂。
  if (!isUtilityShip) {
    parts.push(generateSensors(ctx));
    parts.push(generateDroneBay(ctx));
  } else {
    // 功能舰签名挂载（采矿激光臂 / 采气采集器 / 指挥天线 / 扫描阵列 / 探针发射舱）
    parts.push(generateFunctionalMounts(ctx));
  }

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
