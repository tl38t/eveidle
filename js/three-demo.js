import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COLORS = {
  gold: { hull: 0x8f702c, dark: 0x202830, glow: 0x2aaee8, accent: 0xc7a14b, steel: 0x58636b },
  red:  { hull: 0x71322f, dark: 0x261f23, glow: 0xe66b42, accent: 0xa64b3e, steel: 0x625b5b },
  blue: { hull: 0x334f66, dark: 0x1b252e, glow: 0x45c5df, accent: 0x567e95, steel: 0x5d6c73 }
};

const clock = new THREE.Clock();
let activeMode = "battle";
let frameCap = 45;
let lastFrame = 0;
let autoSpin = true;
let fittingWeapon = "laser";

const statusEl = document.getElementById("system-status");
const perfEl = document.getElementById("perf-readout");
const battleMessage = document.getElementById("battle-message");

function material(color, metalness = 0.72, roughness = 0.34, emissive = 0x000000, intensity = 0) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: intensity, flatShading: true });
}

function addPart(group, geometry, mat, position, rotation = [0, 0, 0], scale = [1, 1, 1], outline = false) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  if (outline) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 24),
      new THREE.LineBasicMaterial({ color: 0x080d12, transparent: true, opacity: 0.42 })
    );
    mesh.add(edges);
  }
  group.add(mesh);
  return mesh;
}

function chamferedHull(length, frontWidth, rearWidth, frontHeight, rearHeight, chamfer = 0.16) {
  const ring = (width, height, z) => {
    const c = Math.min(chamfer, width * 0.22, height * 0.32);
    const x = width / 2;
    const y = height / 2;
    return [
      [-x + c, -y, z], [x - c, -y, z], [x, -y + c, z], [x, y - c, z],
      [x - c, y, z], [-x + c, y, z], [-x, y - c, z], [-x, -y + c, z]
    ];
  };
  const vertices = [...ring(frontWidth, frontHeight, -length / 2), ...ring(rearWidth, rearHeight, length / 2)].flat();
  const indices = [];
  for (let i = 1; i < 7; i++) indices.push(0, i, i + 1, 8, 8 + i + 1, 8 + i);
  for (let i = 0; i < 8; i++) {
    const n = (i + 1) % 8;
    indices.push(i, 8 + i, 8 + n, i, 8 + n, n);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addEngine(group, x, y, z, radius, palette, length = 1.7) {
  const casing = material(palette.dark, 0.94, 0.3);
  const steel = material(palette.steel, 0.9, 0.27);
  const glow = material(0x0c2632, 0.35, 0.28, palette.glow, 1.35);
  addPart(group, new THREE.CylinderGeometry(radius * 0.86, radius, length, 12), casing,
    [x, y, z], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, 0.18, 12), steel,
    [x, y, z + length * 0.5], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.CylinderGeometry(radius * 0.68, radius * 0.68, 0.05, 16), glow,
    [x, y, z + length * 0.5 + 0.11], [Math.PI / 2, 0, 0], [1, 1, 1], false);
  const exhaustMaterial = new THREE.MeshBasicMaterial({
    color: palette.glow, transparent: true, opacity: 0.18,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const exhaust = addPart(group, new THREE.ConeGeometry(radius * 0.56, 1.45, 12, 1, true), exhaustMaterial,
    [x, y, z + length * 0.5 + 0.78], [Math.PI / 2, 0, 0], [1, 1, 1], false);
  exhaust.name = "exhaust";
}

function addAntenna(group, x, y, z, height, steelMat, glowMat) {
  addPart(group, new THREE.CylinderGeometry(0.025, 0.045, height, 8), steelMat,
    [x, y + height / 2, z], [0, 0, 0], [1, 1, 1], false);
  addPart(group, new THREE.SphereGeometry(0.065, 8, 6), glowMat,
    [x, y + height, z], [0, 0, 0], [1, 1, 1], false);
}

function makeStarField(count = 700, radius = 42) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * (0.72 + Math.random() * 0.28);
    points.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x9fc9e5, size: 0.055, transparent: true, opacity: 0.72 }));
}

function createWeapon(group, type, side, palette) {
  const weapon = new THREE.Group();
  weapon.name = `weapon-${side}`;
  const x = side * 1.7;
  const darkMat = material(palette.dark, 0.9, 0.3);
  const steelMat = material(palette.steel, 0.92, 0.25);
  const glowMat = material(0x102630, 0.35, 0.25, palette.glow, 1.25);

  if (type === "missile") {
    addPart(weapon, chamferedHull(1.28, 0.6, 0.76, 0.48, 0.58, 0.1), darkMat, [x, 0.56, -0.62]);
    for (let ix = -1; ix <= 1; ix += 2) {
      for (let iy = -1; iy <= 1; iy += 2) {
        addPart(weapon, new THREE.CylinderGeometry(0.075, 0.075, 0.12, 10), glowMat,
          [x + ix * 0.15, 0.56 + iy * 0.12, -1.28], [Math.PI / 2, 0, 0], [1, 1, 1], false);
      }
    }
  } else {
    const barrelLength = type === "cannon" ? 1.14 : 1.48;
    const barrelRadius = type === "cannon" ? 0.085 : 0.055;
    addPart(weapon, new THREE.CylinderGeometry(0.26, 0.34, 0.32, 10), darkMat,
      [x, 0.53, -0.44], [0, 0, 0]);
    addPart(weapon, new THREE.BoxGeometry(0.52, 0.2, 0.55), steelMat, [x, 0.76, -0.54]);
    for (const barrelOffset of [-0.11, 0.11]) {
      addPart(weapon, new THREE.CylinderGeometry(barrelRadius, barrelRadius * 1.06, barrelLength, 8),
        steelMat, [x + barrelOffset, 0.76, -1.28], [Math.PI / 2, 0, 0]);
      if (type === "laser") {
        addPart(weapon, new THREE.CylinderGeometry(0.07, 0.07, 0.09, 10), glowMat,
          [x + barrelOffset, 0.76, -2.03], [Math.PI / 2, 0, 0], [1, 1, 1], false);
      }
    }
  }
  group.add(weapon);
}

function createShip({ palette = COLORS.gold, weapon = "laser", scale = 1, heavy = false } = {}) {
  const ship = new THREE.Group();
  ship.userData.weapon = weapon;
  const hullMat = material(palette.hull, 0.82, 0.42);
  const darkMat = material(palette.dark, 0.92, 0.36);
  const accentMat = material(palette.accent, 0.72, 0.38);
  const steelMat = material(palette.steel, 0.94, 0.3);
  const glassMat = material(0x09171f, 0.42, 0.2, palette.glow, 0.65);
  const glowMat = material(0x0d222b, 0.3, 0.22, palette.glow, 1.18);

  // Long armored spine and tapered prow establish a spacecraft silhouette rather than a car-like body.
  addPart(ship, chamferedHull(5.2, 1.08, 2.2, 0.62, 1.16, 0.19), darkMat, [0, -0.04, -0.2], [0, 0, 0], [1, 1, 1], true);
  addPart(ship, chamferedHull(3.2, 0.26, 1.38, 0.22, 0.72, 0.08), hullMat, [-0.12, 0.02, -3.82], [0, 0, 0], [1, 1, 1], true);
  addPart(ship, chamferedHull(2.6, 1.46, 2.1, 0.3, 0.42, 0.12), hullMat, [0.08, 0.64, -0.42], [0, 0, 0], [1, 1, 1], true);
  addPart(ship, chamferedHull(1.68, 0.82, 1.2, 0.32, 0.44, 0.1), glassMat, [-0.22, 0.9, -1.15], [0, 0, 0], [1, 1, 1], true);

  // Layered armor plates, with deliberately imperfect symmetry.
  addPart(ship, chamferedHull(2.75, 0.82, 1.2, 0.16, 0.24, 0.06), accentMat, [-0.5, 0.86, 0.78], [0, 0, 0], [1, 1, 1], true);
  addPart(ship, chamferedHull(2.3, 0.58, 0.92, 0.12, 0.19, 0.05), hullMat, [0.74, 0.72, 0.88], [0, 0, 0], [1, 1, 1], true);
  addPart(ship, chamferedHull(1.9, 1.38, 1.68, 0.2, 0.3, 0.08), steelMat, [0.02, -0.67, 0.96]);

  // Side trusses and utility booms create the dense industrial construction language.
  for (const side of [-1, 1]) {
    const asymmetry = side < 0 ? 1.14 : 0.9;
    addPart(ship, chamferedHull(3.45, 0.62 * asymmetry, 0.92 * asymmetry, 0.36, 0.58, 0.1),
      side < 0 ? hullMat : darkMat, [side * 1.48, -0.08, 0.48], [0, side * 0.065, side * 0.025], [1, 1, 1], true);
    addPart(ship, new THREE.BoxGeometry(1.18 * asymmetry, 0.12, 0.18), steelMat,
      [side * 1.0, -0.08, -0.58], [0, 0, side * 0.18]);
    addPart(ship, new THREE.BoxGeometry(1.38 * asymmetry, 0.1, 0.16), steelMat,
      [side * 1.08, -0.14, 0.72], [0, 0, side * -0.14]);
    addPart(ship, new THREE.BoxGeometry(0.11, 0.1, 2.28), glowMat,
      [side * (1.42 + (side < 0 ? 0.12 : 0)), 0.31, 0.42], [0, side * 0.065, 0], [1, 1, 1], false);
    createWeapon(ship, weapon, side, palette);
  }

  // Uneven engine cluster: three drives on port, two on starboard, one central auxiliary drive.
  addEngine(ship, -1.9, -0.18, 2.15, 0.5, palette, 1.92);
  addEngine(ship, -1.15, -0.48, 2.35, 0.37, palette, 1.56);
  addEngine(ship, -2.34, 0.34, 2.28, 0.3, palette, 1.46);
  addEngine(ship, 1.72, -0.12, 2.18, 0.46, palette, 1.82);
  addEngine(ship, 1.12, 0.42, 2.36, 0.31, palette, 1.42);
  addEngine(ship, 0.18, -0.38, 2.54, 0.29, palette, 1.34);

  // Hull ribs, maintenance boxes, sensor mast and identification lights.
  for (let i = 0; i < 5; i++) {
    const z = -0.35 + i * 0.55;
    addPart(ship, new THREE.BoxGeometry(1.55, 0.07, 0.09), steelMat,
      [-0.05, 0.68 + i * 0.018, z], [0, 0, 0], [1, 1, 1], false);
  }
  for (let i = 0; i < 4; i++) {
    addPart(ship, new THREE.BoxGeometry(0.22, 0.2, 0.38), i % 2 ? darkMat : steelMat,
      [0.88, 0.39, -0.2 + i * 0.62], [0, 0, 0]);
  }
  addPart(ship, new THREE.CylinderGeometry(0.24, 0.34, 0.3, 10), darkMat, [0.38, 1.03, 0.18]);
  addAntenna(ship, 0.38, 1.17, 0.18, 0.8, steelMat, glowMat);
  addAntenna(ship, -0.18, 0.98, 0.44, 0.52, steelMat, glowMat);
  addPart(ship, new THREE.SphereGeometry(0.08, 8, 6), glowMat, [-0.7, 0.72, -2.48], [0, 0, 0], [1, 1, 1], false);
  addPart(ship, new THREE.SphereGeometry(0.06, 8, 6), glowMat, [0.62, 0.58, -2.12], [0, 0, 0], [1, 1, 1], false);

  if (heavy) {
    addPart(ship, chamferedHull(2.2, 2.8, 3.45, 0.2, 0.34, 0.08), darkMat, [0, -0.46, 1.15], [0, 0, 0], [1, 1, 1], true);
    addPart(ship, chamferedHull(1.35, 0.72, 1.05, 0.68, 0.78, 0.12), accentMat, [-0.44, 0.55, 1.38], [0, 0, 0], [1, 1, 1], true);
    addPart(ship, new THREE.BoxGeometry(3.7, 0.12, 0.16), steelMat, [0, -0.22, 1.82], [0, 0, 0.04]);
  }

  ship.scale.setScalar(scale * (heavy ? 1.08 : 1));
  ship.rotation.x = 0.055;
  return ship;
}

function createRenderer(canvas, preserveDrawingBuffer = false) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  return renderer;
}

function addLighting(scene, warm = false) {
  scene.add(new THREE.HemisphereLight(0x86b9d8, 0x11171e, 1.05));
  const key = new THREE.DirectionalLight(warm ? 0xffc07d : 0xdcecff, 3.15);
  key.position.set(-6, 9, 5);
  scene.add(key);
  const rim = new THREE.PointLight(warm ? 0xff4b35 : 0x2fb9ff, 10, 24, 2);
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

// Battle viewer
const battleCanvas = document.getElementById("battle-canvas");
const battleRenderer = createRenderer(battleCanvas);
const battleScene = new THREE.Scene();
const battleCamera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
battleCamera.position.set(0, 7.4, 16.5);
battleCamera.lookAt(0, 0, 0);
addLighting(battleScene);
battleScene.add(makeStarField());

const playerShip = createShip({ palette: COLORS.gold, weapon: "laser", scale: 0.78 });
playerShip.position.set(-3.1, -0.75, 0.7);
playerShip.rotation.set(0.1, -0.34, -0.06);
battleScene.add(playerShip);

const enemyShip = createShip({ palette: COLORS.red, weapon: "cannon", scale: 0.69, heavy: true });
enemyShip.position.set(3.25, 1.05, -1.5);
enemyShip.rotation.set(-0.03, 2.72, 0.09);
battleScene.add(enemyShip);

const projectileMat = new THREE.MeshBasicMaterial({ color: 0x61d7ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
const projectiles = [];
for (let i = 0; i < 4; i++) {
  const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), projectileMat.clone());
  pulse.scale.z = 8;
  pulse.visible = false;
  battleScene.add(pulse);
  projectiles.push({ mesh: pulse, life: -i * 0.32, offset: i % 2 ? 0.3 : -0.3 });
}

function updateBattle(time, delta) {
  playerShip.position.y = -0.72 + Math.sin(time * 1.35) * 0.11;
  playerShip.rotation.z = -0.06 + Math.sin(time * 0.8) * 0.018;
  enemyShip.position.y = 1.05 + Math.sin(time * 1.1 + 2) * 0.1;
  enemyShip.rotation.z = 0.09 + Math.sin(time * 0.72) * 0.022;
  for (const ship of [playerShip, enemyShip]) {
    ship.traverse((part) => {
      if (part.name === "exhaust") {
        part.scale.y = 0.85 + Math.sin(time * 17 + part.position.x) * 0.18;
        part.material.opacity = 0.25 + Math.random() * 0.12;
      }
    });
  }
  for (const projectile of projectiles) {
    projectile.life += delta;
    if (projectile.life > 1.6) projectile.life = 0;
    const p = projectile.life / 1.6;
    projectile.mesh.visible = p > 0.08 && p < 0.92;
    projectile.mesh.position.lerpVectors(
      new THREE.Vector3(-2.1, -0.3 + projectile.offset, -1.0),
      new THREE.Vector3(2.4, 0.75 + projectile.offset, -1.5),
      Math.max(0, Math.min(1, p))
    );
    projectile.mesh.material.opacity = Math.sin(Math.min(1, p) * Math.PI);
  }
}

// Fitting viewer
const fittingCanvas = document.getElementById("fitting-canvas");
const fittingRenderer = createRenderer(fittingCanvas, true);
const fittingScene = new THREE.Scene();
const fittingCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
fittingCamera.position.set(10.5, 6.4, -15.4);
addLighting(fittingScene);
fittingScene.add(makeStarField(460, 36));
const fittingRoot = new THREE.Group();
fittingScene.add(fittingRoot);
let fittingShip = createShip({ palette: COLORS.gold, weapon: fittingWeapon, scale: 1 });
fittingRoot.add(fittingShip);

const controls = new OrbitControls(fittingCamera, fittingCanvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;
controls.minDistance = 10;
controls.maxDistance = 28;
controls.target.set(0, 0, 0);
controls.update();

function resetFittingCamera() {
  fittingCamera.position.set(10.5, 6.4, -15.4);
  controls.target.set(0, 0, 0);
  controls.update();
}
fittingCanvas.addEventListener("dblclick", resetFittingCamera);

function replaceFittingShip(weapon) {
  fittingRoot.remove(fittingShip);
  fittingShip.traverse((item) => {
    if (item.geometry) item.geometry.dispose();
    if (item.material) item.material.dispose();
  });
  fittingShip = createShip({ palette: COLORS.gold, weapon, scale: 1 });
  fittingRoot.add(fittingShip);
}

document.querySelectorAll("[data-weapon]").forEach((button) => {
  button.addEventListener("click", () => {
    fittingWeapon = button.dataset.weapon;
    document.querySelectorAll("[data-weapon]").forEach((item) => item.classList.toggle("is-selected", item === button));
    replaceFittingShip(fittingWeapon);
    document.getElementById("dps-value").textContent = ({ laser: "24.8", missile: "21.2", cannon: "27.6" })[fittingWeapon];
  });
});

document.getElementById("spin-toggle").addEventListener("click", (event) => {
  autoSpin = !autoSpin;
  event.currentTarget.textContent = autoSpin ? "暂停自动旋转" : "恢复自动旋转";
});

document.getElementById("snapshot-button").addEventListener("click", () => {
  resizeRenderer(fittingRenderer, fittingCamera);
  fittingRenderer.render(fittingScene, fittingCamera);
  const anchor = document.createElement("a");
  anchor.download = `huangsun-${fittingWeapon}.png`;
  anchor.href = fittingCanvas.toDataURL("image/png");
  anchor.click();
});

// Static hangar thumbnails, generated once from the same ship builder.
function generateThumbnails() {
  const canvas = document.createElement("canvas");
  const renderer = createRenderer(canvas, true);
  renderer.setPixelRatio(1);
  renderer.setSize(640, 400, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x09101a);
  const camera = new THREE.PerspectiveCamera(30, 640 / 400, 0.1, 100);
  camera.position.set(7.2, 4.4, -10.7);
  camera.lookAt(0, 0, 0);
  addLighting(scene);
  scene.add(makeStarField(260, 36));

  const variants = [
    { key: "gold", palette: COLORS.gold, weapon: "laser", scale: 0.92, heavy: false },
    { key: "red", palette: COLORS.red, weapon: "missile", scale: 0.94, heavy: true },
    { key: "blue", palette: COLORS.blue, weapon: "cannon", scale: 1.02, heavy: true }
  ];

  for (const variant of variants) {
    const ship = createShip(variant);
    ship.rotation.set(0.12, -0.47, -0.06);
    scene.add(ship);
    renderer.render(scene, camera);
    const image = document.querySelector(`[data-thumb="${variant.key}"] img`);
    image.src = canvas.toDataURL("image/webp", 0.84);
    scene.remove(ship);
    ship.traverse((item) => {
      if (item.geometry) item.geometry.dispose();
      if (item.material) item.material.dispose();
    });
  }

  renderer.dispose();
  renderer.forceContextLoss();
  document.getElementById("thumb-status").textContent = "3 张 WebP 已生成并转为普通图片";
}

// Mode switching and frame policy.
document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    activeMode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("is-active", item === button));
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      const active = panel.dataset.panel === activeMode;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    statusEl.textContent = activeMode === "hangar" ? "静态截图模式" : "实时 3D 正常运行";
  });
});

document.getElementById("power-toggle").addEventListener("click", (event) => {
  frameCap = frameCap === 45 ? 30 : 45;
  event.currentTarget.textContent = frameCap === 30 ? "恢复平衡模式 45 FPS" : "切换低功耗 30 FPS";
  battleMessage.textContent = `自动交战中 · 已限制为 ${frameCap} FPS`;
});

function animate(nowMs) {
  requestAnimationFrame(animate);
  if (document.hidden) return;
  const interval = 1000 / frameCap;
  if (nowMs - lastFrame < interval) return;
  const delta = Math.min(0.05, (nowMs - lastFrame) / 1000 || 0.016);
  lastFrame = nowMs - ((nowMs - lastFrame) % interval);
  const time = clock.getElapsedTime();

  if (activeMode === "battle") {
    resizeRenderer(battleRenderer, battleCamera);
    updateBattle(time, delta);
    battleRenderer.render(battleScene, battleCamera);
    perfEl.textContent = `${battleRenderer.info.render.calls} DRAW CALLS · ${frameCap} FPS 上限`;
  } else if (activeMode === "fitting") {
    resizeRenderer(fittingRenderer, fittingCamera);
    if (autoSpin && !controls.state) fittingRoot.rotation.y += delta * 0.22;
    fittingShip.position.y = Math.sin(time * 1.1) * 0.05;
    fittingShip.traverse((part) => {
      if (part.name === "exhaust") part.material.opacity = 0.25 + Math.sin(time * 14) * 0.06;
    });
    controls.update();
    fittingRenderer.render(fittingScene, fittingCamera);
    perfEl.textContent = `${fittingRenderer.info.render.calls} DRAW CALLS · 可交互模型`;
  } else {
    perfEl.textContent = "0 个持续渲染循环 · 普通图片列表";
  }
}

try {
  generateThumbnails();
  statusEl.textContent = "实时 3D 正常运行";
  requestAnimationFrame(animate);
} catch (error) {
  statusEl.textContent = "此设备无法启动 WebGL 演示";
  perfEl.textContent = error.message;
  console.error(error);
}
