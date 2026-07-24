// WeaponGenerator.js — 武器系统：鼻前双刺 + 巨型结构环 + 环内浮游炮 + 激光挂点 + 护盾辉光层
// 职责：返回包含上述全部武器/护盾构件的 THREE.Group。
// 约定：环内浮游炮列表挂到 g.userData.floaters；护盾层挂到 g.userData.shield，
//       供 ShipFactory2 汇总到 ship.userData 供动画使用。
import * as THREE from "three";
import { addPart } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

// 鼻前双刺（护盾系标志）
function addNoseSpikes(group, s, L, ctx, length = 1.8) {
  const spikeMat = MaterialFactory.get("weaponSpike", ctx);
  const spikeGlow = MaterialFactory.getGlow("spike", ctx, 1.2);
  const spread = 0.22 * s;
  for (const sx of [-spread, spread]) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035 * s, length * s, 8), spikeMat);
    spike.position.set(sx, 0.02 * s, -L * 0.5 - length * s * 0.45);
    spike.rotation.x = Math.PI / 2 + 0.05;
    group.add(spike);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025 * s, 8, 6), spikeGlow);
    tip.position.set(sx, 0.02 * s, -L * 0.5 - length * s * 0.95);
    group.add(tip);
  }
}

// 巨型结构环（分段环管 + 发光节点 + 环内浮游炮 + 能量丝）
function addHaloRing(group, L, s, ctx, ringR, spec, count = 6) {
  const hybrid = !!spec.hybrid;
  const segCount = 12;
  const tubeR = 0.07 * s;
  const nodeR = 0.13 * s;

  const ringMat = MaterialFactory.get("weaponRing", ctx);
  const mainRing = new THREE.TorusGeometry(ringR, tubeR, 10, segCount * 4);
  const ringMesh = new THREE.Mesh(mainRing, ringMat);
  ringMesh.rotation.x = 0.18;
  ringMesh.position.z = 0.06 * L;
  group.add(ringMesh);

  const nodeGlow = MaterialFactory.getGlow("ring", ctx, hybrid ? 2.0 : 1.8);
  for (let i = 0; i < segCount; i++) {
    const angle = (i / segCount) * Math.PI * 2;
    const nx = ringR * Math.cos(angle);
    const ny = ringR * Math.sin(angle);
    const tz = ny * Math.sin(0.18) + 0.06 * L;
    const ty_ = ny * Math.cos(0.18);
    const node = new THREE.Mesh(new THREE.SphereGeometry(nodeR, 12, 10), nodeGlow);
    node.position.set(nx, ty_, tz);
    group.add(node);
    if (i % 3 === 0) {
      const nodeBig = new THREE.Mesh(new THREE.SphereGeometry(nodeR * 1.4, 12, 10), MaterialFactory.getGlow("ring", ctx, 2.5));
      nodeBig.position.set(nx, ty_, tz);
      group.add(nodeBig);
    }
  }

  // ══ 环内浮游炮（数量 = 舰船高槽数；悬浮于环内、朝前）══
  const floaters = [];
  const cannonBarrel = MaterialFactory.get("cannonBarrel", ctx);
  const cannonGlow = MaterialFactory.getGlow("ring", ctx, 2.2);
  const tilt = 0.18;
  const rInner = ringR * 0.62;
  const cannonLen = 0.7 * s;
  for (let k = 0; k < count; k++) {
    const angle = (k / count) * Math.PI * 2 + Math.PI / count;
    const nx = rInner * Math.cos(angle);
    const ny = rInner * Math.sin(angle);
    const ty_ = ny * Math.cos(tilt);
    const tz = ny * Math.sin(tilt) + 0.06 * L;
    const base = new THREE.Vector3(nx, ty_, tz);

    const grp = new THREE.Group();
    grp.position.copy(base);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * s, 0.05 * s, cannonLen, 12), cannonBarrel);
    pod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
    pod.position.z = -cannonLen * 0.5;
    grp.add(pod);
    const emitter = new THREE.Mesh(new THREE.SphereGeometry(0.075 * s, 12, 10), cannonGlow);
    emitter.position.z = -cannonLen - 0.02 * s;
    grp.add(emitter);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.055 * s, 12, 10), cannonGlow);
    core.position.z = 0.02 * s;
    grp.add(core);
    group.add(grp);
    floaters.push({ grp, base: base.clone(), phase: k * 1.7, ampY: 0.16 * s, ampZ: 0.09 * s });

    // 与环之间的能量丝（系留暗示）
    const mid = (rInner + ringR) / 2;
    const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.03 * s, ringR - rInner, 8), MaterialFactory.getGlow("ring", ctx, 1.8));
    tether.material.transparent = true;
    tether.material.opacity = 0.7;
    const outward = new THREE.Vector3(nx, ny, 0).normalize();
    tether.position.set(outward.x * mid, outward.y * mid * Math.cos(tilt), outward.y * mid * Math.sin(tilt) + 0.06 * L);
    tether.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
    group.add(tether);
  }
  if (!group.userData.floaters) group.userData.floaters = [];
  group.userData.floaters.push(...floaters);

  return ringMesh;
}

// 激光发射舱
function addLaserPod(group, x, y, z, ctx, s, big = false) {
  const base = MaterialFactory.get("weaponBase", ctx);
  const emitter = MaterialFactory.getGlow("laser", ctx, big ? 2.2 : 1.8);
  const r = (big ? 0.11 : 0.07) * s, len = (big ? 0.8 : 0.5) * s;
  addPart(group, new THREE.CylinderGeometry(r * 0.7, r, len, 10), base, [x, y, z], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.SphereGeometry(r, 10, 8), emitter, [x, y, z - len * 0.6]);
}

// 护盾辉光层
function addShieldBubble(group, radius, ctx) {
  const fill = MaterialFactory.getAdditive("shield", ctx, 0.07, THREE.FrontSide);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), fill);
  bubble.name = "shield";
  const rim = MaterialFactory.getAdditive("shield", ctx, 0.18, THREE.BackSide);
  bubble.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.03, 28, 20), rim));
  group.add(bubble);
  return bubble;
}

// ══ 装甲箱式导弹发射器（仅 Player Armor — Fortress Engineering 武器语言）══
// 设计：箱式导弹架（多管发射器），不是炮塔。Frigate 小架，Cruiser 双管架，Battleship 大型多管架。
// 位置：顶面前部和中部、战列/巡洋中排左右舷侧（坐标与原炮塔一致，仅外形换成发射架）。
// 朝向：多方向（前/侧/后），像堡垒多面防御。
function addArmorTurrets(group, s, L, ctx) {
  const turretMat = MaterialFactory.get("panelPlate", ctx); // 中灰重甲金属外壳，告别纯黑

  const hull = ctx.profile.hull;
  const isFortress = hull.body === "fortress";
  const isCruiser = hull.body === "cruiser";

  // 炮塔尺寸（weaponSizeMul=1.3）— Phase 5 Rework v2：大幅放大，重炮感
  // 按舰级再放大（用户反馈：战列舰炮太小，与引擎同源问题）
  const sizeMul = ctx.style.weaponSizeMul || 1.0;
  const cls = (ctx.spec && ctx.spec.hull) || "";
  const classSc = cls.includes("battleship") ? 1.85 : cls.includes("cruiser") ? 1.55 : cls.includes("destroyer") ? 1.35 : 1.25;
  const turretSize = (isFortress ? 0.36 : isCruiser ? 0.28 : 0.20) * s * sizeMul * classSc;

  // 读取 FortressHull 尺寸（Anchor Bus）
  const dims = ctx._fortressDims;
  if (!dims) return;
  const { hullW, hullH, hullLen } = dims;
  const topY = hullH * 0.5; // 顶面 Y 坐标

  // ── 导弹架定义：[x, yOverride, z, yaw] ──
  // yOverride: null → 默认 topY（顶面）；显式值 → 安装到指定高度（侧面/底部）
  // yaw: 0=朝前(-Z), π/2=朝左(+X), -π/2=朝右(-X), π=朝后(+Z)
  // 多方向指向，避免发射器互相穿插
  const turretDefs = [];
  if (hull.body === "dagger") {
    turretDefs.push([0, null, -hullLen * 0.15, 0]);
  } else if (hull.body === "gunboat") {
    turretDefs.push([-0.18 * s, null, -hullLen * 0.15, 0.30]);
    turretDefs.push([ 0.18 * s, null, -hullLen * 0.15, -0.30]);
  } else if (isCruiser) {
    // 前排顶面朝前，中排装到左右舷侧（炮管朝外）
    turretDefs.push([-0.25 * s, null, -hullLen * 0.25, 0]);
    turretDefs.push([ 0.25 * s, null, -hullLen * 0.25, 0]);
    turretDefs.push([-(hullW * 0.55 + s * 0.15), hullH * 0.05, hullLen * 0.08, Math.PI / 2]);
    turretDefs.push([ (hullW * 0.55 + s * 0.15), hullH * 0.05, hullLen * 0.08, -Math.PI / 2]);
  } else {
    // fortress / battleship：前排/后排顶面，中排左右舷侧
    turretDefs.push([ 0,           null, -hullLen * 0.40, 0]);
    turretDefs.push([-0.25 * s,    null, -hullLen * 0.18, Math.PI * 0.28]);
    turretDefs.push([ 0.25 * s,    null, -hullLen * 0.18, -Math.PI * 0.28]);
    turretDefs.push([-(hullW * 0.58 + s * 0.20), hullH * 0.02, hullLen * 0.06, Math.PI / 2]);
    turretDefs.push([ (hullW * 0.58 + s * 0.20), hullH * 0.02, hullLen * 0.06, -Math.PI / 2]);
    turretDefs.push([ 0,           null,  hullLen * 0.22, Math.PI]);
  }

  // weaponCountMul=0.8 控制实际生成数量
  const countMul = ctx.style.weaponCountMul || 1.0;
  const finalCount = Math.max(1, Math.round(turretDefs.length * countMul));

  for (let i = 0; i < finalCount; i++) {
    const [x, yOverride, z, yaw] = turretDefs[i];
    const y = (yOverride != null) ? yOverride : topY;

    // ── 箱式导弹发射架（绕 Y 轴 yaw 定向，本地 -Z 为前方）──
    // 装甲系武器语言=箱式导弹架；炮位坐标不变。
    // 顶面炮：尾部贴甲板、前高后低倾斜（像舰载导弹发射箱）；舷侧炮：贴壁挂架。
    const launcher = new THREE.Group();
    launcher.rotation.y = yaw;

    const boxW = turretSize * 1.55;
    const boxH = turretSize * 1.15;
    const boxD = turretSize * 1.8;

    const isSide = (yOverride != null);
    const TILT = 0.32;                                  // 顶面炮倾斜角度（弧度）
    const cosT = Math.cos(TILT), sinT = Math.sin(TILT);

    // 倾斜后 rear/front 底角（local 0,-boxH/2,±boxD/2）相对箱体中心的世界 y、z 偏移
    const rearLy  = -boxH * 0.5 * cosT -  boxD * 0.5 * sinT;
    const frontLy = -boxH * 0.5 * cosT - (-boxD * 0.5) * sinT;
    const rearLz  = (-boxH * 0.5) * sinT +  boxD * 0.5 * cosT;
    const frontLz = (-boxH * 0.5) * sinT + (-boxD * 0.5) * cosT;
    const boxCenterY = isSide ? (y + boxH * 0.5 + turretSize * 0.2)
                              : (topY - rearLy);         // 使 rear 角恰好落在甲板 topY
    launcher.position.set(x, boxCenterY, z);

    // tiltGroup 承载箱体与所有细节（仅顶面炮倾斜）
    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.x = isSide ? 0 : TILT;
    launcher.add(tiltGroup);

    const mountMat = MaterialFactory.get("weaponBase", ctx);

    // ── 支脚（在 launcher 帧内为竖直，确保贴甲板）──
    if (!isSide) {
      // 尾部贴甲板支座（pad），前部用细腿撑到甲板
      addPart(launcher, new THREE.BoxGeometry(boxW * 0.6, turretSize * 0.12, boxD * 0.3),
        mountMat, [0, rearLy - turretSize * 0.06, rearLz]);
      const legLen = (boxCenterY + frontLy) - topY;
      if (legLen > 0.02) {
        addPart(launcher, new THREE.CylinderGeometry(turretSize * 0.1, turretSize * 0.12, legLen, 8),
          mountMat, [0, frontLy - legLen * 0.5, frontLz]);
      }
    } else {
      // 舷侧挂架座（贴壁）
      addPart(launcher, new THREE.BoxGeometry(boxW * 0.85, boxH * 0.35, boxD * 0.45),
        mountMat, [0, -boxH * 0.5 - turretSize * 0.1, boxD * 0.28]);
    }

    // 箱体（中灰重甲金属外壳）
    addPart(tiltGroup, new THREE.BoxGeometry(boxW, boxH, boxD), turretMat, [0, 0, 0]);

    // 顶部暗色识别脊（增加层次）
    addPart(tiltGroup, new THREE.BoxGeometry(boxW * 0.5, boxH * 0.20, boxD * 0.92),
      mountMat, [0, boxH * 0.55, 0]);

    // ── 发射管 + 导弹（正面 -Z）── 导弹粗短、钝头、几乎全在管内，仅鼻尖微露
    const tubeMat = MaterialFactory.get("engineCasing", ctx);  // 暗色管内
    const bodyMat = MaterialFactory.get("cannonBarrel", ctx);  // 亮金属弹体
    const headMat = MaterialFactory.get("weaponBase", ctx);    // 暗色弹头
    const tubesX = isFortress ? 3 : 2;
    const tubesY = isFortress ? 2 : (isCruiser ? 2 : 1);
    const tubeR = turretSize * 0.17;
    const tubeLen = turretSize * 0.5;
    const tubeMouthZ = -boxD * 0.5 - tubeLen;                  // 管口（最前）z
    const bodyR = tubeR * 0.92;                                // 弹体填满管口 → 不像细炮管
    const bodyLen = tubeLen * 0.92;                            // 弹体略短于管 → 整体在管内
    const noseLen = turretSize * 0.20;                         // 仅鼻锥微露
    const gapX = turretSize * 0.46;
    const gapY = turretSize * 0.46;
    for (let tx = 0; tx < tubesX; tx++) {
      for (let ty = 0; ty < tubesY; ty++) {
        const px = (tx - (tubesX - 1) / 2) * gapX;
        const py = (ty - (tubesY - 1) / 2) * gapY;
        // 暗色管内
        addPart(tiltGroup, new THREE.CylinderGeometry(tubeR, tubeR * 0.85, tubeLen, 10),
          tubeMat, [px, py, -boxD * 0.5 - tubeLen * 0.5], [Math.PI / 2, 0, 0]);
        // 导弹弹体（亮金属，完全在管内，前缘齐管口）
        addPart(tiltGroup, new THREE.CylinderGeometry(bodyR, bodyR, bodyLen, 12),
          bodyMat, [px, py, tubeMouthZ - bodyLen * 0.5], [Math.PI / 2, 0, 0]);
        // 导弹弹头（暗色钝锥，仅鼻尖微露管口）
        addPart(tiltGroup, new THREE.ConeGeometry(bodyR * 0.98, noseLen, 12),
          headMat, [px, py, tubeMouthZ - noseLen * 0.5], [-Math.PI / 2, 0, 0]);
      }
    }

    // 侧面一排暖橙待发指示灯（明显可见，不被遮挡）
    const ledMat = MaterialFactory.getGlow("laser", ctx, 2.4);
    const ledN = tubesX * tubesY;
    const ledR = turretSize * 0.075;
    for (let i = 0; i < ledN; i++) {
      const ly = (i - (ledN - 1) / 2) * (boxH * 0.34);
      addPart(tiltGroup, new THREE.SphereGeometry(ledR, 8, 6),
        ledMat, [boxW * 0.5 + ledR * 0.6, ly, boxD * 0.12]);
    }

    group.add(launcher);
  }
}

// ══ 骨架炮台（仅 Player Structure — 外露开敞式炮座）══
// 设计：开敞 yoke 挂载在顶部梁/侧面环上，细亮炮管朝前/侧。不是导弹、不是重炮塔，
//   而是"骨架上的轻炮"——呼应 SkeletalHull 的裸露工程语言。坐标独立于装甲炮塔。
// 骨架炮台（仅 Player Structure — 外露开敞式炮座，文档规划=炮）
// 改造：炮台随机贴装在圆筒装甲壳表面（与 SkeletalHull 的 shell 半径/分段/覆盖弧完全一致），
//   用径向法线做朝向，炮座扁盘贴住曲面 —— 不再固定在顶梁/侧环。
function addStructureTurrets(group, s, L, ctx) {
  const hull = ctx.profile.hull;
  const isFortress = hull.body === "fortress";
  const isCruiser = hull.body === "cruiser";

  const dims = ctx._fortressDims;
  if (!dims) return;
  const baseR = dims.hullR || dims.midR;            // = SkeletalHull 的 baseR
  const p = ctx.civ.hullParams || {};
  const frameExp = p.frameExposed || 0.85;
  const shellR = baseR * frameExp + 0.06 * s;       // 与 SkeletalHull 圆筒壳半径一致

  const sizeMul = ctx.style.weaponSizeMul || 1.0;
  const cls = (ctx.spec && ctx.spec.hull) || "";
  const classSc = cls.includes("battleship") ? 1.85 : cls.includes("cruiser") ? 1.55 : cls.includes("destroyer") ? 1.35 : 1.25;
  const ts = (isFortress ? 0.26 : isCruiser ? 0.22 : 0.17) * s * sizeMul * classSc;

  const mountMat = MaterialFactory.get("weaponBase", ctx);
  const beamMat = MaterialFactory.get("panelPlate", ctx);
  const barrelMat = MaterialFactory.get("cannonBarrel", ctx);
  const muzzleGlow = MaterialFactory.getGlow("laser", ctx, 1.4);

  // ── 圆筒壳覆盖参数（与 SkeletalHull 逐字一致，保证炮贴在同一条壳上）──
  const deckStyle = (ctx.spec && ctx.spec.deckStyle) || "half";
  const arc = deckStyle === "full" ? Math.PI * 2 : deckStyle === "most" ? Math.PI * 0.88 : Math.PI * 0.60;
  const centers = deckStyle === "full" ? [0] : [Math.PI * 1.5, Math.PI * 0.5];
  const segZ = [-0.30 * L, 0, 0.30 * L];
  const segLen = L * 0.24;

  // 数量随舰级递增
  const count = isFortress ? 6 : isCruiser ? 4 : cls.includes("destroyer") ? 3 : 2;

  const rng = ctx._rng || Math.random;

  // 候选 (段, 中心弧) 槽位洗牌，保证炮位在壳上分散、不重叠
  const slots = [];
  for (const cz of segZ) for (const c of centers) slots.push([cz, c]);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  const zLocal = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < count; i++) {
    let cz, a;
    if (deckStyle === "full") {
      cz = segZ[Math.floor(rng() * segZ.length)];
      a = rng() * Math.PI * 2;                      // 整圈圆筒：任意角
    } else {
      const slot = slots[i % slots.length];
      cz = slot[0];
      const c = slot[1];
      a = c + (rng() - 0.5) * arc * 0.82;           // 弧内随机，向内缩 18% 避边缘
    }
    const h = (rng() - 0.5) * segLen * 0.70;        // 段内纵向随机，避段缝
    // 圆筒壳表面点（与 SkeletalHull 的 CylinderGeometry 顶点公式一致：x=r·sin a, y=-r·cos a）
    const px = shellR * Math.sin(a);
    const py = -shellR * Math.cos(a);
    const pz = cz + h;

    const tur = new THREE.Group();
    tur.position.set(px, py, pz);

    // 朝向：local +Y = 径向法线（贴壳向外），local -Z = 船首方向(0,0,-1)
    const n = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0).normalize();
    const xLocal = new THREE.Vector3().crossVectors(n, zLocal).normalize();
    tur.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xLocal, n, zLocal));

    // 贴壳底座（扁盘，盘面平行于曲面切线），确保"贴上去"
    addPart(tur, new THREE.CylinderGeometry(ts * 0.9, ts * 1.0, ts * 0.12, 14), mountMat, [0, ts * 0.06, 0]);
    // 开敞式挂载座（暗色细框 + 亮金属转轴）
    const yokeH = ts * 0.45;
    addPart(tur, new THREE.BoxGeometry(ts * 0.8, yokeH, ts * 0.45), mountMat, [0, ts * 0.12 + yokeH * 0.5, 0]);
    addPart(tur, new THREE.CylinderGeometry(ts * 0.11, ts * 0.11, ts * 0.6, 8), beamMat, [0, ts * 0.12 + yokeH, 0]);

    // 炮管（1~2 根亮金属，朝 -Z）—— 明确是炮，不是导弹
    const isDual = isCruiser || isFortress;
    const barrels = isDual ? 2 : 1;
    const spread = ts * 0.2;
    const barrelLen = ts * 2.4;
    const barrelR = ts * 0.11;
    for (let b = 0; b < barrels; b++) {
      const bx = isDual ? (b === 0 ? -spread : spread) : 0;
      const bg = new THREE.Group();
      bg.position.set(bx, ts * 0.12 + yokeH + ts * 0.08, 0);
      addPart(bg, new THREE.CylinderGeometry(barrelR, barrelR * 0.85, barrelLen, 10),
        barrelMat, [0, 0, -barrelLen * 0.5], [Math.PI / 2, 0, 0]);
      addPart(bg, new THREE.SphereGeometry(barrelR * 0.7, 8, 6), muzzleGlow, [0, 0, -barrelLen]);
      tur.add(bg);
    }
    group.add(tur);
  }
}

// ══ 血袭者导弹发射器（仅 Blood — 邪教暴力改造武器语言）══
// 设计：圆润胶囊式导弹发射器（呼应 player_armor 的导弹定位），粗犷焊接底座 + 品红待发指示灯。
// 安装：用 OverloadedHull 覆写的 sampleHullSurface/normalAt 把发射架贴到鳐鱼背/翼表面。
// 数量 = ships.js 血袭者高槽（frigate=2 T1标准 / destroyer=bloodthorn=3 / cruiser=crimson=4 / battleship=crimson_bastion=5）。
function addBloodMissiles(group, s, L, ctx) {
  const cls = (ctx.spec && ctx.spec.hull) || "";
  const isBig = cls.includes("battleship");
  const isCru = cls.includes("cruiser");
  const isDest = cls.includes("destroyer");

  // ── EVE 血袭者高槽数（来源：ships.js bloodthorn/crimson/crimson_bastion 的 slots.high）──
  // blood 无护卫舰 → 护卫舰用 T1 标准 high=2
  const n = isBig ? 5 : isCru ? 4 : isDest ? 3 : 2;

  const classSc = isBig ? 1.7 : isCru ? 1.45 : isDest ? 1.25 : 1.1;
  const sizeMul = ctx.style.weaponSizeMul || 1.0;
  const turretSize = 0.22 * s * sizeMul * classSc;

  const shellMat = MaterialFactory.get("weaponBase", ctx);     // 暗色粗犷外壳
  const plateMat = MaterialFactory.get("panelPlate", ctx);     // 中灰金属面板
  const tubeMat  = MaterialFactory.get("engineCasing", ctx);   // 暗色管内
  const bodyMat  = MaterialFactory.get("cannonBarrel", ctx);   // 亮金属弹体
  const headMat  = MaterialFactory.get("weaponBase", ctx);     // 暗色弹头
  const ledMat   = MaterialFactory.getGlow("ribbon", ctx, 2.6); // 品红待发指示灯

  // 挂载槽：全部集中到鳐鱼前部（z<0），且严格左右对称
  //  n=2 → 一对翼；n=3 → 中线+一对翼；n=4 → 两对翼；n=5 → 中线+两对翼
  const P = Math.PI;
  const slots =
    n === 2 ? [[-0.26 * L,  0.36 * P], [-0.26 * L, -0.36 * P]] :
    n === 3 ? [[-0.30 * L, 0], [-0.25 * L,  0.36 * P], [-0.25 * L, -0.36 * P]] :
    n === 4 ? [[-0.30 * L,  0.36 * P], [-0.30 * L, -0.36 * P],
               [-0.18 * L,  0.34 * P], [-0.18 * L, -0.34 * P]] :
              [[-0.34 * L, 0],
               [-0.28 * L,  0.36 * P], [-0.28 * L, -0.36 * P],
               [-0.16 * L,  0.34 * P], [-0.16 * L, -0.34 * P]];

  // ══ 圆润胶囊尺寸（CapsuleGeometry 沿 Z 轴横放）══
  const capLen = turretSize * 1.9;       // 胶囊总长（Z 方向）
  const capRad = turretSize * 0.62;      // 胶囊截面半径（圆柱部分）
  const capEndRad = capRad;              // 端盖半球半径 = 截面半径（完美衔接）

  for (const [z, ang] of slots) {
    const surf = ctx.sampleHullSurface(z, ang, 0.01 * s);
    const nrm = (ctx.normalAt ? ctx.normalAt(z, ang) : new THREE.Vector3(0, 1, 0)).clone().normalize();

    const tur = new THREE.Group();
    tur.position.copy(surf);
    // 朝向：local +Y = 表面法线（向外），local -Z = 船首(-Z 世界)
    const yAxis = nrm;
    const zAxis = new THREE.Vector3(0, 0, 1);
    let xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    zAxis.crossVectors(xAxis, yAxis).normalize();
    tur.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));

    // 略微前倾（朝船首）
    const tilt = new THREE.Group();
    tilt.rotation.x = -0.12;
    tur.add(tilt);

    // ══ 真正的圆润胶囊壳体（Cylinder + 两端 Sphere）══
    // 坐标系：tilt 的 +Y = 表面外法线（向外），-Z = 船首方向
    // 胶囊沿 Z 轴横放，圆截面在 XY 平面
    const cylLen = Math.max(0.01, capLen - capRad * 2);   // 圆柱段长度（减两端半球）
    const seatY = -capRad * 0.50;                          // 下沉：让胶囊半嵌入曲面、不悬浮

    // 主体圆柱（沿 Z 轴）
    addPart(tilt, new THREE.CylinderGeometry(capRad, capRad, cylLen, 16, 1),
      shellMat, [0, seatY, 0], [Math.PI / 2, 0, 0]);
    // 前端半球（船首方向 -Z）
    addPart(tilt, new THREE.SphereGeometry(capEndRad, 14, 10),
      shellMat, [0, seatY, -cylLen / 2]);
    // 后端半球（船尾方向 +Z）
    addPart(tilt, new THREE.SphereGeometry(capEndRad, 14, 10),
      shellMat, [0, seatY, cylLen / 2]);

    // 顶部加强脊（扁胶囊条带，半嵌入主壳顶面，不悬浮）
    const spineLen = Math.max(0.01, capLen * 0.50);
    const spineR = turretSize * 0.12;
    addPart(tilt, new THREE.CapsuleGeometry(spineR, spineLen, 4, 10),
      plateMat, [0, seatY + capRad - spineR * 0.5, 0], [Math.PI / 2, 0, 0]);

    // 焊接绑带环（薄 Torus，环绕胶囊腰）
    for (const dz of [-capLen * 0.22, capLen * 0.22]) {
      addPart(tilt, new THREE.TorusGeometry(capRad * 0.92, turretSize * 0.04, 8, 20),
        plateMat, [0, seatY, dz], [Math.PI / 2, 0, 0]);
    }

    // ── 发射管 + 导弹（从前端半球面伸出，朝 -Z）──
    const tubesX = isBig ? 3 : 2;
    const tubesY = isBig ? 2 : 1;
    const tubeR = turretSize * 0.15;
    const tubeLen = turretSize * 0.50;
    const noseZ = -(capLen * 0.5);                        // 胶囊最前端 z
    const tubeMouthZ = noseZ - tubeLen * 0.45;            // 管口（从尖端伸出）
    const bodyR = tubeR * 0.92;
    const bodyLen = tubeLen * 0.88;
    const gapX = turretSize * 0.42;
    const gapY = turretSize * 0.42;
    for (let tx = 0; tx < tubesX; tx++) {
      for (let ty = 0; ty < tubesY; ty++) {
        const px = (tx - (tubesX - 1) / 2) * gapX;
        const py = (ty - (tubesY - 1) / 2) * gapY + seatY; // 以 seatY 为基准
        // 发射管（圆柱）
        addPart(tilt, new THREE.CylinderGeometry(tubeR, tubeR * 0.85, tubeLen, 12),
          tubeMat, [px, py, noseZ - tubeLen * 0.5], [Math.PI / 2, 0, 0]);
        // 导弹弹体
        addPart(tilt, new THREE.CylinderGeometry(bodyR, bodyR, bodyLen, 12),
          bodyMat, [px, py, tubeMouthZ - bodyLen * 0.5], [Math.PI / 2, 0, 0]);
        // 钝头鼻锥（球）
        addPart(tilt, new THREE.SphereGeometry(bodyR * 0.95, 10, 8),
          headMat, [px, py, tubeMouthZ - bodyLen * 0.5 - turretSize * 0.06]);
      }
    }

    // ══ 品红待发指示灯（仅尖端一颗，嵌在鼻锥内不超界）══
    addPart(tilt, new THREE.SphereGeometry(turretSize * 0.065, 10, 8),
      ledMat, [0, seatY, noseZ + turretSize * 0.04]);

    group.add(tur);
  }
}

// ══ Angel：轨道眼球炮（白金天使武器语言）══
// 白色球体 + 金色虹膜环（眼球花纹）—— 悬浮在船体周围轨道上，不贴表面。
// 数量按舰级递增，小舰集中前上方，大舰向两侧扩散。
function addAngelWeapons(group, s, L, ctx) {
  const tier = ctx.classTier;
  const { sampleHullSurface, normalAt } = ctx;
  const count = [2, 3, 4, 5][tier];               // 对齐 ships.js 高槽数
  const orbR = 0.14 * s * (1 + 0.30 * tier);   // 球体半径（随舰级涨）
  const orbitOff = orbR * 2.8;                   // 远离船体的轨道半径（放宽）
  const UP = new THREE.Vector3(0, 1, 0);

  // 前/上方向成对（所有舰级均有）
  const upperDefs = [
    { z: -0.20 * L, a: 0.62 },
  ];
  // 侧舷成对（仅巡洋/战列）
  const sideDefs = [
    { z: -0.08 * L, a: 1.45 },
  ];
  const slots = [];
  let placed = 0;
  // 始终取前上 1 对
  if (placed + 2 <= count) {
    const pd = upperDefs[0];
    slots.push({ z: pd.z, angle: pd.a }, { z: pd.z, angle: -pd.a });
    placed += 2;
  }
  // 巡洋及以上追加侧舷 1 对
  if (tier >= 2 && placed + 2 <= count) {
    const pd = sideDefs[0];
    slots.push({ z: pd.z, angle: pd.a }, { z: pd.z, angle: -pd.a });
    placed += 2;
  }
  // 奇数补顶部中线
  if (placed < count) slots.push({ z: -0.22 * L, angle: 0 });

  const goldMat = MaterialFactory.getGlow("ribbon", ctx, 2.6);
  goldMat.side = THREE.DoubleSide;
  const beamMat = MaterialFactory.getAdditive("exhaust", ctx, 0.4, THREE.DoubleSide);

  for (const sl of slots) {
    const surf = sampleHullSurface(sl.z, sl.angle, 0);
    const nrm = normalAt(sl.z, sl.angle);

    const eye = new THREE.Group();
    // 沿法线向外推 orbitOff 距离，悬浮在船体表面之外
    eye.position.copy(surf).addScaledVector(nrm, orbitOff);
    // 每个眼球朝向不同的"看"的方向——绕法线随机偏转，显得有生命感
    const qBase = new THREE.Quaternion().setFromUnitVectors(UP, nrm);
    const spin = ctx.scope("angelEye").random() * Math.PI * 2;
    const qSpin = new THREE.Quaternion().setFromAxisAngle(nrm, spin);
    eye.quaternion.copy(qBase.multiply(qSpin));

    // ① 白色球体（眼球本体）
    const eyeball = new THREE.Mesh(new THREE.SphereGeometry(orbR, 18, 14), ctx.steelMat);
    eye.add(eyeball);

    // ② 金色虹膜环——环绕球体赤道的 Torus（眼球花纹）
    const irisR = orbR * 1.04;
    const irisT = orbR * 0.18;
    const iris = new THREE.Mesh(new THREE.TorusGeometry(irisR, irisT, 10, 28), goldMat);
    eye.add(iris);

    // ③ 金色瞳孔——小半球凸起在虹膜环内（眼珠看向正前方）
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(orbR * 0.40, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      goldMat);
    pupil.position.z = orbR * 0.65;
    eye.add(pupil);

    // ④ 光束（从瞳孔发出的短锥光束）
    const beam = new THREE.Mesh(new THREE.ConeGeometry(orbR * 0.18, orbR * 1.2, 10, 1, true), beamMat);
    beam.position.z = orbR * 1.3;
    eye.add(beam);

    group.add(eye);
    // 注册浮动：每颗眼球独立上下起伏
    if (!group.userData.floaters) group.userData.floaters = [];
    group.userData.floaters.push({
      grp: eye, base: eye.position.clone(), phase: sl.z * 2.7, ampY: orbR * 0.5, ampZ: orbR * 0.2
    });
  }
}

// ══ Sansha：AI 激光炮塔（环形底座 + 菱形发射头 + 青绿光束）══
// 挂在十二面体笼子顶点上，径向朝外。绝对左右对称（x 镜像成对，奇数补 x=0 顶点）。
// 顶点来自 ctx._sanshaDims.verts（ModularHull Anchor Bus），数量对齐 ships.js 高槽 2/3/4/5。
function addSanshaWeapons(group, s, L, ctx) {
  const dims = ctx._sanshaDims;
  if (!dims) return;
  const tier = ctx.classTier;
  const count = [2, 3, 4, 5][tier];
  const { cageR, verts } = dims;
  const turretSize = cageR * (0.15 + 0.02 * tier);
  const UP = new THREE.Vector3(0, 1, 0);
  const PHI = (1 + Math.sqrt(5)) / 2;

  // 从 20 顶点中取与目标方向最接近的顶点
  const nearest = (x, y, z) => {
    const d = new THREE.Vector3(x, y, z).normalize();
    let best = verts[0], bd = -2;
    for (const v of verts) {
      const t = v.clone().normalize().dot(d);
      if (t > bd) { bd = t; best = v; }
    }
    return best;
  };

  // 每档槽位集合都严格 x 镜像对称：
  //   2 = 上前对；3 = 上前对 + 鼻顶点；4 = 上前对 + 上后对；5 = 四角 + 鼻顶点
  const slotDirs = {
    2: [[1, 1, -1], [-1, 1, -1]],
    3: [[1, 1, -1], [-1, 1, -1], [0, 1 / PHI, -PHI]],
    4: [[1, 1, -1], [-1, 1, -1], [1, 1, 1], [-1, 1, 1]],
    5: [[1, 1, -1], [-1, 1, -1], [1, 1, 1], [-1, 1, 1], [0, 1 / PHI, -PHI]],
  }[count];

  const casingMat = MaterialFactory.get("weaponBase", ctx);
  const glowMat = MaterialFactory.getGlow("engine", ctx, 1.8);
  glowMat.side = THREE.DoubleSide;
  const beamMat = MaterialFactory.getAdditive("exhaust", ctx, 0.3, THREE.DoubleSide);

  for (const sd of slotDirs) {
    const v = nearest(sd[0], sd[1], sd[2]);
    const dir = v.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);

    const tur = new THREE.Group();
    tur.position.copy(v);
    tur.quaternion.copy(q);

    // 环形底座（六边形截面，呼应模块语言）
    addPart(tur, new THREE.TorusGeometry(turretSize * 0.55, turretSize * 0.15, 6, 12),
      casingMat, [0, turretSize * 0.08, 0]);
    // 菱形发射头
    addPart(tur, new THREE.OctahedronGeometry(turretSize * 0.45),
      casingMat, [0, turretSize * 0.30, 0]);
    // 青绿发光透镜（嵌在菱形前端）
    addPart(tur, new THREE.SphereGeometry(turretSize * 0.25, 8, 6),
      glowMat, [0, turretSize * 0.50, 0]);
    // 光束锥
    addPart(tur, new THREE.ConeGeometry(turretSize * 0.08, turretSize * 1.0, 8, 1, true),
      beamMat, [0, turretSize * 0.72, 0]);

    group.add(tur);
  }
}

export function generateWeapons(ctx) {
  const { profile, s, L, spec } = ctx;
  const hull = profile.hull;
  const g = new THREE.Group();
  g.name = "weapons";

  const isShield = ctx.civ && ctx.civ.hullType === "lathe";
  const isArmor = ctx.civ && ctx.civ.hullType === "box";
  const isFrame = ctx.civ && ctx.civ.hullType === "frame";
  const isOverloaded = ctx.civ && ctx.civ.hullType === "overloaded";
  const isOrganic = ctx.civ && ctx.civ.hullType === "organic";
  const isModular = ctx.civ && ctx.civ.hullType === "modular";

  // ① 鼻前双刺（仅 Player Shield）
  if (isShield) addNoseSpikes(g, s, L, ctx);

  // ② 巨型结构环 + 环内浮游炮（仅 Player Shield）
  if (isShield) {
    const ringR = (hull.ringRadius || 3.0) * s;
    const ringCannons = spec.highSlots != null ? spec.highSlots : (hull.mounts || 6);
    addHaloRing(g, L, s, ctx, ringR, spec, ringCannons);
  }

  // ③ 激光挂点（仅 Player Shield）
  if (isShield) {
  const m = hull.mounts, big = (hull.body === "fortress");
  const slots = [];
  const getWingTip = () => {
    const wx = 0.5 * s + hull.wingSpan * s * Math.cos(0.42);
    const wz = -0.1 * L + hull.wingSpan * s * Math.sin(0.42);
    return [wx, wz];
  };
  const [wingTipX, wingTipZ] = getWingTip();
  if (hull.body === "dagger") {
    slots.push([-wingTipX, 0.0, wingTipZ], [wingTipX, 0.0, wingTipZ]);
  } else if (hull.body === "gunboat") {
    slots.push([0, 0.1 * s, -L * 0.44], [-0.45 * s, 0.04 * s, -L * 0.38], [0.45 * s, 0.04 * s, -L * 0.38]);
  } else if (hull.body === "cruiser") {
    const wm = 0.5 * s + hull.wingSpan * s * 0.5 * Math.cos(0.42);
    const wz = -0.1 * L + hull.wingSpan * s * 0.5 * Math.sin(0.42);
    slots.push([-wm, 0.0, wz], [-wingTipX, 0.0, wingTipZ], [wm, 0.0, wz], [wingTipX, 0.0, wingTipZ]);
  } else if (hull.body === "fortress") {
    const sx = hull.mid * s * 1.3 + 0.8 * s;
    slots.push([-sx, 0.08 * s, 0.04 * L], [sx, 0.08 * s, 0.04 * L],
      [-wingTipX, 0.0, wingTipZ], [wingTipX, 0.0, wingTipZ], [0, 0.12 * s, -L * 0.48]);
  }
  for (const [x, y, z] of slots.slice(0, m))
    addLaserPod(g, x, y, z, ctx, s, big);
  }

  // ⑤ 装甲炮塔（仅 Player Armor — Fortress Engineering 武器语言）
  if (isArmor) addArmorTurrets(g, s, L, ctx);

  // ⑥ 骨架炮台（仅 Player Structure — 外露开敞式炮座，文档规划=炮）
  if (isFrame) addStructureTurrets(g, s, L, ctx);

  // ⑥b 血袭者导弹发射器（仅 Blood — 邪教暴力改造武器语言，文档规划=导弹）
  if (isOverloaded) addBloodMissiles(g, s, L, ctx);

  // ⑥c Angel 能量透镜炮（仅 Angel — 生物机械武器语言，冰蓝发光透镜，beam 感）
  if (isOrganic) addAngelWeapons(g, s, L, ctx);

  // ⑥d Sansha AI 激光炮塔（完全对称，精密环形底座 + 菱形发射头）
  if (isModular) addSanshaWeapons(g, s, L, ctx);

  // ④ 护盾辉光层（青蓝调）
  // Sansha：护盾泡贴合笼子（cageR×1.32），而不是按船长估算（笼子是球对称的）
  if (spec.shield !== false) {
    const radius = (isModular && ctx._sanshaDims)
      ? ctx._sanshaDims.cageR * 1.32
      : L * 0.58 + 0.5 * s;
    g.userData.shield = addShieldBubble(g, radius, ctx);
  }

  return g;
}
