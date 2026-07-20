// SkeletalHull.js — Player Structure：工程骨架舰
// 裸框架 + 纵向梁桁，不是完整外壳。视觉语言：看得见骨架的船。
import * as THREE from "three";
import { buildSpine, buildBridge } from "./CivHelpers.js";
import { hullRadiusAt } from "../Utils.js";
import { MaterialFactory } from "../MaterialFactory.js";

export function generateSkeletalHull(ctx) {
  const { s, L } = ctx;
  const p = ctx.civ.hullParams;
  const midR = ctx.hullProfile.mid * s;
  const fatR = ctx.hullProfile.noseFat * s;
  const tailR = ctx.hullProfile.tail * s;

  const g = new THREE.Group();
  g.name = "hull";

  const beamMat = ctx.steelMat;
  const beamCnt = p.frameBeamCnt || 6;
  const frameExp = p.frameExposed || 0.85;

  // ▸ 纵向主梁：沿 hull 轮廓分布
  //   每根梁是一条沿 Z 轴的细长 Box，位置跟随 hull profile
  const beamR = midR * 0.85 * frameExp; // 梁半径（hull 内部）
  for (let i = 0; i < beamCnt; i++) {
    const angle = (i / beamCnt) * Math.PI * 2;
    const x = Math.sin(angle) * beamR;
    const y = Math.cos(angle) * beamR;
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(0.06 * s, 0.06 * s, L * 0.94),
      beamMat
    );
    beam.position.set(x, y, 0);
    g.add(beam);
  }

  // ▸ 横向环肋：在 hull 关键截面处加箍
  const ringZ = [
    -L * 0.24, // 鼻段
    -L * 0.05, // 前中段
    0.15 * L,  // 中后段
    0.45 * L,  // 尾段
  ];
  for (const rz of ringZ) {
    const hr = hullRadiusAt(rz, fatR, midR, tailR, L);
    if (hr < 0.05 * s) continue;
    const ringR = hr * frameExp;
    const ringGeo = new THREE.TorusGeometry(ringR, 0.04 * s, 8, beamCnt);
    const ring = new THREE.Mesh(ringGeo, beamMat);
    ring.position.z = rz;
    g.add(ring);
  }

  // ▸ 暴露管道：沿顶面 + 侧面
  if (p.pipeDensity > 0.3) {
    const pipeMat = MaterialFactory.get("engineCasing", ctx);
    const pipeCnt = Math.ceil(4 * p.pipeDensity);
    for (let i = 0; i < pipeCnt; i++) {
      const t = i / pipeCnt;
      const z = -L * 0.35 + t * L * 0.7;
      const hr = hullRadiusAt(z, fatR, midR, tailR, L) * frameExp;
      if (hr < 0.04 * s) continue;
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02 * s, 0.02 * s, L * 0.25, 8),
        pipeMat
      );
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(0, hr + 0.04 * s, z);
      g.add(pipe);
    }
  }

  // 共享元素（轻量化）
  buildSpine(ctx, g, midR * 0.6 / midR, 0.5);
  buildBridge(ctx, g);

  g.userData.hullRead = { ...ctx.hullProfile, len: ctx.hullProfile.len, noseFat: ctx.hullProfile.noseFat, mid: ctx.hullProfile.mid, tail: ctx.hullProfile.tail, wingSpan: ctx.hullProfile.wingSpan };

  return g;
}
