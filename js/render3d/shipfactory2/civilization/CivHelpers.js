// CivHelpers.js — 共享几何元素（spine / bridge / wings）
// 供所有 civ hull generator 复用，避免复制 HullGenerator 的公共元素。
import * as THREE from "three";

// ── 中央脊线饰条（已移除：近黑脊线在俯视图中显示为横穿船体的黑条，用户要求删除脊线）──
export function buildSpine() { /* no-op: 脊线饰条已移除，保留签名避免破坏 5 处调用方 import */ }

// ── 舰桥窗 ──
export function buildBridge(ctx, g) {
  const { s, L } = ctx;
  const bridgeR = Math.min(0.10 * s, 0.12);
  const bridge = new THREE.Mesh(
    new THREE.SphereGeometry(bridgeR, 12, 10),
    ctx.glassMat
  );
  bridge.position.set(-0.08 * s, Math.max(0.18 * s, bridgeR + 0.04 * s), -L * 0.28);
  g.add(bridge);
}

