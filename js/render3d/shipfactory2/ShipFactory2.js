// ShipFactory2.js — 模块化舰船工厂（v2 重构版）
// 仅负责组织调用，自身不含生成逻辑；所有生成由各 Generator 模块完成。
// 对外 API 与旧版 ShipFactory 保持一致：buildShip(options) -> THREE.Group。
//
// 目录结构：
//   ShipFactory2.js     （本文件：编排入口）
//   ShipContext.js      共享数据中心（Phase 2 起：身份/几何/外观/随机/输出注册表）
//   HullGenerator.js    基础船体
//   RibbonGenerator.js  发光能源缝
//   ArmorGenerator.js   航行灯 + 上层建筑
//   PanelGenerator.js   贴合表面装甲板（Phase 4 Commit 1 从 Armor 拆出）
//   GrooveGenerator.js  机械刻槽（Phase 4 Commit 2，Fake Groove）
//   EngineGenerator.js  引擎舱
//   WeaponGenerator.js  武器/护盾（鼻刺 + 结构环 + 浮游炮 + 激光挂点 + 护盾层）
//   Utils.js            预设与几何工具
//   Materials.js        调色板与材质工厂
import * as THREE from "three";
import { COLORS } from "./Materials.js";
import { SHIP_CLASSES } from "./ShipProfile.js";
import { createShipContext } from "./ShipContext.js";
import { generateHull } from "./HullGenerator.js";
import { generateArmor } from "./ArmorGenerator.js";
import { generatePanels } from "./PanelGenerator.js";
import { generateGrooves } from "./GrooveGenerator.js";
import { generateRibbons } from "./RibbonGenerator.js";
import { generateEngines } from "./EngineGenerator.js";
import { generateWeapons } from "./WeaponGenerator.js";

export function buildShip(spec = {}) {
  // Phase 2：临时 ctx 对象已正式化为 ShipContext（见 ShipContext.js）
  const ctx = createShipContext(spec);

  const ship = new THREE.Group();
  ship.name = spec.id || spec.hull || "ship";
  ship.userData = { spec: ctx.spec, role: ctx.role, family: ctx.family, palette: ctx.palette };

  // ── 依次组装各子系统（每个返回独立 THREE.Group）──
  // 编排顺序：结构层（Hull/Armor/Panel/Groove）→ 能源层（Ribbon）→ 功能层（Weapons/Engines）
  const parts = [
    generateHull(ctx),
    generateArmor(ctx),
    generatePanels(ctx),
    generateGrooves(ctx),
    generateRibbons(ctx),
    generateWeapons(ctx),
    generateEngines(ctx)
  ];
  for (const part of parts) ship.add(part);

  // ── 汇总子 Group 的 userData（floaters / shield）到 ship，供动画使用 ──
  for (const part of parts) {
    if (part.userData && part.userData.floaters) {
      if (!ship.userData.floaters) ship.userData.floaters = [];
      ship.userData.floaters.push(...part.userData.floaters);
    }
    if (part.userData && part.userData.shield) ship.userData.shield = part.userData.shield;
  }

  return ship;
}

// 透出便于原型页/外部直接取用
export { COLORS, SHIP_CLASSES };
