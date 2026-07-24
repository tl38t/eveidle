// EngineGenerator.js — 引擎舱与尾焰
// 职责：返回包含「引擎舱（按舰级布局）+ 尾焰辉光」的 THREE.Group。
//
// Phase 4 Commit 3：引擎位置由 ShipFactory2（Anchor Bus）从 profile 预计算，
//   通过 ctx._engineHeatPoints 统一注入，EngineGenerator 不再内部推导。
//   同时将 heatPoints 写入 group.userData.heatPoints 作为声明。
import * as THREE from "three";
import { addPart } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

// 按舰级放大引擎（用户反馈：战列舰尾部推进器太小）
// 直径随舰级放大；长度只放大约一半，避免大船引擎过胖过短不协调。
function engineClassScale(ctx) {
  const cls = (ctx.spec && ctx.spec.hull) || "";
  if (cls.includes("capital")) return 2.2;   // 旗舰/工业旗舰/考古旗舰
  if (cls.includes("battleship")) return 1.7;
  if (cls.includes("cruiser")) return 1.35;
  if (cls.includes("destroyer")) return 1.15;
  return 1.0; // frigate
}

function addEngine(group, x, y, z, radius, ctx, length = 1.6) {
  const s = ctx.s;
  const isArmor = ctx.civ && ctx.civ.hullType === "box";
  const isFrame = ctx.civ && ctx.civ.hullType === "frame";
  const isOrganic = ctx.civ && ctx.civ.hullType === "organic";
  const clsSc = engineClassScale(ctx);
  // Frame（Structure）：引擎同轴含于尾环，半径/长度直接由尾环尺寸推导，不再乘舰级系数
  const r = isFrame ? radius : radius * clsSc * (isArmor ? 1.25 : 1);
  const engLen = isFrame ? radius * 3.6 : length * (1 + (clsSc - 1) * 0.5) * (isArmor ? 1.15 : 1);

  const casing = MaterialFactory.get("engineCasing", ctx);
  const steel = MaterialFactory.get("engineRing", ctx);
  const glow = MaterialFactory.getGlow("engine", ctx, 1.6);

  // ══ Frame（Structure）专属：外露框架引擎 ══
  // 无外壳：中央发光反应器 + 环框 + 辐条，配合骨架舰的开放尾部，可见内部。
  if (isFrame) {
    const rings = 4;
    for (let i = 0; i < rings; i++) {
      const f = i / (rings - 1);
      const ringR = r * (0.65 + 0.35 * f);
      addPart(group, new THREE.TorusGeometry(ringR, 0.05 * s, 6, 12), steel, [x, y, z + f * engLen], [Math.PI / 2, 0, 0]);
    }
    addPart(group, new THREE.SphereGeometry(r * 0.55, 14, 12), glow, [x, y, z + engLen * 0.5]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(r * 0.95, 0.035 * s, 0.035 * s), casing);
      spoke.position.set(x, y, z + engLen * 0.5);
      spoke.rotation.z = a;
      group.add(spoke);
    }
    const exMat = MaterialFactory.getAdditive("exhaust", ctx, 0.25, THREE.FrontSide);
    const exhaust = addPart(group, new THREE.ConeGeometry(r * 0.5, 1.6, 16, 1, true), exMat,
      [x, y, z + engLen * 0.5 + 0.85], [Math.PI / 2, 0, 0]);
    exhaust.name = "exhaust";
    return;
  }

  // ══ Organic（Angel）专属：生物推进喷管（锥形虹吸口 + 环鳍 + 冰蓝辉光）══
  if (isOrganic) {
    const nozzleMat = MaterialFactory.get("engineCasing", ctx);
    const ringMat = MaterialFactory.get("engineRing", ctx);
    const glow = MaterialFactory.getGlow("engine", ctx, 1.8);
    addPart(group, new THREE.CylinderGeometry(r * 0.5, r, engLen, 16), nozzleMat, [x, y, z], [Math.PI / 2, 0, 0]);
    addPart(group, new THREE.TorusGeometry(r * 0.62, 0.05 * s, 8, 18), ringMat, [x, y, z + engLen * 0.5], [Math.PI / 2, 0, 0]);
    addPart(group, new THREE.SphereGeometry(r * 0.5, 14, 12), glow, [x, y, z + engLen * 0.45]);
    // 鳍状导流片（沿喷管周围辐射，生物感）
    const vanes = 4;
    for (let i = 0; i < vanes; i++) {
      const va = (i / vanes) * Math.PI * 2;
      const vane = new THREE.Mesh(new THREE.BoxGeometry(r * 1.0, 0.03 * s, engLen * 0.7), nozzleMat);
      vane.position.set(x, y, z + engLen * 0.2);
      vane.rotation.z = va;
      group.add(vane);
    }
    const exMat = MaterialFactory.getAdditive("exhaust", ctx, 0.22, THREE.FrontSide);
    const exhaust = addPart(group, new THREE.ConeGeometry(r * 0.5, engLen * 1.1, 14, 1, true), exMat,
      [x, y, z + engLen * 0.5 + engLen * 0.5], [Math.PI / 2, 0, 0]);
    exhaust.name = "exhaust";
    return;
  }

  // ══ Modular（Sansha）专属：精密多层推进喷口，六边形截面 ══
  if (ctx.civ && ctx.civ.hullType === "modular") {
    const modR = r * 0.9;
    const modLen = engLen * 0.8;
    // 外层壳体（六边形截面）
    addPart(group, new THREE.CylinderGeometry(modR, modR * 1.1, modLen, 6), casing, [x, y, z], [Math.PI / 2, 0, 0]);
    // 中层发光环
    addPart(group, new THREE.TorusGeometry(modR * 0.8, 0.035 * s, 6, 12), glow, [x, y, z + modLen * 0.5], [Math.PI / 2, 0, 0]);
    // 内层喷口（发光短管）
    addPart(group, new THREE.CylinderGeometry(modR * 0.55, modR * 0.7, modLen * 0.35, 6), glow, [x, y, z + modLen * 0.65], [Math.PI / 2, 0, 0]);
    const exMat = MaterialFactory.getAdditive("exhaust", ctx, 0.2, THREE.FrontSide);
    const exhaust = addPart(group, new THREE.ConeGeometry(modR * 0.45, 1.0, 12, 1, true), exMat,
      [x, y, z + modLen + 0.5], [Math.PI / 2, 0, 0]);
    exhaust.name = "exhaust";
    return;
  }

  addPart(group, new THREE.CylinderGeometry(r * 0.8, r, engLen, 18), casing, [x, y, z], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.16, 18), steel, [x, y, z + engLen * 0.5], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.05, 18), glow, [x, y, z + engLen * 0.5 + 0.1], [Math.PI / 2, 0, 0]);
  const exMat = MaterialFactory.getAdditive("exhaust", ctx, 0.2, THREE.FrontSide);
  const exhaust = addPart(group, new THREE.ConeGeometry(r * 0.55, 1.6, 16, 1, true), exMat,
    [x, y, z + engLen * 0.5 + 0.85], [Math.PI / 2, 0, 0]);
  exhaust.name = "exhaust";

  // Armor 专属：装甲罩（半环形装甲壳，保护引擎，底部留排气口）
  if (isArmor) {
    const armorShellMat = MaterialFactory.get("armorFortress", ctx);
    const shellR = r * 1.18;
    const shellLen = engLen * 0.75;
    const shellGeo = new THREE.CylinderGeometry(shellR, shellR, shellLen, 16, 1, true, -Math.PI / 2, Math.PI);
    addPart(group, shellGeo, armorShellMat,
      [x, y, z - engLen * 0.1], [Math.PI / 2, 0, 0]);
  }
}

export function generateEngines(ctx) {
  const { _engineHeatPoints } = ctx;

  const g = new THREE.Group();
  g.name = "engines";

  // Phase 4 Commit 3：引擎位置来自 ShipFactory2 Anchor Bus，不再内部推导。
  const heatPoints = _engineHeatPoints || [];
  g.userData.heatPoints = heatPoints;

  for (const hp of heatPoints)
    addEngine(g, hp.x, hp.y, hp.z, hp.radius, ctx);

  return g;
}
