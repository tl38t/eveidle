import * as THREE from "three";

// Titan low-poly blockout derived from design/titan-three-view-v1.png.
// Coordinate convention: X = bow-to-stern, Y = dorsal, Z = port/starboard.
const DEFENSE = {
  shield: { shell: 0x7d929e, seam: 0x26333b, trim: 0x5dbce5 },
  armor: { shell: 0x81786b, seam: 0x2a2723, trim: 0xb08c62 },
  structure: { shell: 0x647171, seam: 0x172020, trim: 0x8ca7a4 },
  // 死亡空间 10/10「深渊回响」亡灵统御者：深绿太空死灵配色（2026-09-24）。
  necro: { shell: 0x143528, seam: 0x07140e, trim: 0x39ff7a }
};
const WEAPONS = { laser: 0x6adfff, missile: 0xf0a45c, cannon: 0xffcf8a };
const coreHue = kind => kind === "red" ? 0xff553b : kind === "violet" ? 0xc16cff : kind === "green" ? 0x39ff7a : 0x38c8ff;
const mat = (c, metal = .82, rough = .3) => new THREE.MeshStandardMaterial({ color: c, metalness: metal, roughness: rough, emissive: c, emissiveIntensity: .12 });
const glow = c => new THREE.MeshStandardMaterial({ color: 0x11151a, metalness: .15, roughness: .18, emissive: c, emissiveIntensity: 4 });
const flameMat = (c, opacity) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const finish = (c, kind) => kind === "shield"
  ? new THREE.MeshPhysicalMaterial({ color: c, metalness: .72, roughness: .18, clearcoat: .65, clearcoatRoughness: .12, emissive: c, emissiveIntensity: .08 })
  : kind === "armor"
    ? new THREE.MeshStandardMaterial({ color: c, metalness: .9, roughness: .46, emissive: c, emissiveIntensity: .06 })
    : new THREE.MeshStandardMaterial({ color: c, metalness: .72, roughness: .56, emissive: c, emissiveIntensity: .1 });

function addBox(g, size, material, p, r = [0, 0, 0]) { const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material); m.position.set(...p); m.rotation.set(...r); g.add(m); return m; }
function addSphere(g, scale, material, p) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 18), material); m.scale.set(...scale); m.position.set(...p); g.add(m); return m; }
function addCapsule(g, radius, length, material, p) { const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 8, 32), material); m.rotation.z = Math.PI / 2; m.position.set(...p); g.add(m); return m; }
function addCyl(g, radius, length, material, p, r = [0, 0, 0], segments = 20) { const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material); m.position.set(...p); m.rotation.set(...r); g.add(m); return m; }
function addCone(g, radius, length, material, p, r = [0, 0, 0]) { const m = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 32), material); m.position.set(...p); m.rotation.set(...r); g.add(m); return m; }
function addPetal(g, material, p, angle) {
  const vertices = new Float32Array([
     1.35, -.48, -.86,   1.35, -.48,  .86,   1.35,  .92,  .72,   1.35,  .92, -.72,
    -1.35, -.12, -.46,  -1.35, -.12,  .46,  -1.35, 1.38,  .34,  -1.35, 1.38, -.34
  ]);
  const indices = [0,2,1,0,3,2,4,5,6,4,6,7,0,5,4,0,1,5,3,6,2,3,7,6,1,6,5,1,2,6,0,7,3,0,4,7];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(...p); mesh.rotation.x = angle;
  g.add(mesh); return mesh;
}
function addFlame(g, radius, length, color, exit) {
  const layer = (r, l, material) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, l, 32, 1, true), material);
    m.position.set(exit[0] + l / 2, exit[1], exit[2]);
    m.rotation.z = -Math.PI / 2;
    m.userData.titanFlame = { exitX: exit[0], length: l, phase: Math.random() * Math.PI * 2, opacity: material.opacity };
    g.add(m);
  };
  layer(radius, length, flameMat(color, .18));
  layer(radius * .62, length * .82, flameMat(color, .42));
  layer(radius * .25, length * .58, flameMat(0xe9fbff, .8));
}
function addLaserRay(g, radius, length, color, exitX) {
  const layer = (r, opacity, materialColor) => {
    const material = flameMat(materialColor, 0);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, length, 16, 1, true), material);
    m.position.set(exitX - length / 2, 0, 0);
    m.rotation.z = Math.PI / 2;
    m.visible = false;
    m.userData.titanLaserBeam = { baseOpacity: opacity, phase: r * 17, exitX, length };
    g.add(m);
  };
  layer(radius * 4.5, .08, color);
  layer(radius * 2.15, .34, color);
  layer(radius, .92, 0xf3fdff);
}
function addRing(g, radius, tube, material, p, r = [0, Math.PI / 2, 0]) { const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, 48), material); m.position.set(...p); m.rotation.set(...r); g.add(m); return m; }
function addBeam(g, a, b, radius, material) { const v = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a)); const mid = new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(.5); const m = addCyl(g, radius, v.length(), material, mid); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()); return m; }
function addBoxBeam(g, a, b, width, depth, material) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const direction = new THREE.Vector3().subVectors(end, start);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(direction.length(), width, depth), material);
  mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize());
  g.add(mesh); return mesh;
}
function addConeBetween(g, a, b, radius, material) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const direction = new THREE.Vector3().subVectors(end, start);
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, direction.length(), 16), material);
  mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  g.add(mesh); return mesh;
}
function addClawSegment(g, a, b, width, depth, material) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  const m = new THREE.Mesh(new THREE.BoxGeometry(length, width, depth), material);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
  m.rotation.z = Math.atan2(dy, dx);
  g.add(m); return m;
}

function addOctFrustum(g, x1, x2, frontY, frontZ, backY, backZ, material) {
  const vertices = [];
  for (const [x, hy, hz] of [[x1, frontY, frontZ], [x2, backY, backZ]]) {
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      vertices.push(x, Math.cos(a) * hy, Math.sin(a) * hz);
    }
  }
  vertices.push(x1, 0, 0, x2, 0, 0);
  const indices = [];
  for (let i = 0; i < 8; i++) {
    const n = (i + 1) % 8;
    indices.push(i, 8 + n, 8 + i, i, n, 8 + n);
    indices.push(16, n, i, 17, 8 + i, 8 + n);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material); g.add(mesh); return mesh;
}

function addStructureTruss(g, x1, x2, halfY, halfZ, material, braceMaterial) {
  const corners = [
    [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];
  for (const [sy, sz] of corners) {
    addBeam(g, [x1, sy * halfY, sz * halfZ], [x2, sy * halfY, sz * halfZ], .20, material);
  }
  // Alternating diagonals make the empty neck read as load-bearing space structure.
  addBeam(g, [x1, -halfY, -halfZ], [x2, halfY, -halfZ], .15, braceMaterial);
  addBeam(g, [x1, halfY, halfZ], [x2, -halfY, halfZ], .15, braceMaterial);
  addBeam(g, [x1, -halfY, -halfZ], [x2, -halfY, halfZ], .13, braceMaterial);
  addBeam(g, [x1, halfY, halfZ], [x2, halfY, -halfZ], .13, braceMaterial);
  for (const x of [x1, x2]) {
    addBeam(g, [x, -halfY, -halfZ], [x, halfY, -halfZ], .17, material);
    addBeam(g, [x, -halfY, halfZ], [x, halfY, halfZ], .17, material);
    addBeam(g, [x, -halfY, -halfZ], [x, -halfY, halfZ], .17, material);
    addBeam(g, [x, halfY, -halfZ], [x, halfY, halfZ], .17, material);
  }
}

function shieldHull(g, d) {
  const shell = finish(d.shell, "shield");
  const seam = mat(d.seam, .84, .34);
  const trim = mat(d.trim, .76, .24);

  // Continuous spearhead envelope reconstructed from the side/top orthographics.
  addOctFrustum(g, -27.0, -15.0, .12, .12, 1.45, 3.05, shell);
  addOctFrustum(g, -15.0, -4.0, 1.45, 3.05, 2.85, 5.25, shell);
  addOctFrustum(g, -4.0, 4.2, 2.85, 5.25, 5.10, 6.45, shell);
  addOctFrustum(g, 4.2, 11.4, 5.10, 6.45, 5.85, 6.75, shell);
  addOctFrustum(g, 11.4, 20.1, 5.85, 6.75, 3.75, 4.35, shell);

  // Thin polygonal bands preserve the hull flow while making its huge length legible.
  for (const [x, hy, hz] of [
    [-15.0, 1.45, 3.05], [-9.5, 2.15, 4.15], [-4.0, 2.85, 5.25],
    [4.2, 5.10, 6.45], [8.0, 5.50, 6.62], [11.4, 5.85, 6.75], [16.0, 4.75, 5.50]
  ]) addOctFrustum(g, x - .13, x + .13, hy + .13, hz + .13, hy + .13, hz + .13, trim);

  // Layered dorsal/ventral plates create the stepped side silhouette in the sheet.
  const upperPlates = [
    [-20.0, 10.5, .74, 1.35, .020],
    [-13.7, 12.5, 1.65, 2.70, .035],
    [-7.1, 13.0, 2.75, 4.30, .045],
    [-.8, 10.0, 4.05, 5.30, .050],
    [5.3, 8.4, 5.55, 5.75, .035],
    [10.0, 5.8, 6.55, 4.35, .015]
  ];
  for (const [x, length, y, width, rz] of upperPlates) {
    addBox(g, [length, .28, width], shell, [x, y, 0], [0, 0, rz]);
    addBox(g, [length * .82, .12, width * .72], seam, [x + .25, y + .20, 0], [0, 0, rz]);
  }
  const lowerPlates = [
    [-17.0, 11.0, -1.08, 2.15, -.020],
    [-9.6, 12.0, -2.00, 3.70, -.030],
    [-2.7, 10.0, -3.25, 5.10, -.040],
    [4.3, 8.2, -4.75, 5.45, -.025],
    [10.2, 5.8, -5.55, 4.10, 0]
  ];
  for (const [x, length, y, width, rz] of lowerPlates) {
    addBox(g, [length, .25, width], shell, [x, y, 0], [0, 0, rz]);
  }

  // Long edge rails make the top-view delta readable without becoming a truss hull.
  for (const z of [-1, 1]) {
    addBeam(g, [-26.2, 0, z * .22], [-4.0, 0, z * 5.35], .13, trim);
    addBeam(g, [-4.0, 0, z * 5.35], [7.2, 0, z * 6.72], .15, trim);
    addBeam(g, [7.2, 0, z * 6.72], [19.3, 0, z * 4.30], .15, trim);
    addBox(g, [9.4, .65, .36], seam, [2.8, 3.35, z * 5.82], [0, z * .04, .05]);
    addBox(g, [7.2, .55, .34], trim, [8.2, -3.65, z * 5.70], [0, -z * .04, -.03]);
  }

  // Rear citadel: broad shoulders, stepped command tower and the two lower pods
  // visible in the front projection.
  addBox(g, [8.8, 1.15, 8.4], shell, [8.2, 6.05, 0]);
  addBox(g, [6.8, 1.00, 6.4], seam, [8.9, 7.05, 0]);
  addBox(g, [5.2, .82, 4.8], shell, [9.6, 7.90, 0]);
  addBox(g, [3.6, .68, 3.2], seam, [10.0, 8.65, 0]);
  for (const x of [8.9, 10.0, 11.1]) addCone(g, .28, 1.55, trim, [x, 9.70, 0]);

  for (const z of [-1, 1]) {
    addCyl(g, 1.52, 7.2, seam, [11.2, -5.15, z * 3.55], [0, 0, Math.PI / 2], 8);
    addBox(g, [7.4, 1.20, 2.65], shell, [11.1, -5.15, z * 3.55]);
    addBox(g, [5.7, .26, 2.15], trim, [10.5, -5.88, z * 3.55]);
    addBox(g, [7.7, .75, 1.15], shell, [9.8, 4.20, z * 6.30], [0, z * .04, .02]);
  }
  addBox(g, [8.0, 1.15, 2.20], seam, [10.7, -6.35, 0]);
  addBox(g, [5.8, .75, 1.35], trim, [11.4, -7.20, 0]);

  // Stern shelves frame the common engine socket instead of replacing it.
  for (const y of [-1, 1]) {
    addBox(g, [5.2, .85, 7.0], shell, [17.4, y * 3.75, 0]);
    addBox(g, [3.8, .28, 6.0], trim, [18.0, y * 4.30, 0]);
  }
}

function armorHull(g, d) {
  const shell = finish(d.shell, "armor");
  const seam = mat(d.seam, .94, .60);
  const trim = mat(d.trim, .90, .48);
  shell.flatShading = true;
  seam.flatShading = true;

  // A dense internal armored spine remains visible through the gaps between bays.
  addOctFrustum(g, -21.5, 18.5, 2.75, 3.55, 3.35, 4.15, seam);
  addBox(g, [42.0, 1.05, 1.25], trim, [-1.0, 0, 0]);
  addBox(g, [35.0, .55, 3.00], seam, [0, -3.65, 0]);

  // Blunt chisel/ram prow: deliberately short and heavy, opposite to the shield spear.
  addOctFrustum(g, -25.0, -20.8, 1.45, 2.60, 4.85, 5.75, shell);
  addOctFrustum(g, -20.8, -17.0, 4.85, 5.75, 5.45, 6.45, shell);
  addBox(g, [.42, 3.75, 6.25], trim, [-25.16, 0, 0]);
  addBox(g, [.46, 2.85, 5.05], seam, [-25.40, 0, 0]);
  addBox(g, [.50, .48, 6.80], trim, [-25.66, 0, 0]);
  for (const z of [-1, 1]) addBox(g, [.52, 2.15, .34], trim, [-25.68, 0, z * 2.72]);
  addBox(g, [1.15, 7.8, 9.2], trim, [-17.0, 0, 0]);
  addBox(g, [2.0, 6.6, 8.0], seam, [-16.65, 0, 0]);
  for (const y of [-1, 1]) {
    addBox(g, [5.5, 1.0, 7.4], shell, [-20.0, y * 4.40, 0], [0, 0, y * .10]);
    addBox(g, [4.2, .30, 6.4], trim, [-20.0, y * 5.02, 0], [0, 0, y * .10]);
  }

  // Six separate citadel bays. Deep gaps and mismatched heights sell layered armor mass.
  const bays = [
    [-13.2, 4.6, 5.75, 6.65],
    [-7.9, 4.7, 6.35, 7.25],
    [-2.4, 4.8, 6.70, 7.55],
    [3.2, 4.8, 6.55, 7.45],
    [8.7, 4.7, 6.05, 6.95],
    [14.0, 4.6, 5.35, 6.15]
  ];
  for (let i = 0; i < bays.length; i++) {
    const [x, length, hy, hz] = bays[i];
    addOctFrustum(g, x - length / 2, x + length / 2, hy - .20, hz - .20, hy, hz, shell);
    addOctFrustum(g, x - length / 2 - .18, x - length / 2 + .18, hy + .15, hz + .15, hy + .15, hz + .15, trim);
    addOctFrustum(g, x + length / 2 - .18, x + length / 2 + .18, hy + .15, hz + .15, hy + .15, hz + .15, trim);
    // Broad replaceable slabs on dorsal, ventral and both broadside faces.
    addBox(g, [length - .55, .58, hz * 1.20], shell, [x, hy + .32, 0]);
    addBox(g, [length - .55, .52, hz * 1.10], shell, [x, -hy - .30, 0]);
    for (const z of [-1, 1]) {
      addBox(g, [length - .45, hy * 1.28, .62], shell, [x, 0, z * (hz + .28)]);
      addBox(g, [length * .52, hy * .68, .14], seam, [x - .25, .15, z * (hz + .62)]);
      addBox(g, [length * .18, hy * .34, .10], trim, [x + 1.25, -.75, z * (hz + .72)]);
    }
  }

  // Low, bunker-like command block; no tall delicate tower language.
  addBox(g, [13.2, 1.20, 8.20], seam, [.5, 6.95, 0]);
  addBox(g, [10.2, 1.05, 7.00], shell, [1.0, 8.00, 0]);
  addBox(g, [7.3, .92, 5.60], trim, [1.5, 8.95, 0]);
  addBox(g, [4.6, .75, 4.20], seam, [2.0, 9.78, 0]);
  for (const z of [-1, 1]) {
    addBox(g, [7.8, .52, 1.15], trim, [.5, 8.58, z * 3.35]);
    addBox(g, [4.2, 2.15, 1.35], shell, [-5.0, 7.80, z * 4.85]);
  }

  // Heavy lower keel and lateral bastions produce a cross-shaped front silhouette.
  addBox(g, [21.0, 1.35, 4.50], seam, [1.0, -7.25, 0]);
  addBox(g, [15.5, 1.05, 3.50], shell, [1.5, -8.35, 0]);
  addBox(g, [8.0, .75, 2.45], trim, [2.0, -9.25, 0]);
  for (const z of [-1, 1]) {
    addBox(g, [13.5, 3.40, 1.65], seam, [-.5, -1.2, z * 8.00]);
    addBox(g, [10.0, 2.55, 1.35], shell, [.2, -1.0, z * 8.95]);
    addBox(g, [6.2, 1.65, .55], trim, [.7, -1.0, z * 9.72]);
  }

  // Recessed service trenches and repeated bolts give the armor a readable scale.
  for (const x of [-13.2, -7.9, -2.4, 3.2, 8.7, 14.0]) for (const z of [-1, 1]) {
    addBox(g, [2.4, .28, .20], seam, [x, 4.20, z * 6.75]);
    for (const dx of [-.75, 0, .75]) addCyl(g, .11, .22, trim, [x + dx, 4.38, z * 6.90], [Math.PI / 2, 0, 0], 8);
  }

  // Boxed stern clamps frame the standardized engines.
  for (const y of [-1, 1]) for (const z of [-1, 1]) {
    addBox(g, [6.2, 1.55, 2.20], shell, [17.1, y * 4.55, z * 3.65]);
    addBox(g, [4.4, .36, 1.55], trim, [18.0, y * 5.48, z * 3.65]);
  }
  addBox(g, [4.0, 10.2, 1.20], seam, [18.2, 0, 0]);
}

function structureHull(g, d) {
  const shell = finish(d.shell, "structure");
  const seam = mat(d.seam, .88, .58);
  const trim = mat(d.trim, .78, .42);

  // The orthographic sheet is built around three clearly separated masses.
  // Only a narrow keel passes through the open truss necks.
  addBox(g, [46.0, .62, .62], seam, [-3.0, 0, 0]);
  addBox(g, [42.0, .20, 1.55], trim, [-2.0, -.42, 0]);

  // 1. Forward mass: long, broad spearhead (not a radial cone).
  addOctFrustum(g, -27.0, -16.4, .18, .18, 4.9, 4.55, shell);
  addOctFrustum(g, -16.4, -14.1, 4.9, 4.55, 3.65, 3.45, shell);
  addCyl(g, 3.72, .55, trim, [-14.35, 0, 0], [0, 0, Math.PI / 2], 8);
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    addBeam(g, [-25.4, sy * .65, sz * .62], [-16.2, sy * 3.72, sz * 3.45], .17, trim);
    addBeam(g, [-22.1, sy * 1.68, sz * 1.58], [-15.0, sy * 3.55, sz * 3.30], .12, seam);
  }
  for (const x of [-21.8, -18.8, -16.2]) {
    const t = (x + 27) / 10.6;
    addCyl(g, .16, 2 * (4.55 * t + .2), trim, [x, 0, 0], [Math.PI / 2, 0, 0], 8);
  }

  // 2. Centre mass: oversized octagonal citadel with cathedral-like vertical rhythm.
  addCyl(g, 5.65, 10.2, shell, [2.4, 0, 0], [0, 0, Math.PI / 2], 8);
  addCyl(g, 5.15, .72, trim, [-2.75, 0, 0], [0, 0, Math.PI / 2], 8);
  addCyl(g, 5.15, .72, trim, [7.55, 0, 0], [0, 0, Math.PI / 2], 8);
  addBox(g, [7.7, 1.65, 5.7], shell, [2.45, 5.25, 0]);
  addBox(g, [6.2, 1.25, 4.7], seam, [2.45, 6.55, 0]);
  addBox(g, [7.2, 1.45, 5.3], shell, [2.45, -5.25, 0]);
  addBox(g, [5.6, 1.05, 4.1], seam, [2.45, -6.42, 0]);
  for (const z of [-1, 1]) {
    addBeam(g, [-1.9, 3.65, z * 4.65], [2.4, 6.95, z * 2.15], .24, trim);
    addBeam(g, [2.4, 6.95, z * 2.15], [6.7, 3.65, z * 4.65], .24, trim);
    addBeam(g, [-1.7, -3.65, z * 4.55], [2.4, -6.7, z * 1.9], .20, trim);
    addBeam(g, [2.4, -6.7, z * 1.9], [6.5, -3.65, z * 4.55], .20, trim);
  }
  for (const x of [-.7, 1.0, 2.7, 4.4, 6.1]) {
    addCone(g, .42, 2.8 + Math.abs(x - 2.7) * .28, trim, [x, 8.0 - Math.abs(x - 2.7) * .16, 0]);
    addCone(g, .34, 2.0, trim, [x, -7.55, 0], [0, 0, Math.PI]);
  }
  for (const x of [-1.2, 1.2, 3.6, 6.0]) for (const z of [-1, 1]) {
    addBox(g, [1.35, .24, .78], seam, [x, 4.45, z * 4.65]);
    addBox(g, [.76, .16, .30], trim, [x, 4.62, z * 5.02]);
  }

  // 3. Rear mass: three stacked machinery lobes from the side/front drawings.
  addOctFrustum(g, 12.6, 14.3, 3.85, 3.75, 4.8, 4.45, shell);
  addBox(g, [6.8, 4.1, 8.2], shell, [17.2, 0, 0]);
  addBox(g, [6.2, 2.35, 7.0], shell, [17.5, 4.25, 0]);
  addBox(g, [6.2, 2.35, 7.0], shell, [17.5, -4.25, 0]);
  addBox(g, [3.2, 9.9, 7.7], seam, [20.15, 0, 0]);
  for (const y of [-1, 0, 1]) {
    addBox(g, [5.5, .30, 7.5], trim, [17.7, y * 3.15, 0]);
  }
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    addBeam(g, [13.2, sy * 3.25, sz * 3.15], [20.4, sy * 4.55, sz * 3.45], .18, trim);
  }

  // Long empty spans are essential to the silhouette in all three views.
  addStructureTruss(g, -13.7, -3.0, 2.65, 2.45, trim, seam);
  addStructureTruss(g, 7.9, 12.3, 2.95, 2.7, trim, seam);
}

function baseHull(g, kind) {
  if (kind === "shield") {
    shieldHull(g, DEFENSE.shield);
    return;
  }
  if (kind === "armor") {
    armorHull(g, DEFENSE.armor);
    return;
  }
  if (kind === "structure") {
    structureHull(g, DEFENSE.structure);
    return;
  }
  const d = DEFENSE[kind], shell = finish(d.shell, kind), seam = mat(d.seam, .82, kind === "shield" ? .28 : .5), trim = mat(d.trim, .82, kind === "armor" ? .5 : .3);
  // Primary capsule and tapered bow/stern volumes.
  addCapsule(g, 4.35, 29.5, seam, [0, 0, 0]);
  addSphere(g, [9.5, 5.0, 4.8], shell, [-7.0, 0, 0]);
  addSphere(g, [7.8, 5.1, 5.0], shell, [6.5, 0, 0]);
  addSphere(g, [3.2, 3.8, 4.0], seam, [-15.7, 0, 0]);
  // Tapered end caps make the longitudinal silhouette read as a capital ship.
  addCone(g, 4.35, 7.0, shell, [-14.0, 0, 0], [0, 0, -Math.PI / 2]);
  addCone(g, 3.85, 6.0, seam, [14.7, 0, 0], [0, 0, Math.PI / 2]);
  addRing(g, 3.9, .22, trim, [-16.6, 0, 0]);
  addRing(g, 3.5, .18, trim, [15.7, 0, 0]);
  // Repeating transverse armor/rib language from the side view.
  for (const x of [-9, -6, -3, 0, 3, 6, 9, 12]) addRing(g, 4.55, .12, trim, [x, 0, 0]);
  // Angular shoulders and keel establish a non-circular front cross-section.
  for (const y of [-1, 1]) for (const z of [-1, 1]) {
    addBox(g, [18, 1.0, 1.2], trim, [0, y * 3.55, z * 2.9], [0, y * .06, y * z * .12]);
  }
  addBox(g, [13, 1.0, 2.4], seam, [-1, -4.15, 0]);
  addBox(g, [11, .8, 2.0], trim, [5, 4.2, 0]);
  // Small service panels and seam markers add scale without changing the silhouette.
  for (const x of [-12, -8, -4, 0, 4, 8, 12]) for (const z of [-1, 1]) {
    addBox(g, [1.5, .18, .65], seam, [x, 2.35, z * 4.35]);
    addBox(g, [.45, .22, .22], trim, [x + .55, 2.48, z * 4.48]);
  }
  // Central dorsal command tower and keel, shared by all defensive shells.
  addBox(g, [4.8, .75, 3.1], trim, [-1, 5.0, 0]);
  addBox(g, [3.4, 1.1, 2.5], seam, [1.0, 5.7, 0]);
  addBox(g, [2.2, 1.0, 1.8], trim, [2.4, 6.45, 0]);
  addBox(g, [5.6, .5, 2.8], trim, [-1, -5.0, 0]);
  // Upper/lower module rails remain fixed across all defensive shells.
  for (const y of [-1, 1]) {
    addBox(g, [12, .35, 1.0], trim, [1, y * 5.1, 0]);
    for (const x of [-7, -3, 1, 5, 9]) addBox(g, [.7, .65, 1.25], seam, [x, y * 5.25, 0]);
  }
  if (kind === "shield") {
    // Smooth outer shell: only shallow fins break the envelope.
    for (const z of [-1, 1]) addBox(g, [12, .5, 1.5], trim, [1, 0, z * 4.25]);
    for (const z of [-1, 1]) {
      addBox(g, [10, .22, .22], trim, [-1, 2.5, z * 4.45]);
      addBox(g, [7, .22, .22], trim, [6, -2.5, z * 4.45]);
    }
  } else if (kind === "armor") {
    // Heavy segmented plates: broad slabs sit outside the capsule.
    for (const x of [-9, -6, -3, 0, 3, 6, 9, 12]) {
      addBox(g, [.72, 5.5, 5.8], shell, [x, 0, 0]);
      addRing(g, 4.9, .30, trim, [x, 0, 0]);
    }
    for (const y of [-1, 1]) for (const z of [-1, 1]) addBox(g, [10, 1.15, 1.35], shell, [1, y * 4.7, z * 3.4]);
  }
}

function laser(g, coreKind) {
  const laserColor = coreHue(coreKind);
  const m = mat(0x5b7180, .90, .26), dark = mat(0x101820, .94, .40), e = glow(laserColor);

  // Standardized rear mounting collar and exposed axial power trunk.
  addCyl(g, 4.15, 1.45, dark, [-16.0, 0, 0], [0, 0, Math.PI / 2], 24);
  addRing(g, 4.08, .30, m, [-16.75, 0, 0]);
  addRing(g, 3.48, .14, e, [-16.82, 0, 0]);
  addCyl(g, 2.52, 5.7, dark, [-19.25, 0, 0], [0, 0, Math.PI / 2], 20);
  addCyl(g, 1.16, 9.8, dark, [-23.0, 0, 0], [0, 0, Math.PI / 2], 20);
  addCyl(g, .44, 9.1, e, [-23.35, 0, 0], [0, 0, Math.PI / 2], 16);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, y = Math.cos(a) * 1.78, z = Math.sin(a) * 1.78;
    addCyl(g, .17, 6.2, e, [-19.6, y, z], [0, 0, Math.PI / 2], 10);
    addBox(g, [4.8, .48, .52], m, [-19.1, y, z]);
  }

  // Three mechanically distinct focusing stages, animated from rear to front.
  const focusStages = [
    [-20.25, 3.02, 0], [-22.75, 2.68, 1], [-25.05, 2.30, 2]
  ];
  for (const [x, radius, index] of focusStages) {
    const rotor = new THREE.Group(); rotor.position.x = x;
    rotor.userData.titanLaserFocus = { rotor: true, index };
    addCyl(rotor, radius + .42, .58, dark, [0, 0, 0], [0, 0, Math.PI / 2], 20);
    addRing(rotor, radius + .32, .16, m, [0, 0, 0]);
    const focusMaterial = e.clone(); focusMaterial.emissiveIntensity = .55;
    const focusRing = addRing(rotor, radius, .17, focusMaterial, [0, 0, 0]);
    focusRing.userData.titanLaserFocus = { rotor: false, index, baseIntensity: .55 };
    for (let j = 0; j < 4; j++) {
      const a = j * Math.PI / 2 + index * Math.PI / 8;
      addBox(rotor, [.72, .38, .68], m, [0, Math.cos(a) * radius, Math.sin(a) * radius], [a, 0, 0]);
    }
    g.add(rotor);
  }

  // Four long primary talons alternate with four shorter stabilizer talons.
  for (let i = 0; i < 8; i++) {
    const isLong = i % 2 === 0;
    const claw = new THREE.Group();
    claw.rotation.x = i * Math.PI / 4;
    claw.userData.titanLaserClaw = { baseRotation: claw.rotation.x, isLong, index: i };
    const points = isLong
      ? [[-17.1, 3.05], [-20.6, 4.45], [-24.5, 4.70], [-27.5, 3.25], [-29.15, 1.45]]
      : [[-18.0, 2.72], [-21.0, 3.72], [-24.0, 3.48], [-26.25, 1.62]];
    for (let j = 0; j < points.length - 1; j++) {
      const width = (isLong ? .92 : .72) - j * (isLong ? .13 : .12);
      const depth = (isLong ? 1.02 : .78) - j * .10;
      addClawSegment(claw, points[j], points[j + 1], width, depth, m);
      if (j > 0) addCyl(claw, Math.max(.28, width * .58), depth + .20, dark, [points[j][0], points[j][1], 0], [Math.PI / 2, 0, 0], 16);
      if (j >= 1) {
        const a = points[j], b = points[j + 1];
        addClawSegment(claw, [a[0] - .02, a[1] - .20], [b[0] + .04, b[1] - .16], .11, .16, e);
      }
    }
    g.add(claw);
  }

  // Deep emitter aperture. The beam only appears during the firing phase.
  addCyl(g, 1.38, 1.65, dark, [-27.25, 0, 0], [0, 0, Math.PI / 2], 20);
  addRing(g, 1.34, .20, m, [-28.0, 0, 0]);
  addRing(g, .88, .18, e, [-28.08, 0, 0]);
  addCyl(g, .50, 1.20, e, [-28.45, 0, 0], [0, 0, Math.PI / 2], 16);
  addLaserRay(g, .19, 23, laserColor, -29.0);
}
function missile(g, coreKind) {
  const coreColor = coreHue(coreKind);
  const housing = mat(0x262d32, .94, .42), armor = mat(0x796d5d, .90, .40), edge = mat(WEAPONS.missile, .86, .34);
  const well = mat(0x070a0d, .60, .72), indicator = glow(coreColor), missileBody = mat(0x3f4649, .86, .36);

  // Central armored carousel and standardized rear mounting collar.
  addCyl(g, 3.55, 7.5, housing, [-7.2, 0, 0], [0, 0, Math.PI / 2], 24);
  addRing(g, 3.58, .28, edge, [-10.82, 0, 0]);
  addRing(g, 3.62, .25, armor, [-3.58, 0, 0]);
  addCyl(g, 2.78, 2.0, armor, [-3.0, 0, 0], [0, 0, Math.PI / 2], 20);
  addRing(g, 2.82, .22, indicator, [-2.08, 0, 0]);
  for (const x of [-9.3, -7.2, -5.1]) addRing(g, 3.18, .13, indicator, [x, 0, 0]);

  const hatchLayout = [
    { x: -9.35, z: 0, radius: 1.34, large: true },
    { x: -6.75, z: 0, radius: .72, large: false },
    { x: -5.05, z: -1.04, radius: .72, large: false },
    { x: -5.05, z: 1.04, radius: .72, large: false }
  ];

  for (let wingIndex = 0; wingIndex < 4; wingIndex++) {
    const wing = new THREE.Group();
    wing.rotation.x = wingIndex * Math.PI / 2;
    wing.userData.titanMissileWing = { index: wingIndex };

    // Radial structural arm, armored magazine and thick outward-facing door deck.
    for (const x of [-9.7, -7.2, -4.7]) addBeam(wing, [x, 2.45, -1.15], [x, 5.05, -1.55], .18, edge);
    for (const x of [-9.7, -7.2, -4.7]) addBeam(wing, [x, 2.45, 1.15], [x, 5.05, 1.55], .18, edge);
    addBox(wing, [8.65, 4.95, 3.95], housing, [-7.15, 7.18, 0]);
    addBox(wing, [8.20, .55, 3.55], armor, [-7.15, 9.82, 0]);
    addBox(wing, [8.55, .24, .28], edge, [-7.15, 10.16, -1.77]);
    addBox(wing, [8.55, .24, .28], edge, [-7.15, 10.16, 1.77]);
    for (const x of [-10.95, -7.15, -3.35]) addBox(wing, [.28, .32, 3.80], edge, [x, 10.02, 0]);
    addBox(wing, [6.8, .32, .26], indicator, [-7.1, 10.17, 0]);

    hatchLayout.forEach((cell, cellIndex) => {
      const { x, z, radius, large } = cell;
      addCyl(wing, radius + .18, .42, well, [x, 10.20, z], [0, 0, 0], 6);
      addRing(wing, radius + .13, .10, edge, [x, 10.42, z], [Math.PI / 2, 0, 0]);

      const door = new THREE.Group();
      door.position.set(x, 10.47, z);
      const doorMaterial = armor.clone();
      doorMaterial.emissive = new THREE.Color(coreColor); doorMaterial.emissiveIntensity = .05;
      addCyl(door, radius, .30, doorMaterial, [0, 0, 0], [0, 0, 0], 6);
      addBox(door, [radius * 1.48, .34, .10], edge, [0, .02, 0]);
      addBox(door, [.16, .36, radius * 1.34], edge, [0, .03, 0]);
      const lamp = addRing(door, radius * .68, .07, indicator.clone(), [0, .18, 0], [Math.PI / 2, 0, 0]);
      lamp.material.emissiveIntensity = .65;
      door.userData.missileDoor = { fortress: true, baseZ: z, slide: cellIndex % 2 ? 1 : -1, wingIndex, cellIndex, large };
      wing.add(door);

      const round = new THREE.Group();
      round.position.set(x, 8.95, z);
      addCyl(round, radius * .34, large ? 2.65 : 1.72, missileBody, [0, 0, 0], [0, 0, 0], 12);
      addCone(round, radius * .35, large ? 1.22 : .82, edge, [0, large ? 1.92 : 1.27, 0]);
      addCyl(round, radius * .20, .34, indicator.clone(), [0, large ? -1.48 : -.98, 0], [0, 0, 0], 10);
      for (const side of [-1, 1]) addBox(round, [radius * .34, .52, .10], edge, [0, large ? -1.0 : -.65, side * radius * .38]);
      round.userData.titanMissileRound = { baseY: 8.95, wingIndex, cellIndex, large };
      wing.add(round);
    });

    g.add(wing);
  }
}
function cannon(g, coreKind) {
  const coreColor = coreHue(coreKind);
  const gunmetal = mat(0x34393c, .96, .30), jacket = mat(0x6d6559, .94, .38);
  const dark = mat(0x101417, .82, .62), bronze = mat(WEAPONS.cannon, .88, .30);
  const indicator = glow(coreColor);

  // Fixed barbette: a broad, armored bow socket keeps the four guns feeling like
  // one capital-scale siege system instead of four unrelated turret props.
  addCyl(g, 4.65, 3.0, dark, [-3.8, 0, 0], [0, 0, Math.PI / 2], 16);
  addRing(g, 4.64, .30, jacket, [-5.22, 0, 0]);
  addRing(g, 4.25, .18, bronze, [-2.38, 0, 0]);
  addBox(g, [5.6, 7.7, 7.8], gunmetal, [-6.7, 0, 0]);
  addBox(g, [4.8, 8.25, .42], jacket, [-6.9, 0, -4.10]);
  addBox(g, [4.8, 8.25, .42], jacket, [-6.9, 0, 4.10]);
  for (const y of [-3.65, 3.65]) addBox(g, [5.0, .38, 7.6], bronze, [-6.8, y, 0]);
  for (const z of [-1, 1]) addBox(g, [3.8, .22, .24], indicator, [-6.7, 4.02, z * 2.25]);

  const positions = [[2.25, 2.35], [2.25, -2.35], [-2.25, 2.35], [-2.25, -2.35]];
  positions.forEach(([y, z], index) => {
    const gun = new THREE.Group();
    gun.position.set(0, y, z);
    gun.userData.titanCannonAssembly = { index, baseX: 0 };

    // Oversized polygonal breech, loading block and recoil cradle.
    addBox(gun, [4.8, 2.35, 2.55], jacket, [-8.0, 0, 0]);
    addBox(gun, [2.5, 2.70, 2.90], gunmetal, [-9.7, 0, 0]);
    addBox(gun, [1.15, 2.92, 3.12], bronze, [-10.75, 0, 0]);
    addBox(gun, [.30, 1.65, 3.35], dark, [-8.15, 0, 0]);
    addBox(gun, [1.55, .30, 3.18], bronze, [-7.55, 1.18, 0]);

    // Twin exposed recuperators make the recoil mechanism readable in silhouette.
    for (const side of [-1, 1]) {
      addCyl(gun, .26, 5.0, bronze, [-10.6, side * 1.42, 0], [0, 0, Math.PI / 2], 12);
      addCyl(gun, .37, 1.0, dark, [-8.35, side * 1.42, 0], [0, 0, Math.PI / 2], 12);
      addCyl(gun, .35, .58, indicator.clone(), [-12.85, side * 1.42, 0], [0, 0, Math.PI / 2], 12);
    }

    // Three-stage barrel: thick chamber, armored thermal sleeve and narrow bore.
    addCyl(gun, 1.02, 3.2, dark, [-12.2, 0, 0], [0, 0, Math.PI / 2], 16);
    addCyl(gun, .78, 4.2, jacket, [-15.3, 0, 0], [0, 0, Math.PI / 2], 16);
    addCyl(gun, .55, 5.0, gunmetal, [-19.7, 0, 0], [0, 0, Math.PI / 2], 16);
    for (const x of [-13.55, -16.95, -18.25]) addRing(gun, .82, .14, bronze, [x, 0, 0]);

    // Boxy multi-baffle muzzle brake with visible side pressure vents.
    addCyl(gun, 1.02, 2.35, dark, [-22.75, 0, 0], [0, 0, Math.PI / 2], 12);
    addRing(gun, 1.04, .20, bronze, [-21.65, 0, 0]);
    addRing(gun, 1.08, .22, jacket, [-23.86, 0, 0]);
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      addBox(gun, [1.55, .38, .58], bronze, [-22.75, sy * .78, sz * .55]);
    }
    addCyl(gun, .48, .38, mat(0x030506, .25, .9), [-24.08, 0, 0], [0, 0, Math.PI / 2], 16);

    // Short additive blast layers, normally hidden and revealed by the salvo cycle.
    const blastLayer = (radius, length, color, opacity) => {
      const material = flameMat(color, opacity);
      const blast = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 20, 1, true), material);
      blast.rotation.z = Math.PI / 2;
      blast.position.set(-24.2 - length / 2, 0, 0);
      blast.visible = false;
      blast.userData.titanCannonBlast = { index, baseOpacity: opacity, phase: radius * 9 };
      gun.add(blast);
    };
    blastLayer(2.25, 7.2, coreColor, .24);
    blastLayer(1.15, 5.2, 0xffc36a, .62);
    blastLayer(.44, 3.8, 0xffffff, .92);
    g.add(gun);
  });

  // Central stereoscopic rangefinder breaks the strict four-barrel grid.
  addBox(g, [3.8, 1.15, 1.35], gunmetal, [-10.0, 0, 0]);
  addCyl(g, .48, 1.0, indicator, [-12.0, 0, 0], [0, 0, Math.PI / 2], 16);
  addRing(g, .52, .10, bronze, [-12.52, 0, 0]);
}
function weapon(g, kind, coreKind) { if (kind === "laser") laser(g, coreKind); else if (kind === "missile") missile(g, coreKind); else cannon(g, coreKind); }

function doomsdayRig(g, coreKind) {
  const color = coreHue(coreKind), energy = glow(color);
  energy.emissiveIntensity = 2.05;
  const frame = mat(0x20282d, .94, .38), casing = mat(0x56636a, .90, .34);
  const dark = mat(0x090d10, .72, .66), trim = mat(0x8b887f, .92, .30);

  // Blue and red use standardized broadside clamps. Violet instead receives a
  // bow-wrapping fork below, so its silhouette and clearance are independent.
  if (coreKind !== "violet") for (const side of [-1, 1]) {
    const z = side * 12.5;
    addBeam(g, [-1.9, 3.35, side * 4.55], [-2.8, 1.05, z - side * 1.05], .24, trim);
    addBeam(g, [-1.9, -3.35, side * 4.55], [-2.8, -1.05, z - side * 1.05], .24, trim);
    addBeam(g, [3.2, 3.15, side * 4.45], [3.7, 1.00, z - side * 1.05], .22, frame);
    addBeam(g, [3.2, -3.15, side * 4.45], [3.7, -1.00, z - side * 1.05], .22, frame);
    addBox(g, [8.8, 2.7, 1.65], frame, [.2, 0, z]);
    addBox(g, [7.8, 2.2, 1.92], casing, [-.4, 0, z]);
    addBox(g, [1.0, 3.15, 2.12], trim, [3.45, 0, z]);
    const bus = addBox(g, [5.9, .17, 2.18], energy.clone(), [-.5, 1.18, z]);
    bus.userData.titanDoomsdayPulse = { baseIntensity: 2.2, phase: side > 0 ? 0 : Math.PI };
  }

  if (coreKind === "blue") {
    // Fleet Dominion Matrix: broad phased-array leaves and command masts.
    for (const side of [-1, 1]) {
      const z = side * 12.5;
      for (let i = -2; i <= 2; i++) {
        const x = i * 1.48 - .35;
        const vane = addBox(g, [1.16, 5.25 - Math.abs(i) * .32, .25], casing, [x, 2.45, z], [0, 0, i * -.055]);
        vane.userData.titanDoomsdayVane = { baseY: 2.45, phase: i * .55 + side };
        addBox(g, [.74, 3.85 - Math.abs(i) * .24, .10], energy.clone(), [x, 2.48, z + side * .18], [0, 0, i * -.055]);
      }
      addBox(g, [8.2, .30, .46], trim, [-.35, 5.18, z]);
      addCyl(g, .58, 2.15, energy.clone(), [-.3, 6.35, z], [0, 0, 0], 12);
      addCone(g, .42, 1.55, trim, [-.3, 8.18, z]);
    }
    const crown = addRing(g, 1.75, .20, energy.clone(), [1.3, 9.35, 0], [Math.PI / 2, 0, 0]);
    crown.userData.titanDoomsdayRotor = { speed: .004, axis: "y" };
    addCyl(g, .48, 2.7, trim, [1.3, 8.35, 0], [0, 0, 0], 12);
  } else if (coreKind === "red") {
    // Judgement Lances: paired spinal rails, capacitor drums and deep apertures.
    for (const side of [-1, 1]) {
      const z = side * 12.5;
      addBox(g, [7.0, 3.35, 2.55], frame, [-3.6, 0, z]);
      addBox(g, [2.45, 3.75, 2.92], trim, [-6.7, 0, z]);
      for (const y of [-1, 1]) {
        addBox(g, [9.8, .42, .44], casing, [-10.4, y * 1.15, z]);
        addBox(g, [8.9, .17, .18], energy.clone(), [-10.8, y * 1.15, z + side * .25]);
      }
      for (const x of [-3.5, -5.0, -6.5]) {
        addCyl(g, .54, 1.65, dark, [x, 0, z], [Math.PI / 2, 0, 0], 14);
        const cell = addCyl(g, .31, 1.82, energy.clone(), [x, 0, z], [Math.PI / 2, 0, 0], 14);
        cell.userData.titanDoomsdayPulse = { baseIntensity: 2.4, phase: (x + 7) * .8 + side };
      }
      addCyl(g, 1.48, 2.3, frame, [-15.0, 0, z], [0, 0, Math.PI / 2], 12);
      addRing(g, 1.46, .24, trim, [-16.05, 0, z]);
      addCyl(g, .76, 1.2, dark, [-16.62, 0, z], [0, 0, Math.PI / 2], 16);
      const muzzle = addRing(g, .83, .14, energy.clone(), [-17.18, 0, z]);
      muzzle.userData.titanDoomsdayPulse = { baseIntensity: 2.8, phase: side > 0 ? .6 : 1.8 };
    }
  } else {
    // Rift Corrosion Array: a split bow fork surrounds a suspended singularity.
    // The cavity sits above and ahead of every conventional weapon.
    const cavity = new THREE.Vector3(-26.2, 9.0, 0);
    for (const side of [-1, 1]) {
      const path = [
        [3.4, 2.0, side * 11.8], [-5.0, 3.4, side * 12.9],
        [-13.7, 5.1, side * 11.5], [-20.0, 7.0, side * 8.4],
        [-23.4, 8.3, side * 5.45]
      ];
      // Two-layer armored crescents and their exposed violet power tendons.
      for (let i = 0; i < path.length - 1; i++) {
        const taper = 1 - i * .11;
        addBoxBeam(g, path[i], path[i + 1], 2.45 * taper, 1.62 * taper, casing);
        const lowerA = [path[i][0], path[i][1] - .38, path[i][2]];
        const lowerB = [path[i + 1][0], path[i + 1][1] - .38, path[i + 1][2]];
        addBoxBeam(g, lowerA, lowerB, 1.36 * taper, 1.78 * taper, frame);
        const upperA = [path[i][0], path[i][1] + .48, path[i][2] - side * .06];
        const upperB = [path[i + 1][0], path[i + 1][1] + .48, path[i + 1][2] - side * .06];
        addBoxBeam(g, upperA, upperB, .32, .52, casing);
        const veinA = [path[i][0], path[i][1] + .76, path[i][2] + side * .05];
        const veinB = [path[i + 1][0], path[i + 1][1] + .76, path[i + 1][2] + side * .05];
        const vein = addBeam(g, veinA, veinB, .105, energy.clone());
        vein.userData.titanDoomsdayPulse = { baseIntensity: 2.25, phase: i * .55 + side };
      }

      // Supports terminate outside the 10.2-unit missile-wing envelope.
      addBeam(g, [3.0, 3.55, side * 4.7], [2.7, 2.0, side * 11.2], .28, trim);
      addBeam(g, [-4.2, 4.15, side * 5.1], [-5.0, 3.4, side * 12.3], .25, trim);
      addBox(g, [4.4, 2.8, 1.95], casing, [1.0, 2.0, side * 12.1]);
      addBox(g, [3.5, .22, 2.08], energy.clone(), [.7, 3.46, side * 12.1]);
    }

    // The halo remains above the primary gun envelope and links both crescents.
    const outerHalo = addRing(g, 4.55, .28, casing, cavity.toArray());
    outerHalo.userData.titanDoomsdayRotor = { speed: .0025, axis: "x" };
    const innerHalo = addRing(g, 3.78, .12, energy.clone(), [-26.35, 9.0, 0]);
    innerHalo.userData.titanDoomsdayRotor = { speed: -.0045, axis: "x" };

    // Eight hooked talons turn inward and forward around the aperture.
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      const hook = i % 2 ? .22 : -.22;
      const root = [-25.3, cavity.y + Math.cos(a) * 4.65, Math.sin(a) * 4.65];
      const knuckle = [-27.1, cavity.y + Math.cos(a + hook) * 3.55, Math.sin(a + hook) * 3.55];
      const tip = [-28.55, cavity.y + Math.cos(a + hook * .28) * 1.75, Math.sin(a + hook * .28) * 1.75];
      addBoxBeam(g, root, knuckle, .82, .72, casing);
      addBoxBeam(g, knuckle, tip, .54, .48, trim);
      const glowStart = [-26.1, cavity.y + Math.cos(a + hook * .55) * 3.72, Math.sin(a + hook * .55) * 3.72];
      const glowEnd = [-28.15, cavity.y + Math.cos(a + hook * .30) * 2.02, Math.sin(a + hook * .30) * 2.02];
      addBeam(g, glowStart, glowEnd, .09, energy.clone());
      const clawPoint = [-29.25, cavity.y + Math.cos(a + hook * .18) * 1.18, Math.sin(a + hook * .18) * 1.18];
      addConeBetween(g, tip, clawPoint, .34, casing);
    }

    addSphere(g, [1.28, 1.28, 1.28], dark, cavity.toArray());
    const singularity = addSphere(g, [.72, .72, .72], energy.clone(), [-26.45, 9.0, 0]);
    singularity.userData.titanRiftEffect = { kind: "core", baseScale: .72, baseIntensity: 4.2 };
    const lens = addSphere(g, [2.0, 2.0, 2.0], flameMat(color, .06), [-26.4, 9.0, 0]);
    lens.userData.titanRiftEffect = { kind: "lens", baseScale: 2.0, baseOpacity: .06 };
    const riftLight = new THREE.PointLight(color, 2, 18, 2);
    riftLight.position.set(-26.4, 9.0, 0);
    riftLight.userData.titanRiftEffect = { kind: "light" };
    g.add(riftLight);
  }
}

function core(g, kind, defense) {
  const c = coreHue(kind), e = glow(c);
  const housing = mat(0x182735);
  if (defense === "structure") {
    // Keep the core readable without replacing the citadel's polygonal silhouette.
    for (const z of [-1, 1]) {
      addCyl(g, 1.55, .48, housing, [2.4, 0, z * 5.72], [Math.PI / 2, 0, 0], 8);
      addCyl(g, 1.12, .52, e, [2.4, 0, z * 5.98], [Math.PI / 2, 0, 0], 8);
    }
    for (const z of [-1, 1]) addBox(g, [31, .13, .13], e, [-1.5, 0, z * 5.25]);
    return;
  }
  for (const z of [-1, 1]) {
    addCyl(g, 2.85, .8, housing, [2.5, 0, z * 4.85], [Math.PI / 2, 0, 0]);
    addRing(g, 2.25, .18, e, [2.5, 0, z * 5.3], [0, 0, 0]);
  }
  addRing(g, 2.5, .18, e, [2.5, 0, 0]);
  addRing(g, 3.1, .10, e, [2.5, 0, 0]);
  addCyl(g, .68, 1.8, e, [2.5, 0, 0], [0, 0, Math.PI / 2]);
  // Longitudinal energy channels visually connect the core to bow and stern.
  for (const z of [-1, 1]) {
    addBox(g, [23, .16, .16], e, [1.5, 0, z * 4.58]);
    addBox(g, [12, .18, .18], e, [-4.5, 2.35, z * 3.9]);
    addBox(g, [10, .18, .18], e, [8.0, -2.35, z * 3.9]);
    for (const x of [-10, -5, 0, 5, 10, 15]) addCyl(g, .20, .35, e, [x, 0, z * 4.62], [Math.PI / 2, 0, 0], 12);
  }
  for (const z of [-1, 1]) addRing(g, 1.75, .12, e, [2.5, 0, z * 4.95], [0, 0, 0]);
}

export function buildTitanBase(defense = "shield", coreKind = "blue") {
  const g = new THREE.Group();
  baseHull(g, defense);
  const engineColor = coreHue(coreKind);
  const engine = glow(engineColor);
  const engineHousing = mat(0x182735), engineTrim = mat(0x405866);
  // Twin recessed nacelles plus a central exhaust give the stern a heavy power block.
  for (const z of [-1, 1]) {
    addCyl(g, 1.45, 4.8, engineHousing, [15.2, z * 2.35, 0], [0, Math.PI / 2, 0]);
    addRing(g, 1.5, .16, engineTrim, [16.8, z * 2.35, 0]);
    addCyl(g, .58, 4.2, engine, [17.4, z * 2.35, 0], [0, Math.PI / 2, 0]);
    addRing(g, .9, .12, engine, [19.45, z * 2.35, 0]);
  }
  addCyl(g, 1.25, 3.8, engineHousing, [17.0, 0, 0], [0, Math.PI / 2, 0]);
  addCyl(g, .68, 3.9, engine, [18.8, 0, 0], [0, Math.PI / 2, 0]);
  addRing(g, 1.05, .14, engine, [20.7, 0, 0]);
  addFlame(g, 1.8, 10.0, engineColor, [20.7, 0, 0]);
  for (const z of [-1, 1]) {
    addFlame(g, 2.4, 13.0, engineColor, [19.9, z * 2.35, 0]);
    addRing(g, 1.35, .12, engine, [19.9, z * 2.35, 0]);
  }
  addBox(g, [5.5, 1.2, .7], engineTrim, [15.5, 4.4, 0]);
  addBox(g, [5.5, 1.2, .7], engineTrim, [15.5, -4.4, 0]);
  return g;
}

export function buildTitan(defense = "shield", weaponKind = "laser", coreKind = "blue") {
  const g = buildTitanBase(defense, coreKind);
  weapon(g, weaponKind, coreKind); core(g, coreKind, defense); doomsdayRig(g, coreKind);
  return g;
}
