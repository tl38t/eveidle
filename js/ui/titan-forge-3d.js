import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildTitan } from "../render3d/titan/TitanFactory.js?v=1";

const CORE = { blue: 0x38c8ff, red: 0xff553b, violet: 0xc16cff };
const mounted = new WeakSet();

function mountPreview(el) {
  if (!el || mounted.has(el)) return;
  mounted.add(el);
  try {
    el.innerHTML = "";
    el.dataset.renderer = "three-titan-factory";
    const canvas = document.createElement("canvas");
    canvas.className = "titan-forge-canvas";
    el.appendChild(canvas);

    const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x091522);
  scene.fog = new THREE.FogExp2(0x091522, 0.003);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
  // TitanFactory uses the same long-axis coordinates as the standalone demo.
  // Aim at the visual center of that coordinate range instead of world origin.
  camera.position.set(-35, 22, 110);
  camera.lookAt(-5, 0, 0);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  scene.add(new THREE.HemisphereLight(0xd9f2ff, 0x273a4b, 2.8));
  const key = new THREE.DirectionalLight(0xffffff, 5.5);
  key.position.set(-30, 30, 35); scene.add(key);
  const rim = new THREE.PointLight(0x4bb9ed, 40, 130);
  rim.position.set(28, 8, 18); scene.add(rim);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.minDistance = 28;
  controls.maxDistance = 190;
  controls.zoomSpeed = 0.85;

  let ship = null;
  let glow = null;
  let animated = [];
  let lastKey = "";
  function readSelection() {
    const root = el.closest("#shipeng-titan-view") || document;
    const get = type => root.querySelector(`[data-titan-fresh="${type}"]`);
    return { hull: get("hull")?.value || "shield", weapon: get("weapon")?.value || "laser", core: get("core")?.value || "blue" };
  }
  function rebuild() {
    const s = readSelection();
    const key = `${s.hull}:${s.weapon}:${s.core}`;
    if (key === lastKey) return;
    lastKey = key;
    if (ship) scene.remove(ship);
    ship = buildTitan(s.hull, s.weapon, s.core);
    ship.scale.setScalar(0.88);
    ship.rotation.y = 0.08;
    scene.add(ship);
    animated = [];
    ship.traverse(o => {
      if (o.userData.titanFlame || o.userData.missileDoor || o.userData.titanMissileWing || o.userData.titanMissileRound ||
          o.userData.titanLaserFocus || o.userData.titanLaserClaw || o.userData.titanLaserBeam || o.userData.titanCannonAssembly ||
          o.userData.titanCannonBlast || o.userData.titanDoomsdayRotor || o.userData.titanDoomsdayPulse || o.userData.titanDoomsdayVane ||
          o.userData.titanRiftEffect) animated.push(o);
    });
    const bounds = new THREE.Box3().setFromObject(ship);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const diameter = Math.max(size.x, size.y, size.z);
    const distance = Math.max(48, diameter / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) * 1.18);
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(-0.32, 0.22, 1).normalize().multiplyScalar(distance));
    camera.lookAt(center);
    controls.update();
    if (glow) scene.remove(glow);
    glow = new THREE.PointLight(CORE[s.core] || CORE.blue, 28, 80);
    glow.position.set(-8, 4, 8); scene.add(glow);
  }
  function resize() {
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize); observer.observe(el);
  el.addEventListener("change", rebuild);
  rebuild(); resize();
  const clock = new THREE.Clock();
  function frame() {
    if (!document.documentElement.contains(el)) return;
    requestAnimationFrame(frame);
    const t = clock.getElapsedTime();
    // rebuild 不再每帧调用：初始已 rebuild，select change 事件会触发；
    // 每帧只负责动画与渲染，避免不必要的 DOM 查询和模型重建。
    if (ship) { ship.rotation.y += 0.00045; ship.rotation.z = Math.sin(t * .24) * .012; }
    if (glow) glow.intensity = 24 + Math.sin(t * 2.2) * 5;
    const missileCycle = t % 9;
    const doorOpen = missileCycle < 1.2 ? 0 : missileCycle < 2 ? (missileCycle - 1.2) / .8 : missileCycle < 7 ? 1 : missileCycle < 8 ? 1 - (missileCycle - 7) : 0;
    const laserCycle = t % 7;
    const charge = laserCycle < 2.8 ? laserCycle / 2.8 : laserCycle < 3.55 ? 1 : Math.max(0, 1 - (laserCycle - 3.55) / .85);
    const fire = laserCycle >= 2.8 && laserCycle <= 3.55 ? Math.sin(Math.PI * (laserCycle - 2.8) / .75) : 0;
    const cannonCycle = t % 6.8;
    const riftCycle = t % 6.3;
    let burst = .04 + .025 * Math.sin(t * 2.2);
    if (riftCycle >= 3.8 && riftCycle < 4.8) { const q = riftCycle - 3.8; burst = .06 + .29 * q * q * (3 - 2 * q); }
    else if (riftCycle >= 4.8 && riftCycle < 5.15) { const q = (riftCycle - 4.8) / .35; burst = .35 + .65 * q * q * (3 - 2 * q); }
    else if (riftCycle >= 5.15) { const q = Math.min(1, (riftCycle - 5.15) / 1.15); burst = 1 - (q * q * (3 - 2 * q)) * .96; }
    for (const o of animated) {
      const u = o.userData;
      if (u.titanFlame) {
        const f = u.titanFlame, p = 1 + Math.sin(t * 7.5 + f.phase) * .09 + Math.sin(t * 13.7 + f.phase * .7) * .045;
        o.scale.set(1 + Math.sin(t * 5.2 + f.phase) * .06, p, 1 + Math.sin(t * 5.2 + f.phase) * .06);
        o.position.x = f.exitX + f.length * p / 2;
        o.material.opacity = f.opacity * (.82 + .18 * Math.sin(t * 9.3 + f.phase));
      } else if (u.missileDoor) {
        const d = u.missileDoor; o.position.z = d.baseZ + d.slide * doorOpen * (d.large ? 1.55 : 1); o.rotation.y = d.slide * doorOpen * .24;
      } else if (u.titanMissileWing) {
        o.scale.y = missileCycle < 2 ? .86 + Math.min(1, Math.max(0, missileCycle - .8) / 1.2) * .14 : 1;
      } else if (u.titanMissileRound) {
        const r = u.titanMissileRound, start = 2.1 + r.wingIndex * .16 + r.cellIndex * .30 + (r.large ? .45 : 0), p = (missileCycle - start) / 1.25;
        if (p >= 0 && p <= 1) { const e = p * p * (3 - 2 * p); o.visible = true; o.position.y = r.baseY + e * (r.large ? 18 : 15); o.rotation.y = e * (r.wingIndex % 2 ? -.18 : .18); }
        else { o.visible = missileCycle < start; if (o.visible) { o.position.y = r.baseY; o.rotation.y = 0; } }
      } else if (u.titanLaserFocus) {
        const f = u.titanLaserFocus; if (f.rotor) o.rotation.x += .0025 * (f.index % 2 ? -1 : 1) * (1 + charge * 4); else if (o.material) o.material.emissiveIntensity = f.baseIntensity + charge * (2.2 + f.index * .7);
      } else if (u.titanLaserClaw) {
        const f = u.titanLaserClaw, s = 1 + charge * (f.isLong ? .11 : .065); o.scale.y = s; o.scale.z = s;
      } else if (u.titanLaserBeam) {
        const f = u.titanLaserBeam, pulse = .90 + .10 * Math.sin(t * 25 + f.phase); o.visible = fire > .015; o.material.opacity = f.baseOpacity * fire * pulse; o.scale.x = o.scale.z = .94 + .10 * fire;
      } else if (u.titanCannonAssembly) {
        const f = u.titanCannonAssembly, dt = cannonCycle - (1.15 + f.index * .38), recoil = dt >= 0 && dt < .13 ? dt / .13 : dt < .58 ? 1 - (dt - .13) / .45 : 0;
        o.position.x = f.baseX + Math.max(0, recoil) * 1.45;
      } else if (u.titanCannonBlast) {
        const f = u.titanCannonBlast, dt = cannonCycle - (1.15 + f.index * .38), flash = dt >= 0 && dt < .22 ? Math.sin(Math.PI * dt / .22) : 0;
        o.visible = flash > .02; o.material.opacity = f.baseOpacity * flash; const s = .72 + flash * .38; o.scale.set(s, 1, s);
      } else if (u.titanDoomsdayRotor) {
        const f = u.titanDoomsdayRotor; o.rotation[f.axis || "x"] += f.speed;
      } else if (u.titanDoomsdayPulse) {
        const f = u.titanDoomsdayPulse; if (o.material) o.material.emissiveIntensity = f.baseIntensity * (.82 + .18 * Math.sin(t * 2.8 + f.phase));
      } else if (u.titanDoomsdayVane) {
        const f = u.titanDoomsdayVane; o.position.y = f.baseY + Math.sin(t * 1.6 + f.phase) * .08;
      } else if (u.titanRiftEffect) {
        const f = u.titanRiftEffect;
        if (f.kind === "core") { const s = f.baseScale * (.88 + .97 * burst); o.scale.setScalar(s); o.material.emissiveIntensity = f.baseIntensity * (.72 + 2.6 * burst); }
        else if (f.kind === "lens") { const s = f.baseScale * (.86 + .48 * burst); o.scale.setScalar(s); o.material.opacity = f.baseOpacity + .24 * burst; }
        else if (f.kind === "light") o.intensity = 2 + 54 * burst;
      }
    }
    controls.update();
    renderer.render(scene, camera);
  }
  frame();
  } catch (err) {
    // 2026-09-24：手机/H5 上模块加载/执行失败时不应留下完全空白的预览区。
    el.dataset.renderer = "three-titan-factory-error";
    el.innerHTML = '<div class="titan-preview-error"><span>3D 预览加载失败</span><small>' + (err && err.message ? String(err.message).slice(0, 120) : "未知错误") + '</small></div>';
    console.warn("[titan-forge-3d] mountPreview failed:", err);
  }
}

function scan() { document.querySelectorAll("#shipeng-titan-view .titan-preview").forEach(mountPreview); }
// 2026-09-24：让 titan-forge-integration.js 懒创建视图后能主动触发扫描，避免中间空白。
if (typeof window !== "undefined") window.__scanTitanPreview = scan;
new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
