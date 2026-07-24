// SkeletalHull.js — Player Structure：科幻骨架舰
//
// 设计哲学："看得见内部结构的工程船"——不是未完工的烂尾楼，
//   而是故意裸露骨架的空间框架舰。约 50% 蒙皮（关键功能块贴装甲板），其余全透露出骨架。
//   与 Armor 实心堡垒形成极端对比：Armor 零透光，Structure 大面积透光。
//
// Anchor Bus：把 hull 尺寸写入 ctx._fortressDims（复用键名，供下游 Generator 读取）。
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

  // 材质：骨架亮金属 / 次要结构暗灰 / 蒙皮中灰装甲
  const beamMat = MaterialFactory.get("panelPlate", ctx); // 主脊梁/纵向梁/环肋：高光泽亮金属
  const braceMat = MaterialFactory.get("engineCasing", ctx); // 斜撑/管线：暗灰次要结构
  const skinMat = MaterialFactory.get("armorDeck", ctx);  // 蒙皮：中灰装甲板

  const beamCnt = p.frameBeamCnt || 6;
  const frameExp = p.frameExposed || 0.85;

  // 结构船专用轮廓：恒定半径棱柱（非 Shield 的平滑纺锤），钝头 + 收尾
  // —— 和护盾船拉开差距的关键：大外形是"长桁架棱柱"而非"尖头鱼雷"
  const baseR = midR * 0.95;
  const hrAt = (z) => {
    const t = z / L;                       // -0.5 .. 0.5
    const noseEnd = -0.5 + 0.14;           // 前 14% 钝头
    const tailStart = 0.5 - 0.24;          // 后 24% 收尾
    if (t < noseEnd) {
      const u = Math.max(0, (t + 0.5) / 0.14);
      return baseR * Math.pow(u, 0.55);
    }
    if (t > tailStart) {
      const u = (t - tailStart) / 0.24;
      return baseR * (1 - 0.7 * Math.pow(u, 0.7));
    }
    return baseR;
  };

  // ══ 1. 主脊梁（中央工字梁）══
  const spineR = midR * 0.26 * frameExp;
  const spine = new THREE.Mesh(new THREE.BoxGeometry(spineR * 1.5, spineR * 0.7, L * 0.96), beamMat);
  g.add(spine);
  for (const sy of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(spineR * 0.22, spineR * 0.22, L * 0.96), beamMat);
    edge.position.set(0, sy * spineR * 0.55, 0);
    g.add(edge);
  }

  // ══ 2. 纵向骨架梁（分段跟随 hull 锥度）══
  const segN = 14;
  for (let i = 0; i < beamCnt; i++) {
    const a = (i / beamCnt) * Math.PI * 2;
    const sa = Math.sin(a), ca = Math.cos(a);
    let prev = null;
    for (let k = 0; k <= segN; k++) {
      const z = -L * 0.48 + (k / segN) * L * 0.96;
      const hr = hrAt(z) * frameExp;
      const x = sa * hr, y = ca * hr;
      if (prev) {
        const len = Math.hypot(x - prev.x, y - prev.y, z - prev.z);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.045 * s, 0.045 * s, len), beamMat);
        seg.position.set((x + prev.x) / 2, (y + prev.y) / 2, (z + prev.z) / 2);
        seg.lookAt(x, y, z);
        g.add(seg);
      }
      prev = { x, y, z };
    }
  }

  // ══ 3. 横向环肋（8 边形机械环，跟随锥度）══
  const ringZ = [-L * 0.40, -L * 0.20, 0, L * 0.20, L * 0.40];
  for (const rz of ringZ) {
    const hr = hrAt(rz);
    if (hr < 0.05 * s) continue;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(hr * frameExp, 0.04 * s, 6, 8), beamMat);
    ring.position.z = rz;
    g.add(ring);
  }

  // ══ 4. 斜撑交叉（X 形对角杆，科幻风适度稀疏）══
  for (let ri = 0; ri < ringZ.length - 1; ri++) {
    const zA = ringZ[ri], zB = ringZ[ri + 1];
    const rA = hrAt(zA) * frameExp, rB = hrAt(zB) * frameExp;
    for (let i = 0; i < beamCnt; i++) {
      const a1 = (i / beamCnt) * Math.PI * 2;
      const a2 = ((i + 1) / beamCnt) * Math.PI * 2;
      const p1 = new THREE.Vector3(Math.sin(a1) * rA, Math.cos(a1) * rA, zA);
      const p2 = new THREE.Vector3(Math.sin(a2) * rB, Math.cos(a2) * rB, zB);
      const len = p1.distanceTo(p2);
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.028 * s, 0.028 * s, len), braceMat);
      brace.position.copy(p1).lerp(p2, 0.5);
      brace.lookAt(p2);
      g.add(brace);
    }
  }

  // ══ 5. 50% 蒙皮（分段弧形圆筒装甲壳，包覆桁架外周，暗装甲钢色）══
  // 不是平板：用开口圆筒弧段做弧形装甲壳片，包在骨架外面（顶+底各一片弧），
  //   沿长度分段留缝（"改短"），侧面留透窗口体现"桁架+局部蒙皮"。
  // deckStyle（?deck= 注入）控制包覆程度：half（默认，顶底半包）/ most（大半包）/ full（整圈圆筒）
  const deckStyle = (ctx.spec && ctx.spec.deckStyle) || "half";
  const shellMat = MaterialFactory.get("panelPlate", ctx).clone();  // 暗装甲钢色
  shellMat.side = THREE.DoubleSide;                                 // 弧壳内外都可见
  const shellR = baseR * frameExp + 0.06 * s;                       // 略大于骨架，包在外周
  const segZ = [-0.30 * L, 0, 0.30 * L];                            // 3 段留缝
  const segLen = L * 0.24;
  // 每片弧的角宽 + 中心（旋转后 +Y=顶 / -Y=底）
  // 装甲壳厚度：把单面薄壳改成「有厚度的环形扇区挤出体」——侧面看是实心装甲板，不再是纸
  const shellTh = shellR * 0.16;
  const arc = deckStyle === "full" ? Math.PI * 2 : deckStyle === "most" ? Math.PI * 0.88 : Math.PI * 0.60;
  const centers = deckStyle === "full" ? [0] : [Math.PI * 1.5, Math.PI * 0.5]; // 顶 / 底
  for (const cz of segZ) {
    for (const c of centers) {
      const a0 = c - arc / 2, a1 = c + arc / 2;
      // 环形扇区截面（外弧 shellR，内弧 shellR - th），挤出沿 Z = 舰长
      const shape = new THREE.Shape();
      shape.moveTo(Math.cos(a0) * shellR, Math.sin(a0) * shellR);
      shape.absarc(0, 0, shellR, a0, a1, false);             // 外弧（CCW）
      shape.lineTo(Math.cos(a1) * (shellR - shellTh), Math.sin(a1) * (shellR - shellTh));
      shape.absarc(0, 0, shellR - shellTh, a1, a0, true);    // 内弧（CW 回）
      shape.lineTo(Math.cos(a0) * shellR, Math.sin(a0) * shellR);
      const shellGeo = new THREE.ExtrudeGeometry(shape, { depth: segLen, bevelEnabled: false, curveSegments: 24 });
      shellGeo.translate(0, 0, -segLen / 2);                  // 居中到 cz（挤出沿 +Z）
      const shell = new THREE.Mesh(shellGeo, shellMat);
      shell.position.set(0, 0, cz);
      g.add(shell);
    }
  }
  // 钝头端盖（前封板，弧形碗盖包住鼻端）
  const capR = hrAt(-L * 0.42);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(capR * 1.15, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
    shellMat
  );
  cap.rotation.x = -Math.PI / 2;        // 碗口朝 +Z（后方），罩住鼻端
  cap.position.set(0, 0, -L * 0.44);
  g.add(cap);

  // ══ 6. 暴露管道（沿侧面，暗灰）══
  if (p.pipeDensity > 0.3) {
    const pipeCnt = Math.ceil(5 * p.pipeDensity);
    for (let i = 0; i < pipeCnt; i++) {
      const t = i / pipeCnt;
      const z = -L * 0.35 + t * L * 0.7;
      const hr = hrAt(z) * frameExp;
      if (hr < 0.04 * s) continue;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.024 * s, 0.024 * s, L * 0.3, 8), braceMat);
      pipe.rotation.x = Math.PI / 2;
      const side = (i % 2 === 0) ? 1 : -1;
      pipe.position.set(side * (hr + 0.03 * s), 0, z);
      g.add(pipe);
    }
  }

  // ══ 7. 尾部开放引擎舱（框架环 + 肋，外露感，配合 EngineGenerator 外露引擎）══
  const tailZ = L * 0.46;
  const tR = hrAt(tailZ) * frameExp;
  const tailRing = new THREE.Mesh(new THREE.TorusGeometry(tR * 1.12, 0.05 * s, 6, 8), beamMat);
  tailRing.position.z = tailZ;
  g.add(tailRing);
  for (let i = 0; i < beamCnt; i++) {
    const a = (i / beamCnt) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.04 * s, 0.04 * s, L * 0.09), beamMat);
    rib.position.set(Math.sin(a) * tR * 1.12, Math.cos(a) * tR * 1.12, tailZ + L * 0.045);
    g.add(rib);
  }

  // 共享元素（轻量化）
  buildSpine(ctx, g, midR * 0.6 / midR, 0.5);
  buildBridge(ctx, g);

  // Anchor Bus：暴露 hull 尺寸（复用 _fortressDims 键名，供下游 Generator）
  ctx._fortressDims = { hullW: baseR * 1.6, hullH: baseR * 1.4, hullLen: L * 0.9, hullR: baseR, midR };

  g.userData.hullRead = { ...ctx.hullProfile };

  return g;
}
