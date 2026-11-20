// city.js — Porto Serena itself: the road grid, city blocks and towers, palm avenues,
// neon signs, street lights, the beach and the marina pier, plus the golden-hour sky.
// Everything is procedural (canvas textures and boxes), so the game ships no image files.

import * as THREE from 'three';
import { Rng } from './rng.js';

/** Road centrelines: a grid every 56 units, from -168 to 168 on both axes. */
export const ROAD_LINES = [-168, -112, -56, 0, 56, 112, 168];
/** City block centres, between the roads. */
export const BLOCK_CENTERS = [-140, -84, -28, 28, 84, 140];
/** Half the width of a road. */
export const ROAD_HALF = 8;
/** The shoreline: sand ends and water begins at this z. */
export const SHORE_Z = 196;
/** How far anything may roam from the centre before the world pushes back. */
export const WORLD_BOUND = 252;

/** Landmarks the missions and respawns point at. */
export const PLACES = {
  bar: { x: -162, z: 88, name: "Rosa's Bar Ondina" },
  marina: { x: 116, z: 178, name: 'Marina warehouse' },
  hotel: { x: 162, z: -112, name: 'Hotel Marisol' },
  terminal: { x: -112, z: -162, name: 'Bus terminal' },
  safehouse: { x: 28, z: -162, name: "Cousin's garage" },
  pier: { x: 114, z: 238, name: 'The escape boat' },
  policeStation: { x: 0, z: -178, name: 'Porto Serena PD' },
  clinic: { x: 178, z: 24, name: 'Clinica del Sol' },
};

const SIGN_WORDS = [
  ['HOTEL MARISOL', '#ff5e8a'], ['BAR ONDINA', '#ffb347'], ['CAFE ONDA', '#4fe3c1'],
  ['PALMS CASINO', '#c792ff'], ['TACO LUNA', '#ffe066'], ['CLINICA DEL SOL', '#7ae0ff'],
  ['GYM FUERTE', '#ff7a59'], ['MARKET 24H', '#9dff70'], ['CINE BRISA', '#ff5e8a'],
  ['DISCO FARO', '#4fe3c1'], ['PIZZA VOLCAN', '#ffb347'], ['BANCO SERENA', '#7ae0ff'],
];

/** A canvas texture of a tower's windows: some lit warm, some dark, a few cool. */
function buildingTexture(rng, base, litRatio) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 16; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const x = 8 + col * 20;
      const y = 10 + row * 15;
      const lit = rng.chance(litRatio);
      ctx.fillStyle = lit ? (rng.chance(0.75) ? '#ffd489' : '#a8e6ff') : '#232833';
      ctx.fillRect(x, y, 12, 8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A glowing neon sign texture with the given word. */
function signTexture(word, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#14101c';
  ctx.fillRect(0, 0, 512, 96);
  ctx.font = 'bold 52px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.fillStyle = color;
  ctx.fillText(word, 256, 50);
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.fillText(word, 256, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A palm frond leaf texture, drawn once and reused by every palm in the city. */
function palmLeafTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = '#2e8b57';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(4, 124);
  ctx.quadraticCurveTo(64, 40, 124, 110);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 9; i += 1) {
    const t = i / 9;
    const x = 4 + t * 110;
    const y = 124 - Math.sin(t * 1.9) * 62 * t - t * 8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 14, y + 22);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The whole ground in one canvas: sand, pavements, asphalt, dashes and crosswalks. */
function groundTexture() {
  const size = 2048;
  const world = 560;
  const scale = size / world;
  const toPx = (v) => (v + world / 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#b3925e';
  ctx.fillRect(0, 0, size, size);
  // Beach sand to the south.
  ctx.fillStyle = '#dec084';
  ctx.fillRect(0, toPx(178), size, size - toPx(178));
  // City slab.
  ctx.fillStyle = '#7e8087';
  ctx.fillRect(toPx(-186), toPx(-186), 372 * scale, 372 * scale);
  // Block pavements.
  ctx.fillStyle = '#8b8d93';
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) ctx.fillRect(toPx(bx - 24), toPx(bz - 24), 48 * scale, 48 * scale);
  }
  // Roads.
  ctx.fillStyle = '#3a3e46';
  for (const c of ROAD_LINES) {
    ctx.fillRect(toPx(-186), toPx(c - ROAD_HALF), 372 * scale, 16 * scale);
    ctx.fillRect(toPx(c - ROAD_HALF), toPx(-186), 16 * scale, 372 * scale);
  }
  // Centre dashes.
  ctx.fillStyle = '#e8c96a';
  for (const c of ROAD_LINES) {
    for (let d = -180; d < 184; d += 12) {
      if (ROAD_LINES.some((l) => Math.abs(d - l) < 13)) continue;
      ctx.fillRect(toPx(d), toPx(c) - 1, 6 * scale, 2);
      ctx.fillRect(toPx(c) - 1, toPx(d), 2, 6 * scale);
    }
  }
  // Crosswalks at intersections.
  ctx.fillStyle = '#d8d8d8';
  for (const ix of ROAD_LINES) {
    for (const iz of ROAD_LINES) {
      for (let s = -6; s <= 6; s += 3) {
        ctx.fillRect(toPx(ix + s - 1), toPx(iz - 13), 2, 4 * scale);
        ctx.fillRect(toPx(ix + s - 1), toPx(iz + 9), 2, 4 * scale);
        ctx.fillRect(toPx(ix - 13), toPx(iz + s - 1), 4 * scale, 2);
        ctx.fillRect(toPx(ix + 9), toPx(iz + s - 1), 4 * scale, 2);
      }
    }
  }
  // Boardwalk along the beach.
  ctx.fillStyle = '#9a6b46';
  ctx.fillRect(0, toPx(186), size, 7 * scale);
  ctx.strokeStyle = '#7c5334';
  for (let x = 0; x < size; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, toPx(186));
    ctx.lineTo(x, toPx(193));
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Merge simple geometries into one (for palm fronds): positions, normals and uvs only. */
function mergeGeometries(geometries) {
  let total = 0;
  const parts = geometries.map((g) => {
    const flat = g.index ? g.toNonIndexed() : g;
    total += flat.attributes.position.count;
    return flat;
  });
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let offset = 0;
  for (const part of parts) {
    position.set(part.attributes.position.array, offset * 3);
    normal.set(part.attributes.normal.array, offset * 3);
    uv.set(part.attributes.uv.array, offset * 2);
    offset += part.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}

/** One palm's fronds as a single geometry: six leaves fanned from the crown. */
function palmFrondGeometry() {
  const leaves = [];
  for (let i = 0; i < 6; i += 1) {
    const leaf = new THREE.PlaneGeometry(3.4, 1.1, 1, 1);
    leaf.translate(1.5, 0, 0);
    leaf.rotateX(-0.5);
    leaf.rotateY((i / 6) * Math.PI * 2);
    leaves.push(leaf);
  }
  return mergeGeometries(leaves);
}

/** The sunset sky dome, the sun and the city lights. */
export function buildEnvironment(scene) {
  const skyGeo = new THREE.SphereGeometry(880, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x2b1845) },
      midColor: { value: new THREE.Color(0xc94f6d) },
      botColor: { value: new THREE.Color(0xffab5e) },
      sunDir: { value: new THREE.Vector3(-0.62, 0.2, 0.35).normalize() },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor; uniform vec3 sunDir;',
      'varying vec3 vDir;',
      'void main() {',
      '  float h = clamp(vDir.y, -0.08, 1.0);',
      '  vec3 col = mix(botColor, midColor, smoothstep(0.0, 0.22, h));',
      '  col = mix(col, topColor, smoothstep(0.18, 0.65, h));',
      '  float sun = pow(max(dot(normalize(vDir), sunDir), 0.0), 18.0);',
      '  col += vec3(1.0, 0.62, 0.3) * sun * 0.85;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0xdd7f52, 160, 800);

  const hemi = new THREE.HemisphereLight(0xffc79a, 0x3a2b4d, 1.02);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffa04f, 2.05);
  sun.position.set(-170, 120, 95);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -215;
  sun.shadow.camera.right = 215;
  sun.shadow.camera.top = 215;
  sun.shadow.camera.bottom = -215;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x604a6e, 0.62));
}

/** Build the whole city into the scene; returns colliders and the animated bits. */
export function buildCity(scene, seed) {
  const rng = new Rng(seed);
  const colliders = [];
  const animated = { signs: [], boats: [], water: null };

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 560),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);

  // Sea.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 190),
    new THREE.MeshStandardMaterial({ color: 0x1d6f8e, roughness: 0.3, metalness: 0.15, transparent: true, opacity: 0.94 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.35, SHORE_Z + 95);
  scene.add(water);
  animated.water = water;

  // Buildings, block by block.
  const bases = ['#5a4a5e', '#6e5548', '#4a5568', '#715f6b', '#54655a', '#66503e'];
  const materials = bases.map((base) => {
    const tex = buildingTexture(rng, base, 0.42);
    return new THREE.MeshStandardMaterial({
      map: tex, emissive: 0xffca7a, emissiveMap: tex, emissiveIntensity: 0.5, roughness: 0.9,
    });
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2c2733, roughness: 1 });
  let signIndex = 0;
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      const distC = Math.hypot(bx, bz);
      const pattern = rng.int(0, 2);
      const plots = [];
      if (pattern === 0) plots.push({ dx: 0, dz: 0, w: 30, d: 30 });
      else if (pattern === 1) {
        plots.push({ dx: -10, dz: 0, w: 17, d: 32 });
        plots.push({ dx: 11, dz: 0, w: 15, d: 32 });
      } else {
        plots.push({ dx: -10, dz: -10, w: 16, d: 16 });
        plots.push({ dx: 10, dz: -10, w: 16, d: 16 });
        plots.push({ dx: -10, dz: 10, w: 16, d: 16 });
        plots.push({ dx: 10, dz: 10, w: 16, d: 16 });
      }
      for (const plot of plots) {
        if (pattern !== 0 && rng.chance(0.18)) continue; // an empty lot here and there
        const height = Math.round(rng.range(11, 20) + Math.max(0, 26 - distC * 0.11) * rng.range(0.5, 1.3));
        const geo = new THREE.BoxGeometry(plot.w, height, plot.d);
        const mat = materials[rng.int(0, materials.length - 1)];
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(bx + plot.dx, height / 2, bz + plot.dz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(plot.w + 0.7, 0.7, plot.d + 0.7), roofMat);
        roof.position.set(bx + plot.dx, height + 0.35, bz + plot.dz);
        scene.add(roof);
        colliders.push({
          minX: bx + plot.dx - plot.w / 2, maxX: bx + plot.dx + plot.w / 2,
          minZ: bz + plot.dz - plot.d / 2, maxZ: bz + plot.dz + plot.d / 2,
        });
        // A neon sign on some towers, facing the nearest road.
        if (height > 17 && rng.chance(0.5) && signIndex < SIGN_WORDS.length * 2) {
          const [word, color] = SIGN_WORDS[signIndex % SIGN_WORDS.length];
          signIndex += 1;
          const signMat = new THREE.MeshBasicMaterial({ map: signTexture(word, color), transparent: false });
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.1), signMat);
          const face = rng.int(0, 3);
          const y = height * rng.range(0.55, 0.8);
          if (face === 0) sign.position.set(bx + plot.dx, y, bz + plot.dz - plot.d / 2 - 0.06), sign.rotation.y = Math.PI;
          if (face === 1) sign.position.set(bx + plot.dx, y, bz + plot.dz + plot.d / 2 + 0.06);
          if (face === 2) sign.position.set(bx + plot.dx - plot.w / 2 - 0.06, y, bz + plot.dz), sign.rotation.y = -Math.PI / 2;
          if (face === 3) sign.position.set(bx + plot.dx + plot.w / 2 + 0.06, y, bz + plot.dz), sign.rotation.y = Math.PI / 2;
          scene.add(sign);
          animated.signs.push(signMat);
        }
      }
    }
  }

  // Landmark signs at street level: the bar, the clinic, the police station.
  const landmark = (place, word, color) => {
    const mat = new THREE.MeshBasicMaterial({ map: signTexture(word, color) });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), mat);
    sign.position.set(place.x, 3.4, place.z);
    sign.rotation.y = rng.range(0, Math.PI);
    scene.add(sign);
    animated.signs.push(mat);
  };
  landmark(PLACES.bar, 'BAR ONDINA', '#ffb347');
  landmark(PLACES.clinic, 'CLINICA DEL SOL', '#7ae0ff');
  landmark(PLACES.policeStation, 'POLICIA', '#7ae0ff');
  landmark(PLACES.hotel, 'HOTEL MARISOL', '#ff5e8a');

  // Palms: instanced trunks and fronds along the avenues and the beach.
  const palmSpots = [];
  for (const c of ROAD_LINES) {
    for (let d = -168; d <= 168; d += 26) {
      if (ROAD_LINES.some((l) => Math.abs(d - l) < 15)) continue;
      if (rng.chance(0.75)) palmSpots.push({ x: d + rng.range(-2, 2), z: c - 11.5 });
      if (rng.chance(0.75)) palmSpots.push({ x: c + 11.5, z: d + rng.range(-2, 2) });
    }
  }
  for (let x = -170; x <= 170; x += 17) {
    if (x > 96 && x < 134) continue; // keep the pier clear
    palmSpots.push({ x: x + rng.range(-3, 3), z: 190 + rng.range(0, 3) });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.24, 3.6, 6);
  trunkGeo.translate(0, 1.8, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5b3d, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const frondGeo = palmFrondGeometry();
  frondGeo.translate(0, 3.6, 0);
  const frondMat = new THREE.MeshStandardMaterial({
    map: palmLeafTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1,
  });
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, palmSpots.length);
  const dummy = new THREE.Object3D();
  palmSpots.forEach((spot, i) => {
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(rng.range(-0.06, 0.06), rng.range(0, Math.PI * 2), rng.range(-0.06, 0.06));
    const s = rng.range(0.85, 1.3);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    fronds.setMatrixAt(i, dummy.matrix);
  });
  trunks.castShadow = true;
  scene.add(trunks);
  scene.add(fronds);

  // Street lights: instanced poles with warm lamp heads.
  const lampSpots = [];
  for (const c of ROAD_LINES) {
    for (let d = -154; d <= 154; d += 28) {
      if (ROAD_LINES.some((l) => Math.abs(d - l) < 12)) continue;
      lampSpots.push({ x: d, z: c - 9.6 });
      lampSpots.push({ x: c + 9.6, z: d });
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 5.2, 5);
  poleGeo.translate(0, 2.6, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x2f3238, roughness: 0.8 }), lampSpots.length);
  const headGeo = new THREE.SphereGeometry(0.32, 8, 6);
  headGeo.translate(0, 5.25, 0);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), lampSpots.length);
  lampSpots.forEach((spot, i) => {
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    heads.setMatrixAt(i, dummy.matrix);
  });
  scene.add(poles);
  scene.add(heads);

  // The marina pier and two boats.
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x8a6748, roughness: 1 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(22, 0.7, 56), pierMat);
  deck.position.set(114, 0.45, 222);
  deck.castShadow = true;
  deck.receiveShadow = true;
  scene.add(deck);
  for (let pz = 198; pz <= 246; pz += 8) {
    for (const px of [105, 123]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 6), pierMat);
      post.position.set(px, -0.4, pz);
      scene.add(post);
    }
  }
  const boatColors = [0xf2f0eb, 0x3f8fbf];
  boatColors.forEach((color, i) => {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 9), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    hull.position.y = 0.4;
    boat.add(hull);
    const bow = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1.7, 2.6, 4), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    bow.rotation.y = Math.PI / 4;
    bow.rotation.x = Math.PI / 2;
    bow.position.set(0, 0.4, 5.4);
    boat.add(bow);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 3), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.7 }));
    cabin.position.set(0, 1.4, -0.6);
    boat.add(cabin);
    boat.position.set(96 + i * 34, 0, 232 - i * 14);
    boat.rotation.y = i * 0.5 - 0.2;
    scene.add(boat);
    animated.boats.push(boat);
  });

  // The shoreline is a wall for everything but the pier gap.
  colliders.push({ minX: -280, maxX: 102, minZ: SHORE_Z, maxZ: 280 });
  colliders.push({ minX: 126, maxX: 280, minZ: SHORE_Z, maxZ: 280 });
  colliders.push({ minX: -280, maxX: 280, minZ: 252, maxZ: 280 });

  return { colliders, animated };
}

/** Push a circle (x, z, radius) out of every building AABB; returns true on any hit. */
export function collideCircle(x, z, radius, colliders) {
  let hit = false;
  let outX = x;
  let outZ = z;
  for (const c of colliders) {
    const nearX = Math.max(c.minX, Math.min(outX, c.maxX));
    const nearZ = Math.max(c.minZ, Math.min(outZ, c.maxZ));
    let dx = outX - nearX;
    let dz = outZ - nearZ;
    let distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;
    hit = true;
    if (distSq < 1e-6) {
      // Centre inside the box: leave by the shallowest face.
      const left = outX - c.minX;
      const right = c.maxX - outX;
      const top = outZ - c.minZ;
      const bottom = c.maxZ - outZ;
      const min = Math.min(left, right, top, bottom);
      if (min === left) outX = c.minX - radius;
      else if (min === right) outX = c.maxX + radius;
      else if (min === top) outZ = c.minZ - radius;
      else outZ = c.maxZ + radius;
      continue;
    }
    const dist = Math.sqrt(distSq);
    dx /= dist;
    dz /= dist;
    outX = nearX + dx * radius;
    outZ = nearZ + dz * radius;
  }
  return { x: outX, z: outZ, hit };
}

/** Animate the living bits of the city: water, boats and one flickering sign. */
export function updateCity(city, t) {
  if (city.animated.water) city.animated.water.position.y = -0.35 + Math.sin(t * 0.7) * 0.06;
  city.animated.boats.forEach((boat, i) => {
    boat.position.y = Math.sin(t * 0.9 + i * 2.1) * 0.12;
    boat.rotation.z = Math.sin(t * 0.7 + i) * 0.02;
  });
  city.animated.signs.forEach((mat, i) => {
    if (i % 7 === 3) mat.color.setScalar(0.85 + 0.15 * Math.sin(t * 30 + i));
  });
}
