// FunctionalMountGenerator.js — 功能舰签名挂载（识别度核心）
//
// 职责：为工业 / 考古舰生成"一眼能认出用途"的挂载件，替代战斗炮塔。
//   - 工业·采矿（miner_*）：前向采矿激光臂（细长锥形激光发射器）
//   - 工业·采气（gas_*）：前向采矿臂式发射器（与采矿同造型，青绿辉光霰）
//   - 工业·支援（dolphin）：指挥天线 + 少量挂载
//   - 工业·旗舰（orca）：大型采矿阵列 + 工业指挥结构
//   - 考古（heron/tracer/starmap/farscope/illuminator）：扫描阵列（前向 pylons）+ 探针发射舱（尾部 nacelles）
//
// 严格 X 镜像对称；挂载数量随 classTier 递增（大船不只是放大版小船）。
// 与 WeaponGenerator 正交：功能舰不挂战斗炮塔（generateWeapons 对其不产生炮塔，仅护盾泡）。
import * as THREE from "three";
import { rbox, addPart } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

// 采矿 / 采气臂：从鼻端伸出的长臂 + 发光晶尖
// sc: 缩放因子（= midR 或 s），保证臂粗随舰级递增
function addHarvestArm(group, x, y, z, len, baseMat, tipColor, sc = 1, yRot = 0) {
  // 整臂作为一个 Group（臂基在 [x,y,z]，旋转对整个臂生效）
  const ag = new THREE.Group();
  ag.position.set(x, y, z);
  ag.rotation.x = 0.35; // 向前上扬
  ag.rotation.y = yRot; // Y 偏转（侧挂臂朝外张开）
  group.add(ag);

  const aw = Math.max(0.2, sc * 0.36);
  const ah = Math.max(0.14, sc * 0.26);
  ag.add(rbox(aw, ah, len, Math.max(0.01, sc * 0.05), baseMat, [0, 0, -len * 0.5]));
  const tipR = Math.max(0.3, sc * 0.8);
  const tipZ = -len;   // 臂尖在 Group 局部坐标中
  // inline：创建 mesh 加入 armGroup
  function m(geo, mat, pos, rot) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    ag.add(mesh);
    return mesh;
  }
  // 发射器（采气和采矿造型相同，仅发光色不同）
  const emitR = Math.max(0.35, sc * 0.9);
  const ez = tipZ + emitR * 1.2;
  m(new THREE.CylinderGeometry(emitR * 0.55, emitR * 0.16, emitR * 2.6, 14),
    baseMat, [0, tipR * 0.5, ez], [Math.PI / 2, 0, 0]);
  m(new THREE.CylinderGeometry(emitR * 0.16, emitR * 0.16, emitR * 3.0, 12),
    MaterialFactory.getGlowColor(tipColor, 2.6), [0, tipR * 0.5, ez + emitR * 0.2], [Math.PI / 2, 0, 0]);
  m(new THREE.TorusGeometry(emitR * 0.5, emitR * 0.09, 8, 18),
    MaterialFactory.getGlowColor(tipColor, 2.2), [0, tipR * 0.5, tipZ + emitR * 0.05], [Math.PI / 2, 0, 0]);
}

// 扫描阵列：前向细桅 + 顶部发光扫描头
function addScanPylon(group, x, y, z, h, baseMat, tipColor) {
  const mast = addPart(group, new THREE.CylinderGeometry(0.05, 0.08, h, 8), baseMat, [x, y + h * 0.5, z]);
  addPart(group, new THREE.SphereGeometry(0.14, 12, 10),
    MaterialFactory.getGlowColor(tipColor, 2.0), [x, y + h, z]);
}

// 探针发射舱：尾部 nacelle + 发光探针头
function addProbeNacelle(group, x, y, z, baseMat, tipColor) {
  const pod = rbox(0.18, 0.18, 0.5, 0.04, baseMat, [x, y, z]);
  group.add(pod);
  addPart(group, new THREE.SphereGeometry(0.12, 12, 10),
    MaterialFactory.getGlowColor(tipColor, 1.8), [x, y, z + 0.35]);
}

// 功能舰高槽数（与 js/data/ships.js 一致）
function getHighSlots(fn, hull) {
  const h = hull.replace(/^(industrial_|archaeology_|player_)/, '');
  if (h === 'support') return 2;             // 海豚级固定 2 高槽
  const map = { frigate:2, destroyer:3, cruiser:3, battleship:4, capital:4 };
  return map[h] || 2;
}

export function generateFunctionalMounts(ctx) {
  const { s, L } = ctx;
  const g = new THREE.Group();
  g.name = "functionalMounts";

  const hullType = ctx.civ && ctx.civ.hullType;
  if (hullType !== "industrial" && hullType !== "archaeology") return g; // 仅功能舰

  const fn = (hullType === "archaeology")
    ? "archaeology"
    : (ctx.spec.function || "mining");

  // 挂载数 = 对应舰级的高槽数（不再硬编码 classTier 递增）
  const count = getHighSlots(fn, ctx.spec.hull);

  // ── 工业：采矿臂 / 采气采集器 / 支援天线 ──
  if (hullType === "industrial") {
    const d = ctx._industrialDims;
    const hw = d ? d.hullW * 0.42 : 0.6 * s;
    const noseZ = d ? d.noseZ : -L * 0.42;
    const amber = ctx.palette.glow;       // 工业调色板辉光（琥珀）
    const teal = 0x57e0c8;                // 采气固定青色
    const tip = fn === "gas" ? teal : amber;
    const baseMat = MaterialFactory.get(fn === "gas" ? "gasArm" : "miningArm", ctx);
    const armLen = (d ? d.hullLen : L) * (fn === "support" ? 0.24 : 0.44);
    const sc = d ? d.midR : midR;   // 臂粗/晶尖尺寸随舰级

    // 臂阵列：≤3 臂全鼻锥前向；4 臂 = 2 前向（鼻锥左右）+ 2 侧挂（船身两侧较后）
    // 支援舰：2 臂根部贴在横向圆筒左右端面中心，略朝外张
    if (fn === "support") {
      const endX = d ? d.crossArmX : hullW * 0.9;
      const cz = d ? d.crossArmZ : noseZ;
      const SPLAY = 0.25;
      addHarvestArm(g, -endX, 0.0, cz, armLen * 0.6, baseMat, tip, sc,  SPLAY);
      addHarvestArm(g,  endX, 0.0, cz, armLen * 0.6, baseMat, tip, sc, -SPLAY);
    } else if (count <= 3) {
      const xs = count <= 2 ? [-hw, hw] : [-hw, 0, hw];
      const ys = [0.0, d ? d.hullH * 0.25 : 0.2 * s];
      let placed = 0;
      for (const y of ys) {
        for (const x of xs) {
          if (placed >= count) break;
          addHarvestArm(g, x, y, noseZ, armLen, baseMat, tip, sc);
          placed++;
        }
      }
    } else {
      // count === 4（战列/旗舰）：2 前向 + 2 侧挂
      const sideZ = noseZ + (d ? d.hullLen * 0.40 : L * 0.28);   // 船身中部靠前
      const sideX = (d ? d.hullW * 0.55 : 0.7 * s);              // 船体左右外侧
      const Y_SPLAY = 0.4;  // 侧臂向外偏转角
      addHarvestArm(g, -hw, 0.0, noseZ, armLen, baseMat, tip, sc);
      addHarvestArm(g,  hw, 0.0, noseZ, armLen, baseMat, tip, sc);
      addHarvestArm(g, -sideX, 0.0, sideZ, armLen * 0.85, baseMat, tip, sc,  Y_SPLAY);
      addHarvestArm(g,  sideX, 0.0, sideZ, armLen * 0.85, baseMat, tip, sc, -Y_SPLAY);
    }
    // 支援舰的指挥天线阵列已移至 IndustrialHull.isSupport 专属块生成（多桅组 + 信号球）
    return g;
  }

  // ── 考古：扫描阵列 + 探针发射舱 ──
  const d = ctx._archaeologyDims;
  const fusR = d ? d.fusR : 0.6 * s;
  const fusLen = d ? d.fusLen : L * 0.86;
  const scan = ctx.palette.glow;  // 考古调色板辉光（青绿扫描）
  const baseMat = MaterialFactory.get("scanPylon", ctx);
  const noseZ = d ? d.noseZ : -fusLen * 0.6;
  const TIERS = { frigate:0, destroyer:1, cruiser:2, battleship:3, capital:4 };
  const classTier = TIERS[ctx.spec.hull.replace(/^(industrial_|archaeology_|player_)/, '')] || 0;

  // 前向扫描阵列（X 镜像）
  const nScan = Math.min(count, 4);
  const sx = fusR * 0.7;
  for (let i = 0; i < nScan; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const idx = Math.floor(i / 2);
    const h = fusR * (1.0 + 0.4 * idx);
    addScanPylon(g, side * sx, fusR * (d ? d.widthRatio : 0.85) * 0.6, noseZ + idx * fusLen * 0.12, h, baseMat, scan);
  }

  // 尾部探针发射舱（X 镜像，>= 巡洋出现）
  if (classTier >= 2) {
    const nProbe = classTier >= 4 ? 2 : 1;
    const px = fusR * 0.8;
    const pz = fusLen * 0.42;
    const py = -fusR * (d ? d.widthRatio : 0.85) * 0.4;
    for (const side of [-1, 1]) {
      for (let i = 0; i < nProbe; i++) {
        addProbeNacelle(g, side * px, py, pz + i * 0.5, MaterialFactory.get("probePod", ctx), scan);
      }
    }
  }

  return g;
}
