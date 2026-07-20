// ModularHull.js — Sansha's Nation：AI 复制生产舰
// 完美重复模块 + 绝对对称。视觉语言：工厂流水线统一模组。
import * as THREE from "three";
import { buildSpine, buildBridge } from "./CivHelpers.js";
import { latheHull } from "../Utils.js";

export function generateModularHull(ctx) {
  const { s, L } = ctx;
  const p = ctx.civ.hullParams;
  const fatR = ctx.hullProfile.noseFat;
  const midR = ctx.hullProfile.mid;
  const tailR = ctx.hullProfile.tail;
  const gap = p.moduleGap || 0.06;
  const repeat = p.moduleRepeat || 1.0;

  const g = new THREE.Group();
  g.name = "hull";

  // ▸ 分段数：3~4 个独立模块
  const segCnt = Math.max(2, Math.round(3 + repeat));
  const segLen = (L * 0.88) / segCnt;
  const gapLen = L * gap;

  for (let i = 0; i < segCnt; i++) {
    const segZ = -L * 0.44 + i * (segLen + gapLen);
    const halfLen = segLen / 2;

    // 用原始 latheHull 缩短版做每段
    // 简化为 BoxGeometry 变体：每段是带圆角的 lathe
    const segGeo = latheHull(segLen, fatR * 0.7, midR, tailR * 0.7);
    const segMesh = new THREE.Mesh(segGeo, ctx.hullMat);
    segMesh.position.z = segZ;
    g.add(segMesh);

    // 模块间连接环
    if (i < segCnt - 1) {
      const ringGeo = new THREE.TorusGeometry(midR * s * 0.95, 0.03 * s, 8, 16);
      const ring = new THREE.Mesh(ringGeo, ctx.darkMat);
      ring.position.z = segZ + segLen / 2 + gapLen / 2;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
  }

  // 共享元素（统一模块）
  buildSpine(ctx, g, midR * 0.85 / midR, 0.65);
  buildBridge(ctx, g);

  g.userData.hullRead = { ...ctx.hullProfile, len: ctx.hullProfile.len, noseFat: ctx.hullProfile.noseFat, mid: ctx.hullProfile.mid, tail: ctx.hullProfile.tail, wingSpan: ctx.hullProfile.wingSpan };

  return g;
}
