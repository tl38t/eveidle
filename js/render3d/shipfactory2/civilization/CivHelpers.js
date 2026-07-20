// CivHelpers.js — 共享几何元素（spine / bridge / wings）
// 供所有 civ hull generator 复用，避免复制 HullGenerator 的公共元素。
import * as THREE from "three";
import { rbox } from "../Materials.js";

// ── 中央脊线饰条 ──
export function buildSpine(ctx, g, yOffsetMul = 0.92, lengthMul = 0.72) {
  const { s, L } = ctx;
  const midR = ctx.hullProfile.mid * s;
  g.add(rbox(
    L * lengthMul, 0.036 * s, 0.07 * s, 0.018 * s,
    ctx.darkMat,
    [0, midR * yOffsetMul, -0.02 * L]
  ));
}

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

