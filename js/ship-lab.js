import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildShip, COLORS, SHIP_CLASSES } from "./render3d/shipfactory2/ShipFactory2.js";
import { ANCHORS } from "./render3d/shipfactory2/ShipProfile.js";
import { createShipContext } from "./render3d/shipfactory2/ShipContext.js";

const RACES = ["player_shield", "player_armor", "player_structure", "angel", "blood", "sansha"];
const nf = new Intl.NumberFormat("zh-CN");
const byId = (id) => document.getElementById(id);
const ui = {
  form: byId("ship-controls"), anchor: byId("anchor-input"), race: byId("race-input"),
  shipClass: byId("class-input"), seed: byId("seed-input"), random: byId("random-seed-button"),
  previous: byId("previous-button"), next: byId("next-button"), history: byId("history-position"),
  runtime: document.querySelector(".runtime-status"), runtimeLabel: byId("runtime-label"),
  runtimeDetail: byId("runtime-detail"), designation: byId("ship-designation"), seedLabel: byId("ship-seed-label"),
  vertices: byId("vertex-count"), triangles: byId("triangle-count"), meshes: byId("mesh-count"),
  buildTime: byId("build-time"), fingerprint: byId("geometry-fingerprint"),
  fingerprintDetail: byId("fingerprint-detail"), profile: byId("profile-output"), viewport: byId("viewport"),
  surfPanels: byId("surf-panels"), surfGrooves: byId("surf-grooves"),
  surfHeatSinks: byId("surf-heatsinks"), surfHatches: byId("surf-hatches"), surfVents: byId("surf-vents")
};
function addOptions(select, values) {
  for (const value of values) { const option = document.createElement("option"); option.value = value; option.textContent = value; select.appendChild(option); }
}
addOptions(ui.anchor, Object.keys(ANCHORS));
addOptions(ui.race, RACES.filter((race) => COLORS[race]));
addOptions(ui.shipClass, SHIP_CLASSES);

const scene = new THREE.Scene(); scene.background = new THREE.Color(0x05080c); scene.fog = new THREE.FogExp2(0x05080c, 0.006);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000); camera.position.set(17, 12, 28);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05; ui.viewport.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.055;
const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xb8d9ef, 0x100c0a, 0.5));
const key = new THREE.DirectionalLight(0xfff1d7, 2.4); key.position.set(12, 18, 10); scene.add(key);
const rim = new THREE.DirectionalLight(0x58bfff, 1.5); rim.position.set(-12, 5, -14); scene.add(rim);
const accent = new THREE.PointLight(0x48c2ff, 55, 100); accent.position.set(0, 6, 10); scene.add(accent);

// GridHelper 已移除（旋转后竖直穿过舰船中心，视觉干扰）
const starData = [];
for (let i = 0; i < 650; i++) {
  const a = Math.random() * Math.PI * 2; const p = Math.acos(2 * Math.random() - 1); const r = 72 + Math.random() * 28;
  starData.push(r * Math.sin(p) * Math.cos(a), r * Math.cos(p), r * Math.sin(p) * Math.sin(a));
}
const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starData, 3));
scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xa8c4d4, size: 0.1, transparent: true, opacity: 0.5 })));
const history = []; let historyIndex = -1; let activeShip = null;

function normalizeSeed(raw) {
  const value = raw.trim(); const number = Number(value);
  return /^-?\d+$/.test(value) && Number.isSafeInteger(number) ? number : value || "ship-lab";
}
function readControls() { return { anchor: ui.anchor.value, race: ui.race.value, shipClass: ui.shipClass.value, seed: normalizeSeed(ui.seed.value) }; }
function applyControls(item) { ui.anchor.value = item.anchor; ui.race.value = item.race; ui.shipClass.value = item.shipClass; ui.seed.value = String(item.seed); }
function makeSpec(item) {
  const deckStyle = new URLSearchParams(location.search).get("deck") || "full";
  return { id: "ship-lab-" + item.anchor + "-" + item.shipClass, anchor: item.anchor, race: item.race, line: item.race, hull: item.shipClass, seed: item.seed, faction: item.race, family: ANCHORS[item.anchor]?.family || "shield", weapon: "laser", deckStyle };
}

function disposeObject(root) {
  const geometries = new Set(); const materials = new Set();
  root?.traverse((object) => { if (object.geometry) geometries.add(object.geometry); const list = Array.isArray(object.material) ? object.material : [object.material]; for (const material of list) if (material) materials.add(material); });
  for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
}
function disposeContext(context) { for (const key of ["hullMat", "darkMat", "accentMat", "steelMat", "glassMat"]) context[key]?.dispose(); }
function metricsOf(ship) {
  const result = { vertices: 0, triangles: 0, meshes: 0 };
  ship.traverse((object) => {
    if (!object.isMesh || !object.geometry) return; const position = object.geometry.getAttribute("position"); if (!position) return;
    result.meshes++; result.vertices += position.count; result.triangles += object.geometry.index ? object.geometry.index.count / 3 : position.count / 3;
  });
  result.triangles = Math.round(result.triangles); return result;
}
function surfaceDetailsOf(ship) {
  const counts = { panels: 0, grooves: 0, heatSinks: 0, hatches: 0, vents: 0 };
  for (const child of ship.children) {
    if (!child.isGroup) continue;
    let meshCount = 0;
    child.traverse((o) => { if (o.isMesh) meshCount++; });
    const key = child.name;
    if (key in counts) counts[key] = meshCount;
  }
  return counts;
}

function mix(hash, value) {
  for (let shift = 0; shift < 32; shift += 8) { hash ^= (value >>> shift) & 255; hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}
function fingerprintOf(ship, metrics) {
  let hash = 0x811c9dc5; const point = new THREE.Vector3(); ship.updateMatrixWorld(true);
  ship.traverse((object) => {
    if (!object.isMesh || !object.geometry) return; const position = object.geometry.getAttribute("position"); if (!position) return;
    hash = mix(hash, position.count);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      hash = mix(hash, Math.round(point.x * 10000)); hash = mix(hash, Math.round(point.y * 10000)); hash = mix(hash, Math.round(point.z * 10000));
    }
  });
  hash = mix(mix(mix(hash, metrics.meshes), metrics.vertices), metrics.triangles);
  return "SF2-" + hash.toString(16).padStart(8, "0").toUpperCase();
}

function fitCamera(ship) {
  const sphere = new THREE.Box3().setFromObject(ship).getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1); const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.15;
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(new THREE.Vector3(0.65, 0.42, 1).normalize().multiplyScalar(distance));
  camera.near = Math.max(0.05, distance / 100); camera.far = Math.max(500, distance * 12); camera.updateProjectionMatrix(); controls.update();
}
function setStatus(mode, detail) {
  ui.runtime.classList.toggle("is-busy", mode === "busy"); ui.runtime.classList.toggle("is-error", mode === "error");
  ui.runtimeLabel.textContent = mode === "error" ? "BUILD FAILED" : mode === "busy" ? "GENERATING" : "LAB ONLINE";
  ui.runtimeDetail.textContent = detail;
}
function updateHistory() {
  ui.previous.disabled = historyIndex <= 0; ui.next.disabled = historyIndex < 0 || historyIndex >= history.length - 1;
  ui.history.textContent = history.length ? (historyIndex + 1) + " / " + history.length : "0 / 0";
}
function storeHistory(item) {
  if (historyIndex >= 0 && JSON.stringify(history[historyIndex]) === JSON.stringify(item)) return;
  history.splice(historyIndex + 1); history.push({ ...item }); historyIndex = history.length - 1;
}

function buildFrom(item, remember = true) {
  setStatus("busy", "正在调用 ShipFactory2"); const spec = makeSpec(item);
  try {
    const context = createShipContext(spec); const profile = context.profile; disposeContext(context);
    const started = performance.now(); const ship = buildShip(spec); const elapsed = performance.now() - started;
    const metrics = metricsOf(ship); const fingerprint = fingerprintOf(ship, metrics);
    const surfaces = surfaceDetailsOf(ship);
    ship.rotation.x = -0.08; ship.rotation.y = -0.42;
    if (activeShip) { scene.remove(activeShip); disposeObject(activeShip); }
    activeShip = ship; scene.add(ship); fitCamera(ship);
    accent.color.set(COLORS[item.race]?.glow ?? 0x48c2ff);
    ui.designation.textContent = item.anchor + " / " + item.shipClass;
    ui.seedLabel.textContent = "SEED " + item.seed + " · " + item.race;
    ui.vertices.textContent = nf.format(metrics.vertices); ui.triangles.textContent = nf.format(metrics.triangles);
    ui.meshes.textContent = nf.format(metrics.meshes); ui.buildTime.textContent = elapsed.toFixed(2) + " ms";
    const size = new THREE.Box3().setFromObject(ship).getSize(new THREE.Vector3());
    ui.fingerprint.textContent = fingerprint;
    ui.fingerprintDetail.textContent = "bbox " + size.x.toFixed(2) + " × " + size.y.toFixed(2) + " × " + size.z.toFixed(2);
    ui.surfPanels.textContent = surfaces.panels;
    ui.surfGrooves.textContent = surfaces.grooves;
    ui.surfHeatSinks.textContent = surfaces.heatSinks;
    ui.surfHatches.textContent = surfaces.hatches;
    ui.surfVents.textContent = surfaces.vents;
    ui.profile.textContent = JSON.stringify(profile, null, 2);
    if (remember) storeHistory(item); updateHistory();
    setStatus("ready", metrics.meshes + " meshes · " + fingerprint);
  } catch (error) { console.error(error); setStatus("error", error.message); }
}

ui.form.addEventListener("submit", (event) => { event.preventDefault(); buildFrom(readControls()); });
ui.random.addEventListener("click", () => { ui.seed.value = String(crypto.getRandomValues(new Uint32Array(1))[0]); buildFrom(readControls()); });
ui.previous.addEventListener("click", () => { if (historyIndex <= 0) return; historyIndex--; applyControls(history[historyIndex]); buildFrom(history[historyIndex], false); });
ui.next.addEventListener("click", () => { if (historyIndex >= history.length - 1) return; historyIndex++; applyControls(history[historyIndex]); buildFrom(history[historyIndex], false); });
function resize() {
  const width = ui.viewport.clientWidth; const height = ui.viewport.clientHeight; if (!width || !height) return;
  renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(ui.viewport); resize();
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate); const time = clock.getElapsedTime();
  if (activeShip) {
    const shield = activeShip.userData.shield;
    if (shield) { const pulse = 0.5 + 0.5 * Math.sin(time * 1.35); shield.material.opacity = 0.05 + 0.05 * pulse;
      if (shield.children[0]?.material) shield.children[0].material.opacity = 0.13 + 0.12 * pulse; shield.scale.setScalar(1 + 0.012 * pulse); }
    for (const floater of activeShip.userData.floaters || []) {
      floater.grp.position.y = floater.base.y + Math.sin(time * 1.6 + floater.phase) * floater.ampY;
      floater.grp.position.z = floater.base.z + Math.sin(time * 1.1 + floater.phase) * floater.ampZ;
    }
  }
  controls.update(); renderer.render(scene, camera);
}
buildFrom(readControls()); animate();
