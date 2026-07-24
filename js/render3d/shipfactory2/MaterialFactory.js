// MaterialFactory.js — Phase 5 Commit 1：语义化材质工厂
// 职责：根据语义类型 + ctx 返回材质，替代 Generator 内直接调用 material()/glowMat()。
// 这是 Phase 5 C1 最小抽象层：只集中材质创建，不引入 Style DNA，不改变 Generator 参数。
//
// 数据流（Phase 5 C1）：
//   Generator → MaterialFactory.get("type", ctx) → material(...)
//   Generator → MaterialFactory.getGlow("type", ctx, intensity) → glowMat(...)
//   Generator → MaterialFactory.getAdditive("type", ctx, opacity, side) → additiveGlowMaterial(...)
//
// C2 起：MaterialFactory 内部将从 ctx.style 读取 faction 特定参数。
// C1 只做路由集中，几何指纹零变化。

import * as THREE from "three";
import { material, glowMat, additiveGlowMaterial, COLORS, RING_COLOR, SHIELD_COLOR } from "./Materials.js";

// ── 程序化对角黄黑警示条纹纹理（单例缓存）──
// 警示黄底 + 纯黑斜纹；高对比度工业安全胶带感（参考 EVE 矿物仓口警示带）。
// 注意：依赖 document.createElement("canvas")，仅在浏览器/预览页可用；
//   Node.js 环境（冒烟测试）回退到纯黄材质。
let _hazardTex = null;
function getHazardStripeTexture() {
  if (_hazardTex) return _hazardTex;
  if (typeof document === "undefined") return null; // Node.js 回退
  const size = 256;   // 纹理分辨率（正方形，UV 平铺）
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  // 饱和警示黄底（EVE 工业安全色：高可见度）
  ctx.fillStyle = "#f5c518";
  ctx.fillRect(0, 0, size, size);
  // 纯黑斜纹（30° 偏竖直，每条粗细 ~36px / 周期 80px，3 条粗纹每面清晰可辨）
  ctx.fillStyle = "#0a0a0a";
  const pitch = 80;                       // 条纹周期（像素，密度减半）
  const thick = 36;                       // 黑条宽度（增粗一倍，≈45% 占比）
  const dx    = Math.tan(30 * Math.PI / 180) * size; // 30° 倾角：每下一行右移 dx 像素
  for (let i = -size; i < size * 2; i += pitch) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + thick, 0);
    ctx.lineTo(i + thick + dx, size);
    ctx.lineTo(i + dx, size);
    ctx.closePath();
    ctx.fill();
  }
  // 轻微噪点（控制在 ±6，避免破坏对比度）
  const img = ctx.getImageData(0, 0, size, size);
  for (let j = 0; j < img.data.length; j += 4) {
    const n = (Math.random() - 0.5) * 12;
    img.data[j]     = Math.max(0, Math.min(255, img.data[j]     + n));
    img.data[j + 1] = Math.max(0, Math.min(255, img.data[j + 1] + n));
    img.data[j + 2] = Math.max(0, Math.min(255, img.data[j + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  _hazardTex = new THREE.CanvasTexture(c);
  _hazardTex.wrapS = _hazardTex.wrapT = THREE.RepeatWrapping;
  _hazardTex.repeat.set(1, 1);   // 每面只铺 4 条粗纹，清晰可辨
  return _hazardTex;
}

// ── 语义类型 → { paletteKey, metalness, roughness } ──
// 所有 metalness/roughness 均与当前 Generator 内联值逐项一致（Phase 4 基线）。
const STD = {
  // palette.hull 族 —— 装甲主色调
  armorPrimary:      { key: "hull",  m: 0.86, r: 0.30 },
  armorDeck:         { key: "hull",  m: 0.87, r: 0.32 },
  armorFortress:     { key: "hull",  m: 0.88, r: 0.32 },

  // palette.dark 族 —— 结构暗部
  groove:            { key: "dark",  m: 0.35, r: 0.80 },
  heatSinkBase:      { key: "dark",  m: 0.92, r: 0.35 },
  hatchDoor:         { key: "dark",  m: 0.94, r: 0.28 },
  ventFrame:         { key: "dark",  m: 0.93, r: 0.30 },
  weaponSpike:       { key: "dark",  m: 0.86, r: 0.30 },
  weaponRing:        { key: "dark",  m: 0.90, r: 0.32 },
  weaponBase:        { key: "dark",  m: 0.88, r: 0.30 },  // 激光发射舱底座

  // P5 大型组件语义材质
  sensorDish:        { key: "steel", m: 0.90, r: 0.30 },  // 传感器碟形天线
  sensorMast:        { key: "dark",  m: 0.86, r: 0.40 },  // 传感器基座/桅杆
  droneBay:          { key: "dark",  m: 0.90, r: 0.35 },  // 无人机机库门
  droneBody:         { key: "steel", m: 0.90, r: 0.30 },  // 无人机机体

  // palette.steel 族 —— 金属构件
  panelPlate:        { key: "steel", m: 0.95, r: 0.24 },
  heatSinkFin:       { key: "steel", m: 0.88, r: 0.42 },
  hatchHandle:       { key: "steel", m: 0.90, r: 0.30 },
  ventSlit:          { key: "steel", m: 0.85, r: 0.72 },  // 原硬编码 0xcccccc
  cannonBarrel:      { key: "steel", m: 0.90, r: 0.30 },

  // 引擎族 —— hybrid 时切换到 COLORS.angel
  engineCasing:      { key: "dark",  m: 0.88, r: 0.32 },
  engineRing:        { key: "steel", m: 0.92, r: 0.26 },

  // 功能挂载族（工业 / 考古签名识别度）
  miningArm:         { key: "dark",  m: 0.86, r: 0.30 },  // 采矿激光臂基座
  gasArm:            { key: "dark",  m: 0.86, r: 0.30 },  // 采气采集器基座
  scanPylon:         { key: "steel", m: 0.90, r: 0.30 },  // 扫描阵列支柱
  probePod:          { key: "dark",  m: 0.88, r: 0.30 },  // 探针发射舱
  commandAntenna:    { key: "steel", m: 0.90, r: 0.30 },  // 工业支援指挥天线

  // 混血专属 —— 永远映射到 COLORS.angel
  hybridAccent:      { key: "hull",  m: 0.84, r: 0.34 },
  hybridRed:         { key: "hull",  m: 0.84, r: 0.34 },
};

// ── 引擎 / 武器发射舱等：hybrid 时整组切换 palette ──
// 这些组件在 hybrid 模式下使用 COLORS.angel，非 hybrid 使用 ctx.palette。
const HYBRID_SWITCH_TYPES = new Set([
  "engineCasing", "engineRing",
  "weaponSpike", "weaponRing", "weaponBase", "cannonBarrel",
]);

// 永远使用 COLORS.angel 的类型（混血专属 accent/red）
const ANGEL_ONLY_TYPES = new Set(["hybridAccent", "hybridRed"]);

// Phase 5 Rework：player_armor 的装甲材质更粗糙（rough heavy metal）
// 这些类型的 roughness/metalness 在 player_armor 路线下会被覆写
const ARMOR_TYPES = new Set(["armorPrimary", "armorDeck", "armorFortress", "panelPlate"]);

function _paletteForType(type, ctx) {
  if (ANGEL_ONLY_TYPES.has(type)) return COLORS.angel;
  if (HYBRID_SWITCH_TYPES.has(type) && ctx.hybrid) return COLORS.angel;
  return ctx.palette;
}

// ═══════════════════════════════════════════════════
//  公开 API
// ═══════════════════════════════════════════════════

export const MaterialFactory = {

  // ── 标准材质（MeshStandardMaterial）──
  // type: 语义类型名（如 "armorPrimary", "panelPlate", "groove"）
  // ctx:  ShipContext 实例
  // overrides: { emissiveIntensity } — 可选，用于混合 accent 等特殊情形
  get(type, ctx, overrides = {}) {
    const def = STD[type];
    if (type === "hazardStripe") {
      const tex = getHazardStripeTexture();
      if (tex) {
        const mat = new THREE.MeshStandardMaterial({
          map: tex,
          color: 0xffffff,
          roughness: 0.55,
          metalness: 0.15,
        });
        return mat;
      }
      // Node.js 回退：无 canvas，纯黄
      return material(0xd9c44a, 0.3, 0.55);
    }
    if (!def) throw new Error(`MaterialFactory.get: unknown type "${type}"`);

    const pal = _paletteForType(type, ctx);
    const color = pal[def.key];

    if (overrides.emissiveIntensity != null && pal === COLORS.angel) {
      // 混血 accent/red：带 emissive
      return material(color, def.m, def.r, pal.glow, overrides.emissiveIntensity);
    }

    // Phase 5 Rework：player_armor（Fortress Engineering）
    // 粗糙重甲（rough 0.65~0.85, metalness 0.9）+ 三级明度对比拉开层次：
    //   壳/上层建筑 = palette.hull（最亮）→ 外挂装甲块 = 中灰 → 贴面装甲板 = 暗灰 → 刻槽 = 近黑
    if (ctx.style && ctx.style.faction === "player_armor") {
      const armorR = 0.65 + (ctx.style.armorThickness || 0.8) * 0.25; // 0.65~0.85
      const ARMOR_COLORS = {
        armorFortress: 0xa89e94,  // 凸出块：中灰，比壳暗一档
        panelPlate:    0x7a7168,  // 贴面板：暗灰，明显分区
        groove:        0x0a0908,  // 刻槽：极黑深缝，低 roughness 避免光照色差
      };
      const c = ARMOR_COLORS[type] ?? color;
      // 缝底单独用低 roughness（0.45），避免高哑光在不同法线方向显灰/显黑不一
      if (type === "groove") return material(c, 0.85, 0.45);
      return material(c, 0.9, armorR);
    }

    return material(color, def.m, def.r);
  },

  // ── 发光材质（emissive）──
  // type: "ribbon" | "ring" | "energy" | "nav" | "wingGlow" | "spike" | "laser" | "engine" | "hybridGlow"
  // intensity: 发光强度（不同 Generator 可覆写）
  getGlow(type, ctx, intensity = 2.0) {
    const pal = ctx.palette;

    switch (type) {
      case "ribbon":
        return glowMat({ glow: pal.glow }, intensity);

      case "ring": {
        const ringColor = ctx.hybrid ? COLORS.angel.glow : RING_COLOR;
        return glowMat({ glow: ringColor }, intensity);
      }

      case "energy":
        return glowMat(pal, intensity);

      case "nav":
        return glowMat({ glow: pal.glow }, 2.6);

      case "wingGlow":
        return glowMat(pal, 1.0);

      case "spike":
        return glowMat(pal, intensity);

      case "laser": {
        // 激光发射舱：hybrid 时用 angel 调色板
        const laserPal = ctx.hybrid ? COLORS.angel : pal;
        return glowMat(laserPal, intensity);
      }

      case "engine":
        // 引擎发光环：hybrid 时用 angel
        const enginePal = ctx.hybrid ? COLORS.angel : pal;
        return glowMat(enginePal, intensity);

      case "hybridGlow":
        return glowMat(COLORS.angel, intensity);

      default:
        return glowMat(pal, intensity);
    }
  },

  // ── 自定义颜色发光材质（sansha 核心按舰级变色等）──
  // colorHex: 任意十六进制颜色；intensity: 发光强度
  getGlowColor(colorHex, intensity = 2.0) {
    return glowMat({ glow: colorHex }, intensity);
  },

  // ── 加色混合材质（Additive Blending）──
  // type: "exhaust" | "shield"
  getAdditive(type, ctx, opacity = 0.2, side = THREE.FrontSide) {
    switch (type) {
      case "exhaust": {
        const glowColor = ctx.hybrid ? COLORS.angel.glow : ctx.palette.glow;
        return additiveGlowMaterial(glowColor, opacity, side);
      }
      case "shield":
        return additiveGlowMaterial(SHIELD_COLOR, opacity, side);
      default:
        return additiveGlowMaterial(ctx.palette.glow, opacity, side);
    }
  }
};
