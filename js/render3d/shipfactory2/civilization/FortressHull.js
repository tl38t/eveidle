// FortressHull.js — Player Armor：移动堡垒
// 厚箱体 + 外挂装甲块裙边，视觉语言：坦克搬到宇宙
import * as THREE from "three";
import { buildSpine, buildBridge } from "./CivHelpers.js";
import { MaterialFactory } from "../MaterialFactory.js";

export function generateFortressHull(ctx) {
  const { s, L } = ctx;
  const p = ctx.civ.hullParams;
  const midR = ctx.hullProfile.mid * s;
  const wMul = p.widthMul || 1.35;
  const hullW = midR * 1.6 * wMul;
  const hullH = midR * 1.25 * wMul;
  const hullLen = L * 0.92;
  const hullMat = ctx.hullMat;

  const g = new THREE.Group();
  g.name = "hull";

  // ▸ 主箱体 — 厚重盒形
  const main = new THREE.Mesh(
    new THREE.BoxGeometry(hullW, hullH, hullLen, 2, 2, 2),
    hullMat
  );
  g.add(main);

  // ▸ 鼻部装甲楔形（斜切面，增加攻击性）
  const noseMat = MaterialFactory.get("armorPrimary", ctx);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(hullW * 1.08, hullH * 0.35, hullLen * 0.12),
    noseMat
  );
  nose.position.z = -hullLen / 2 - hullLen * 0.04;
  nose.rotation.x = -0.15; // 轻微下倾
  g.add(nose);

  // ▸ 装甲块 — 顶面覆盖板
  if (p.armorBlocks) {
    const blockThick = midR * 0.18 * (p.armorBlockSize || 0.75);
    const blockMat = noseMat;
    const topBlock = new THREE.Mesh(
      new THREE.BoxGeometry(hullW * 1.15, blockThick, hullLen * 0.65, 1, 1, 1),
      blockMat
    );
    topBlock.position.y = hullH / 2 + blockThick / 2;
    g.add(topBlock);

    // 底面装甲裙
    const botBlock = new THREE.Mesh(
      new THREE.BoxGeometry(hullW * 1.15, blockThick, hullLen * 0.65, 1, 1, 1),
      blockMat
    );
    botBlock.position.y = -hullH / 2 - blockThick / 2;
    g.add(botBlock);

    // 侧面装甲翼板
    for (const side of [-1, 1]) {
      const sideBlock = new THREE.Mesh(
        new THREE.BoxGeometry(blockThick * 0.8, hullH * 0.7, hullLen * 0.55, 1, 1, 1),
        blockMat
      );
      sideBlock.position.x = side * (hullW / 2 + blockThick * 0.4);
      g.add(sideBlock);
    }
  }

  // 共享元素
  buildSpine(ctx, g, hullH / midR * 0.5, 0.7);
  buildBridge(ctx, g);

  // 记录 hull 参数供 ArmorGenerator 等读取
  g.userData.hullRead = { ...ctx.hullProfile, len: ctx.hullProfile.len, noseFat: ctx.hullProfile.noseFat, mid: ctx.hullProfile.mid, tail: ctx.hullProfile.tail, wingSpan: ctx.hullProfile.wingSpan };

  return g;
}
