// OverloadedHull.js — Blood Raider：疯狂改造工业舰
// 外露能源核心 + 管道环绕。视觉语言：暴力过载、能源污染、粗犷拼装。
import * as THREE from "three";
import { buildSpine, buildBridge } from "./CivHelpers.js";
import { latheHull } from "../Utils.js";
import { MaterialFactory } from "../MaterialFactory.js";

export function generateOverloadedHull(ctx) {
  const { s, L } = ctx;
  const p = ctx.civ.hullParams;
  const fatR = ctx.hullProfile.noseFat;
  const midR = ctx.hullProfile.mid;
  const tailR = ctx.hullProfile.tail;
  const wMul = p.widthMul || 0.95;

  const g = new THREE.Group();
  g.name = "hull";

  // ▸ 主船体：标准 lathe，略窄（暴力感）
  const slimMid = midR * 0.9;
  const slimFat = fatR * 0.9;
  const slimTail = tailR * 0.9;
  const mainGeo = latheHull(L, slimFat, slimMid, slimTail);
  const mainHull = new THREE.Mesh(mainGeo, ctx.hullMat);
  g.add(mainHull);

  // ▸ 外露反应器：腹部大球体
  if (p.reactorExternal) {
    const reactorScale = p.reactorScale || 0.55;
    const reactorR = midR * s * reactorScale;
    const reactorMat = MaterialFactory.getGlow("ring", ctx, 1.5);

    // 主反应器
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(reactorR, 20, 16),
      reactorMat
    );
    core.position.set(0, -midR * s * 0.7, 0.05 * L);
    g.add(core);

    // 反应器外壳（暗色金属笼）
    const cageMat = MaterialFactory.get("engineCasing", ctx);
    const cageGeo = new THREE.TorusGeometry(reactorR * 1.2, 0.04 * s, 8, 16);
    const cage = new THREE.Mesh(cageGeo, cageMat);
    cage.position.copy(core.position);
    cage.rotation.x = Math.PI / 2;
    g.add(cage);

    // 第二个小型辅助反应器（尾部）
    const auxCore = new THREE.Mesh(
      new THREE.SphereGeometry(reactorR * 0.55, 14, 10),
      reactorMat
    );
    auxCore.position.set(slimMid * s * 0.3, -midR * s * 0.4, L * 0.35);
    g.add(auxCore);
  }

  // ▸ 管道环绕
  if (p.pipeDensity > 0.3) {
    const pipeCnt = Math.ceil(5 * p.pipeDensity);
    const pipeMat = MaterialFactory.get("heatSinkBase", ctx);
    for (let i = 0; i < pipeCnt; i++) {
      const t = i / pipeCnt;
      const z = -L * 0.3 + t * L * 0.6;
      // 简化：用 Torus 环做管道
      const pipeR = midR * s * (0.8 + Math.random() * 0.3);
      const pipe = new THREE.Mesh(
        new THREE.TorusGeometry(pipeR, 0.025 * s, 8, 16),
        pipeMat
      );
      pipe.position.z = z;
      pipe.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
      pipe.rotation.y = Math.random() * Math.PI;
      g.add(pipe);
    }
  }

  // 共享元素
  buildSpine(ctx, g, slimMid * 0.8 / midR, 0.6);
  buildBridge(ctx, g);

  g.userData.hullRead = { ...ctx.hullProfile, len: ctx.hullProfile.len, noseFat: ctx.hullProfile.noseFat, mid: ctx.hullProfile.mid, tail: ctx.hullProfile.tail, wingSpan: ctx.hullProfile.wingSpan };

  return g;
}
