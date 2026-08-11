// ship3d.js — 游戏主界面 3D 舰船外观层（ES module）
//
// 职责：
//   1. 把游戏舰船 id 映射为 ShipFactory2.buildShip 所需的 spec（SHIP_3D_SPEC 逻辑）。
//   2. 提供可复用的 3D 查看器（OrbitControls 可拖拽 / 战斗 rAF 左右晃动 / 装配环半径自动取景）。
//   3. 提供静态截图捕获（船坞列表一次性缩略图，规避 WebGL 上下文上限）。
//   4. 通过 window.Ship3D 暴露 API 给经典 <script defer> 调用（桥接）。
//
// 依赖：importmap 必须提供 "three" 与 "three/addons/"（见 index.html）。

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildShip } from "../render3d/shipfactory2/ShipFactory2.js";

/* ================================================================
   可复用场景工具（移植自 three-demo.js，统一观感）
   ================================================================ */

// 可观测诊断计数器（模块级）：用于审计/浏览器验收断言「WebGL 上下文创建次数」。
//   _rendererCreateCount：所有 WebGLRenderer 创建总数（createRenderer 是唯一 choke point）。
//   _viewerCreateCount ：createViewer 成功创建查看器次数（弹窗查看器应只创建一次）。
//   _thumbCreateCount  ：缩略图离屏渲染器创建次数（单例，应只创建一次；dispose 后再建 +1）。
// 通过 window.Ship3D.getDiagnostics() 读取实时值（不能直接暴露 let 值——桥接对象在模块加载
// 时快照会永远是 0）。
let _rendererCreateCount = 0;
let _viewerCreateCount = 0;
let _thumbCreateCount = 0;

function createRenderer(canvas, preserveDrawingBuffer = false) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer
  });
  _rendererCreateCount++;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  return renderer;
}

function addLighting(scene, warm = false) {
  scene.add(new THREE.HemisphereLight(0x86b9d8, 0x11171e, 1.0));
  const key = new THREE.DirectionalLight(warm ? 0xffc07d : 0xdcecff, 3.0);
  key.position.set(-6, 9, 5);
  scene.add(key);
  const rim = new THREE.PointLight(warm ? 0xff4b35 : 0x2fb9ff, 12, 30, 2);
  rim.position.set(7, 1, -5);
  scene.add(rim);
}

function resizeRenderer(renderer, camera) {
  const canvas = renderer.domElement;
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelRatio = renderer.getPixelRatio();
  if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function makeStarField(count = 520, radius = 60) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * (0.72 + Math.random() * 0.28);
    points.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x9fc9e5, size: 0.07, transparent: true, opacity: 0.7 }));
}

// 材质可能携带的逐槽位贴图（不含 envMap：envMap 通常来自场景共享环境，单舰销毁时
// 释放会破坏其它材质，故显式排除）。disposeShipObject 统一处理这些槽位——既覆盖当前
// 实际使用的 material.map（危险条纹单例），也为将来可能出现的 emissiveMap/normalMap 等
// 预留一致的释放路径，避免纹理泄漏。审计（Section C）会锁定「当前仅 map 被使用」的现状。
const TEXTURE_SLOTS = [
  "map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap",
  "alphaMap", "aoMap", "bumpMap", "displacementMap", "lightMap", "specularMap"
];

// 释放单艘舰船模型的 GPU 资源（Task 8：明确 3D 资源所有权）。
// 关键约定：
//   1. 用 Set 去重——同一 geometry/material/texture 可能被多个 mesh / 多个槽位引用
//      （如 addEdgeOutline 的描边 mesh 直接复用父 mesh 的 geometry；material.map 与
//      emissiveMap 可能指向同一张纹理），去重后每个资源只 dispose 一次。
//   2. 共享材质（跨舰复用的缓存，如 Materials._outlineMatCache）标记
//      userData.ship3dShared=true，单舰销毁时跳过，绝不释放——否则会让其它查看器的
//      同色描边材质失效/重编译。
//   3. 共享纹理（如 MaterialFactory 的 hazardStripe 单例 CanvasTexture）同样标记
//      userData.ship3dShared=true，销毁本舰专属材质时不释放其 map。
//   本舰专属 geometry/material（每次 buildShip 新建）照常释放。
function disposeObject(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material);
      for (const slot of TEXTURE_SLOTS) {
        const tex = material[slot];
        if (tex && tex.isTexture) textures.add(tex);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    // 共享材质：跨舰复用，禁止在单舰销毁时释放
    if (material.userData && material.userData.ship3dShared) continue;
    material.dispose();
  }
  for (const tex of textures) {
    // 共享纹理：单舰销毁时跳过
    if (tex.userData && tex.userData.ship3dShared) continue;
    tex.dispose();
  }
}

// 正式资源生命周期 API（与内部 disposeObject 同一实现，供审计与调用方显式释放单舰资源）。
export function disposeShipObject(root) {
  disposeObject(root);
}

/* ================================================================
   游戏舰船 id → buildShip spec 映射（SHIP_3D_SPEC 逻辑）
   ================================================================ */

function getShipData() {
  return (typeof window !== "undefined" && window.SHIP_DATA) || null;
}

const PIRATE_FACTIONS = ["angel", "blood", "sansha"];

function enemyFactionFromZone(zoneFaction) {
  return PIRATE_FACTIONS.includes(zoneFaction) ? zoneFaction : PIRATE_FACTIONS[Math.floor(Math.random() * PIRATE_FACTIONS.length)];
}

function hullTierFromLevel(level) {
  const lv = Number(level) || 1;
  if (lv <= 15) return "frigate";
  if (lv <= 30) return "destroyer";
  if (lv <= 45) return "cruiser";
  if (lv <= 60) return "battleship";
  if (lv <= 80) return "capital";
  return "supercapital";
}

function weaponForFaction(faction) {
  if (faction === "angel") return "laser";
  if (faction === "blood") return "missile";
  if (faction === "sansha") return "cannon";
  return "laser";
}

function anchorForFaction(faction) {
  switch (faction) {
    case "player_armor": return "Blade";
    case "player_structure": return "Hammer";
    case "angel": return "Organic";
    default: return "Spear";
  }
}

// 给定游戏舰船 id，返回 buildShip 所需的完整 spec。
// 六族战斗舰映射规则（数据驱动、可解释）：
//   - 工业舰（INDUSTRIAL_SHIPS）→ faction "industrial"（ShipContext 强制 anchor=Industrial）
//   - 考古舰（ARCHAEOLOGY_SHIPS）→ faction "archaeology"（ShipContext 强制 anchor=Archaeology）
//   - 战斗舰（STARTER_SHIPS）：
//       · 蓝图舰（unlock.type === "blueprint"）→ 用 counterFaction（angel/blood/sansha）海盗族
//       · 玩家自造舰（shield/armor/structure 专精）→ 由 recommendedWeapon 映射到 player_shield / player_armor / player_structure
//   其余字段：hull 取数据里的 type（工业/考古带前缀，ShipContext 会剥离），weapon 取 recommendedWeapon，seed 用 shipId 保证可复现。
export function buildSpecForShip(shipId, overrides = {}) {
  const data = getShipData();
  let def = null, kind = null;
  if (data) {
    if (data.STARTER_SHIPS && data.STARTER_SHIPS[shipId]) { def = data.STARTER_SHIPS[shipId]; kind = "combat"; }
    else if (data.INDUSTRIAL_SHIPS && data.INDUSTRIAL_SHIPS[shipId]) { def = data.INDUSTRIAL_SHIPS[shipId]; kind = "industrial"; }
    else if (data.ARCHAEOLOGY_SHIPS && data.ARCHAEOLOGY_SHIPS[shipId]) { def = data.ARCHAEOLOGY_SHIPS[shipId]; kind = "archaeology"; }
  }
  if (!def) {
    return { id: shipId, faction: "player_shield", hull: "frigate", anchor: "Spear", weapon: "laser", seed: shipId, ...overrides };
  }
  if (kind === "industrial") {
    return { id: shipId, faction: "industrial", hull: def.type, anchor: "Industrial", weapon: def.recommendedWeapon || "laser", seed: shipId, ...overrides };
  }
  if (kind === "archaeology") {
    return { id: shipId, faction: "archaeology", hull: def.type, anchor: "Archaeology", weapon: def.recommendedWeapon || "laser", seed: shipId, ...overrides };
  }
  // combat
  let faction;
  if (def.unlock && def.unlock.type === "blueprint") faction = def.counterFaction; // 海盗混血
  else {
    const w = def.recommendedWeapon;
    if (w === "missile") faction = "player_armor";
    else if (w === "cannon") faction = "player_structure";
    else faction = "player_shield";
  }
  return {
    id: shipId,
    faction,
    hull: def.type,
    anchor: anchorForFaction(faction),
    weapon: def.recommendedWeapon || "laser",
    seed: shipId,
    ...overrides
  };
}

// 敌方随机锚点池：仅战斗型锚点（Industrial/Archaeology 是功能舰专属，不用于海盗战斗舰）。
const ENEMY_ANCHORS = ["Spear", "Needle", "Blade", "Hammer", "Organic", "Broken", "Lotus"];

// 战斗敌人 spec：由星带 faction + 威胁等级推导（敌人是泛用海盗，无专属蓝图）。
// anchor 与 seed 均随机，使每一波敌人轮廓/细节都不同；实际只在切波时 buildShip 一次，无性能负担。
export function buildEnemySpec(zoneFaction, level) {
  const faction = enemyFactionFromZone(zoneFaction);
  const hull = hullTierFromLevel(level);
  const anchor = ENEMY_ANCHORS[Math.floor(Math.random() * ENEMY_ANCHORS.length)];
  return {
    id: "enemy-" + faction + "-" + hull,
    faction,
    hull,
    anchor,
    weapon: weaponForFaction(faction),
    seed: "enemy-" + faction + "-" + hull
  };
}

/* ================================================================
   3D 查看器
   ================================================================ */

function autoFit(handle) {
  if (!handle.root) return;
  const box = new THREE.Box3().setFromObject(handle.root);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = 0.5 * Math.max(size.x, size.y, size.z, 0.5);
  const fov = (handle.camera.fov * Math.PI) / 180;
  // 战斗场景（无 controls / orbit:false）用紧凑系数让船填满小容器；
  // 船坞/制造（有 controls，可拖拽）也压近，让船在画面中占比更大。
  const fitScale = handle.controls ? 0.8 : 0.65;
  const dist = (radius / Math.sin(fov / 2)) * fitScale;
  const dir = new THREE.Vector3(0.55, 0.32, -0.77).normalize();
  handle.camera.position.copy(center).add(dir.multiplyScalar(dist));
  const minDist = radius * 1.05;
  handle.camera.near = Math.max(0.05, minDist - radius * 0.8);
  handle.camera.far = dist + radius * 6;
  handle.camera.updateProjectionMatrix();
  if (handle.controls) {
    handle.controls.target.copy(center);
    handle.controls.minDistance = minDist;
    handle.controls.maxDistance = dist * 2.6;
    handle.controls.update();
  }
}

// 创建一个持久的 3D 查看器（绑定到一个 canvas）。
// opts: { orbit, autoSpin, background, cameraPos, fov, autoFit }
export function createViewer(canvas, opts = {}) {
  const {
    orbit = false,
    autoSpin = false,
    background = 0x0a121e,
    cameraPos = [9, 5.5, -13],
    fov = 34,
    autoFit: doAutoFit = true
  } = opts;

  const handle = { canvas, ships: [], disposed: false, raf: null, error: null, _specKey: "", contextLost: false, _onContextLost: null, _onContextRestored: null, _previousCanvasTitle: undefined, _previousCanvasAria: undefined };

  try {
    const renderer = createRenderer(canvas, false);
    const scene = new THREE.Scene();
    if (background != null) scene.background = new THREE.Color(background);
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 400);
    camera.position.set(...cameraPos);
    camera.lookAt(0, 0, 0);
    addLighting(scene);
    scene.add(makeStarField());
    const root = new THREE.Group();
    scene.add(root);

    let controls = null;
    if (orbit) {
      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.autoRotate = autoSpin;
      controls.autoRotateSpeed = 0.9;
      controls.target.set(0, 0, 0);
      controls.minDistance = 1.2;
      controls.maxDistance = 200;
      controls.update();
    }

    handle.renderer = renderer;
    handle.scene = scene;
    handle.camera = camera;
    handle.root = root;
    handle.controls = controls;
    handle._autoFit = doAutoFit;
    handle._needsAutoFit = false;

    // ---- WebGL 上下文丢失 / 恢复安全处理（Task 9 定点返修）----
    // 仅在此处（createViewer 成功创建 renderer 后）为每个 canvas 安装应用层监听，
    // 处理器函数引用保存在 handle，供 disposeViewer 精确解绑。
    // 设计原则：
    //   1. 丢失时 preventDefault 允许浏览器尝试异步恢复；不 dispose、不重建 renderer/frame、不清除 ships。
    //   2. CPU 侧场景对象保持完好 → restored 后 Three.js 自行重传 GPU 资源，下一帧自然恢复。
    //   3. 仅写显示层（dataset + title/aria-label + 可选 toast），绝不写 gameState / handle.error。
    function onContextLost(e) {
      if (handle.disposed) return;
      e.preventDefault();                       // 允许浏览器尝试异步恢复
      if (handle.contextLost) return;           // 幂等：仅首次 正常→lost 进入处理
      handle.contextLost = true;
      // 快照原语义（仅首次），restored 时还原，避免永久覆盖玩家原本的 title/aria。
      if (handle._previousCanvasTitle === undefined) {
        handle._previousCanvasTitle = canvas.getAttribute("title");
        handle._previousCanvasAria = canvas.getAttribute("aria-label");
      }
      canvas.dataset.ship3dContext = "lost";
      canvas.setAttribute("title", "3D 渲染暂时中断；若未自动恢复请刷新页面");
      canvas.setAttribute("aria-label", "3D 渲染暂时中断；若未自动恢复请刷新页面");
      if (typeof window.showToast === "function") {
        try { window.showToast("3D 渲染暂时中断，正在尝试恢复；若长时间未恢复请刷新页面"); }
        catch (_) { /* 主游戏不可受影响 */ }
      } else {
        console.warn("[Ship3D] WebGL 上下文丢失，3D 渲染暂时中断；若未自动恢复请刷新页面");
      }
    }
    function onContextRestored() {
      if (handle.disposed) return;
      if (!handle.contextLost) return;          // 幂等：仅 lost→restored 进入处理
      handle.contextLost = false;
      delete canvas.dataset.ship3dContext;
      // 还原 canvas 原有 title/aria-label 语义（不永久覆盖）
      if (handle._previousCanvasTitle !== undefined) {
        if (handle._previousCanvasTitle == null) canvas.removeAttribute("title");
        else canvas.setAttribute("title", handle._previousCanvasTitle);
        if (handle._previousCanvasAria == null) canvas.removeAttribute("aria-label");
        else canvas.setAttribute("aria-label", handle._previousCanvasAria);
        handle._previousCanvasTitle = undefined;
        handle._previousCanvasAria = undefined;
      }
      handle._needsAutoFit = true;              // 下次有效布局重新取景（Three.js 负责内部 GPU 资源重传）
      if (typeof window.showToast === "function") {
        try { window.showToast("3D 渲染已恢复"); }
        catch (_) { /* 主游戏不可受影响 */ }
      }
    }
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);
    handle._onContextLost = onContextLost;
    handle._onContextRestored = onContextRestored;

    const clock = new THREE.Clock();
    let last = 0;
    function frame() {
      if (handle.disposed) return;
      handle.raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      if (handle.contextLost) return;           // 上下文丢失：跳过渲染（不重建/不 dispose），restored 后自然恢复
      // 画布未布局（如弹窗隐藏、clientWidth/Height=0）时跳过渲染，避免 1x1 空转/浪费 GPU
      if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
      const now = performance.now();
      const delta = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      const t = clock.getElapsedTime();
      for (const s of handle.ships) {
        if (s.sway) {
          s.group.position.y = s.baseY + Math.sin(t * 1.25 + s.phase) * 0.16;
          s.group.rotation.z = s.baseRotZ + Math.sin(t * 0.8 + s.phase) * 0.03;
        }
      }
      if (autoSpin && !orbit) root.rotation.y += delta * 0.3;
      if (controls) controls.update();
      resizeRenderer(renderer, camera);
      // 延迟 autoFit：canvas 首次 append 后浏览器可能尚未布局，
      // 等 resizeRenderer 确认画布有有效尺寸后再取景（避免基于 0 尺寸算出错误距离）。
      if (handle._needsAutoFit && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        handle._needsAutoFit = false;
        autoFit(handle);
      }
      renderer.render(scene, camera);
    }
    handle.raf = requestAnimationFrame(frame);
    _viewerCreateCount++;   // 仅在渲染器/场景成功搭建后计数（error 分支不计）
  } catch (err) {
    console.error("[Ship3D] viewer 初始化失败：", err);
    handle.error = err;
  }
  return handle;
}

// 安全更新已存在查看器的清屏背景色（Task 6：战斗大图切换我方/敌方时背景复用问题）。
// 复用同一 WebGL 上下文，只改 scene.background，不重建 renderer。
// color==null → 透明背景（scene.background=null）。
export function setBackground(handle, color) {
  if (!handle || !handle.scene) return;
  if (color == null) { handle.scene.background = null; return; }
  if (handle.scene.background && handle.scene.background.isColor) {
    handle.scene.background.set(color);
  } else {
    handle.scene.background = new THREE.Color(color);
  }
}

// 设置/更新查看器中的舰船。specs: [{ spec, position?, scale?, rotation?, sway?, shieldColor? }]
// Task 5：去重 key 覆盖所有影响显示的字段（spec/position/scale/rotation/sway/shieldColor），
//   同一 spec 但位姿/护盾色变化也会更新。构建采用「原子替换」：先在临时列表建好所有舰船，
//   仅在全部成功后才清旧模型并替换；任一失败保留旧模型、不写成功缓存 key，允许下次重试。
export function setShips(handle, specs) {
  if (!handle || handle.error) return;
  const list = specs || [];
  // 统一推导显示字段：缓存 key 与应用阶段必须基于同一推导，消除 falsy 边界语义分裂。
  //   - scale：非正有限数（含 0 / undefined / NaN）归一为 1；key 与应用都用 effScale。
  //   - shieldColor：仅当有限数字才视为有效；0 是合法黑色，必须应用；undefined → null（不重染）。
  const norm = list.map((s) => ({
    spec: s.spec,
    position: s.position || null,
    scale: (typeof s.scale === "number" && isFinite(s.scale) && s.scale > 0) ? s.scale : 1,
    rotation: s.rotation || null,
    sway: !!s.sway,
    shieldColor: (typeof s.shieldColor === "number" && isFinite(s.shieldColor)) ? s.shieldColor : null
  }));
  const key = JSON.stringify(norm);
  if (key === handle._specKey) return;

  // 先原子构建到临时列表——不触碰当前显示的旧模型
  const built = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const n = norm[i];
      const group = buildShip(item.spec);
      const pos = item.position || [0, 0, 0];
      group.position.set(...pos);
      group.scale.setScalar(n.scale);          // 统一用 effScale：scale=0 已归一为 1，避免 if(item.scale) 忽略导致的漂移
      if (n.rotation) group.rotation.set(...n.rotation);
      // 护盾泡重着色：覆盖 ShipFactory2 写死的 SHIELD_COLOR（青蓝）。
      // 仅当显式传入有效 shieldColor（含 0=黑）时重染，undefined 不重染。
      if (n.shieldColor != null) {
        const sc = new THREE.Color(n.shieldColor);
        group.traverse((o) => {
          if (o.isMesh && (o.name === "shield" || (o.parent && o.parent.name === "shield"))) {
            if (o.material && o.material.color) o.material.color.copy(sc);
          }
        });
      }
      built.push({
        group,
        baseY: pos[1],
        baseRotZ: group.rotation.z,
        phase: Math.random() * 6.28,
        sway: !!item.sway
      });
      handle._buildCount = (handle._buildCount || 0) + 1;   // 可观测诊断：每次真实 build 计数
    }
  } catch (err) {
    // 构建失败：释放已建的临时对象，保留旧模型，不更新 _specKey（下次可重试）
    console.error("[Ship3D] setShips 构建失败，保留旧模型：", err);
    for (const b of built) disposeObject(b.group);
    return;
  }

  // 全部构建成功 → 原子替换：释放旧模型并挂载新模型
  for (const s of handle.ships) disposeObject(s.group);
  handle.root.clear();
  handle.ships = built;
  for (const b of built) handle.root.add(b.group);
  handle._specKey = key;

  if (handle._autoFit) handle._needsAutoFit = true;
}

export function disposeViewer(handle) {
  if (!handle) return;
  handle.disposed = true;
  // 先精确解绑 context 监听，避免随后的 forceContextLoss 触发已解绑之后的监听提示
  if (handle.canvas) {
    if (handle._onContextLost) {
      handle.canvas.removeEventListener("webglcontextlost", handle._onContextLost, false);
      handle._onContextLost = null;
    }
    if (handle._onContextRestored) {
      handle.canvas.removeEventListener("webglcontextrestored", handle._onContextRestored, false);
      handle._onContextRestored = null;
    }
  }
  if (handle.raf) cancelAnimationFrame(handle.raf);
  for (const s of handle.ships) disposeObject(s.group);
  if (handle.root) handle.root.clear();
  if (handle.controls) handle.controls.dispose();
  if (handle.renderer) {
    handle.renderer.dispose();
    if (handle.renderer.forceContextLoss) handle.renderer.forceContextLoss();
  }
}

// 按 canvas 维护持久查看器（WeakMap），供经典脚本反复 ensure。
const _viewers = new WeakMap();
export function ensureViewer(canvas, opts) {
  if (!canvas) return null;
  let h = _viewers.get(canvas);
  if (!h || h.disposed) {
    h = createViewer(canvas, opts);
    _viewers.set(canvas, h);
  }
  return h;
}

/* ================================================================
   缩略图渲染器单例（Task 7：重构船坞缩略图 renderer 生命周期）
   ----------------------------------------------------------------
   旧实现每张缩略图都 new WebGLRenderer + render + dispose + forceContextLoss，
   与「第二个 3D 弹窗白屏」同类风险（快速反复创建/丢弃 WebGL 上下文）。
   现改为单例离屏渲染器：renderer / scene / camera / lights / starfield 只创建一次，
   每张缩略图只做「建当前舰 → 加入共享场景 → 渲染 → 导出 → 移除并释放当前舰资源」，
   绝不 per-ship forceContextLoss。静态资源（starfield 等）仅在 disposeThumbnailRenderer
   （页面卸载）时释放。缩略图尺寸/角度/WebP 质量保持不变。
   ================================================================ */
let _thumbRenderer = null;

function ensureThumbRenderer(width, height) {
  if (_thumbRenderer && !_thumbRenderer.disposed) {
    const p = _thumbRenderer;
    if (p.w !== width || p.h !== height) {
      p.renderer.setSize(width, height, false);
      p.camera.aspect = width / height;
      p.camera.updateProjectionMatrix();
      p.w = width; p.h = height;
    }
    return p;
  }
  const canvas = document.createElement("canvas");
  const renderer = createRenderer(canvas, true);
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 400);
  camera.position.set(7.2, 4.4, -10.7);
  camera.lookAt(0, 0, 0);
  addLighting(scene);
  const starfield = makeStarField(240, 60);
  scene.add(starfield);
  _thumbRenderer = { canvas, renderer, scene, camera, starfield, disposed: false, w: width, h: height };
  _thumbCreateCount++;   // 单例：仅在真正新建离屏渲染器时计数（复用不计；dispose 后再建 +1）
  return _thumbRenderer;
}

// 静态截图（船坞列表缩略图）。返回 dataURL 或 null。失败返回 null（不缓存 null，调用方下次重试）。
export function captureThumbnail(spec, opts = {}) {
  const { width = 460, height = 300, angle = 0.55, background = 0x0a121e } = opts;
  let pool = null, ship = null;
  try {
    pool = ensureThumbRenderer(width, height);
    if (pool.scene.background && pool.scene.background.isColor) pool.scene.background.set(background);
    else pool.scene.background = new THREE.Color(background);
    ship = buildShip(spec);
    ship.rotation.y = angle;
    pool.scene.add(ship);
    pool.renderer.render(pool.scene, pool.camera);
    return pool.canvas.toDataURL("image/webp", 0.85);
  } catch (err) {
    console.error("[Ship3D] 截图失败：", spec, err);
    return null;
  } finally {
    // 只释放本次这艘船的专属资源；共享的 renderer/scene/camera/lights/starfield 保留
    if (ship && pool) {
      pool.scene.remove(ship);
      disposeObject(ship);
    }
  }
}

// 仅在页面卸载时调用：释放缩略图渲染器自己的静态资源（starfield / renderer 上下文）。
export function disposeThumbnailRenderer() {
  if (!_thumbRenderer || _thumbRenderer.disposed) return;
  const p = _thumbRenderer;
  p.disposed = true;
  if (p.starfield) {
    if (p.starfield.geometry) p.starfield.geometry.dispose();
    if (p.starfield.material) p.starfield.material.dispose();
  }
  if (p.scene) p.scene.clear();
  if (p.renderer) {
    p.renderer.dispose();
    if (p.renderer.forceContextLoss) p.renderer.forceContextLoss();
  }
  _thumbRenderer = null;
}

/* ================================================================
   桥接：暴露给经典 <script defer> 调用
   ================================================================ */

if (typeof window !== "undefined") {
  try {
    window.Ship3D = {
      buildSpecForShip,
      buildEnemySpec,
      createViewer,
      setShips,
      setBackground,
      disposeViewer,
      ensureViewer,
      captureThumbnail,
      disposeThumbnailRenderer,
      disposeShipObject,
      // 实时诊断读数（供浏览器验收断言 WebGL 上下文/查看器/缩略图渲染器创建次数）
      getDiagnostics: () => ({
        rendererCreateCount: _rendererCreateCount,
        viewerCreateCount: _viewerCreateCount,
        thumbCreateCount: _thumbCreateCount
      }),
      version: "1.2"
    };
    // 页面卸载时释放缩略图渲染器静态资源（唯一调用点）
    if (typeof window.addEventListener === "function") {
      window.addEventListener("beforeunload", () => { try { disposeThumbnailRenderer(); } catch (e) {} });
    }
  } catch (e) {
    console.error("[ship3d] 初始化失败", e);
  }
  // 无论初始化是否成功，都通知经典脚本：3D 层已执行完毕，可尝试（重）渲染
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new Event("ship3d:ready"));
    }
  } catch (e) {
    /* 浏览器环境外（如 node 烟测）忽略 */
  }
}

export default (typeof window !== "undefined" ? window.Ship3D : undefined);
