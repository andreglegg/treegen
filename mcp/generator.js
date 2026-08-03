// Headless tree generator — a DOM/WebGL-free port of the geometry math in
// ../src/main.js. Given a params object it returns a THREE.Group of named
// meshes with plain MeshStandardMaterials, ready for GLTF/OBJ export in Node.
import * as THREE from 'three';

export const leafPalettes = [
  ['#7faa52', '#4f7f43', '#d7b447'],
  ['#5f9d65', '#2f6e4f', '#9dc967'],
  ['#d77d42', '#b24d34', '#e1b64d'],
  ['#84a8d7', '#537eb3', '#d9eef4'],
  ['#be6f8b', '#7f4f88', '#ead1db'],
  ['#96a64f', '#596f35', '#e2d77d'],
  ['#4b8d88', '#28605c', '#9fcbc2'],
  ['#ba5360', '#742f43', '#eea07e'],
];

export const barkPalettes = [
  ['#8a5735', '#5c3924'],
  ['#a16a3e', '#73462a'],
  ['#6b5a47', '#44382d'],
  ['#b58254', '#7d5134'],
  ['#584434', '#31261d'],
  ['#73735e', '#48483d'],
];

export const presets = {
  meadow: { species: 'round', seed: 4192, height: 6.2, trunkRadius: 0.45, branchCount: 11, branchSpread: 1.25, canopySize: 2.35, leafDensity: 34, leafShape: 0.66, leafStyle: 'clustered', leafSize: 1, leafVariation: 0.55, detail: 1, lean: 0.18, leafPalette: 0, barkPalette: 1 },
  orchard: { species: 'round', seed: 1327, height: 4.9, trunkRadius: 0.38, branchCount: 8, branchSpread: 1.65, canopySize: 2.65, leafDensity: 42, leafShape: 0.35, leafStyle: 'rounded', leafSize: 1.1, leafVariation: 0.4, detail: 0, lean: 0.08, leafPalette: 2, barkPalette: 0 },
  pine: { species: 'pine', seed: 7714, height: 7.8, trunkRadius: 0.34, branchCount: 12, branchSpread: 0.88, canopySize: 2.15, leafDensity: 28, leafShape: 0.8, leafStyle: 'needles', leafSize: 1, leafVariation: 0.6, detail: 1, lean: 0.12, leafPalette: 1, barkPalette: 4 },
  oak: { species: 'oak', seed: 3048, height: 6.7, trunkRadius: 0.6, branchCount: 15, branchSpread: 1.75, canopySize: 2.8, leafDensity: 46, leafShape: 0.4, leafStyle: 'angular', leafSize: 0.92, leafVariation: 0.72, detail: 1, lean: 0.1, leafPalette: 5, barkPalette: 4 },
  acacia: { species: 'acacia', seed: 6291, height: 6.8, trunkRadius: 0.42, branchCount: 10, branchSpread: 2.05, canopySize: 3.05, leafDensity: 38, leafShape: 0.24, leafStyle: 'flat', leafSize: 1.2, leafVariation: 0.5, detail: 1, lean: 0.24, leafPalette: 6, barkPalette: 2 },
  willow: { species: 'willow', seed: 8174, height: 6.1, trunkRadius: 0.4, branchCount: 12, branchSpread: 1.8, canopySize: 2.55, leafDensity: 52, leafShape: 0.8, leafStyle: 'flat', leafSize: 0.85, leafVariation: 0.65, detail: 1, lean: 0.16, leafPalette: 1, barkPalette: 5 },
};

export const defaultParams = { ...presets.meadow };

// Deterministic Lehmer RNG — identical to the browser app so a seed reproduces
// the same tree in either place.
export function rng(seed) {
  let value = Number(seed) % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export function randomParams(seed) {
  const rand = rng(seed);
  return {
    seed: Math.floor(rand() * 999999) + 1,
    height: +(4.2 + rand() * 4.6).toFixed(1),
    branchCount: Math.floor(6 + rand() * 11),
    branchSpread: +(0.7 + rand() * 1.25).toFixed(2),
    canopySize: +(1.3 + rand() * 1.9).toFixed(2),
    leafDensity: Math.floor(18 + rand() * 42),
    leafShape: +(0.25 + rand() * 0.7).toFixed(2),
    leafSize: +(0.65 + rand() * 0.7).toFixed(2),
    leafVariation: +(rand() * 0.9).toFixed(2),
    lean: +(rand() * 0.4).toFixed(2),
  };
}

function material(name, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0 });
  mat.name = name;
  return mat;
}

function addTrunkSegment(parent, start, end, r0, r1, mat, sides) {
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const length = start.distanceTo(end);
  const geom = new THREE.CylinderGeometry(r1, r0, length, sides, 1, false);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'trunk_segment';
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3().subVectors(end, start).normalize()
  );
  parent.add(mesh);
  return mesh;
}

function addLeafBlob(parent, s, position, scale, mat, rand, index) {
  const detail = Math.max(0, Math.min(2, s.detail));
  const geometryByStyle = {
    clustered: () => new THREE.IcosahedronGeometry(1, detail),
    angular: () => new THREE.DodecahedronGeometry(1, detail),
    rounded: () => new THREE.SphereGeometry(1, 8 + detail * 4, 5 + detail * 2),
    flat: () => new THREE.IcosahedronGeometry(1, Math.max(0, detail - 1)),
    needles: () => new THREE.ConeGeometry(1, 1.7, 5 + detail * 2, 1),
  };
  const geom = (geometryByStyle[s.leafStyle] ?? geometryByStyle.clustered)();
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = `leaf_cluster_${index}`;
  mesh.position.copy(position);
  mesh.scale.set(scale.x, s.leafStyle === 'flat' ? scale.y * 0.32 : scale.y, scale.z);
  mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
  parent.add(mesh);
}

function addPineLayer(parent, y, radius, height, mat, sides, rand, index) {
  const geom = new THREE.ConeGeometry(radius, height, sides, 1, false);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = `pine_bough_layer_${index}`;
  mesh.position.set((rand() - 0.5) * 0.16, y, (rand() - 0.5) * 0.16);
  mesh.rotation.y = rand() * Math.PI;
  mesh.scale.x = 1 + (rand() - 0.5) * 0.18;
  mesh.scale.z = 1 + (rand() - 0.5) * 0.18;
  parent.add(mesh);
}

function buildBroadleaf(root, s, rand, sides, leafMats, barkMat) {
  const profiles = {
    round: { canopyY: 0.86, width: 1, vertical: 0.9, branchBase: 0.43, branchRange: 0.42, rise: 0.55 },
    oak: { canopyY: 0.76, width: 1.25, vertical: 0.72, branchBase: 0.34, branchRange: 0.43, rise: 0.28 },
    acacia: { canopyY: 0.83, width: 1.42, vertical: 0.33, branchBase: 0.55, branchRange: 0.24, rise: 0.12 },
    willow: { canopyY: 0.76, width: 1.12, vertical: 1.15, branchBase: 0.4, branchRange: 0.32, rise: -0.12 },
  };
  const profile = profiles[s.species] ?? profiles.round;
  const canopyCenter = new THREE.Vector3(s.lean * 1.25, s.height * profile.canopyY, 0);
  const branches = Number(s.branchCount);
  for (let i = 0; i < branches; i += 1) {
    const t = branches === 1 ? 0 : i / (branches - 1);
    const angle = t * Math.PI * 2 + rand() * 0.4;
    const y = s.height * (profile.branchBase + rand() * profile.branchRange);
    const len = s.branchSpread * profile.width * (1.05 + rand() * 0.8);
    const start = new THREE.Vector3(s.lean * (y / s.height), y, 0);
    const rise = profile.rise + rand() * (s.species === 'willow' ? 0.3 : 0.8);
    const end = start.clone().add(new THREE.Vector3(Math.cos(angle) * len, rise, Math.sin(angle) * len));
    addTrunkSegment(root, start, end, s.trunkRadius * 0.2, s.trunkRadius * 0.06, barkMat, sides);
  }

  const count = Number(s.leafDensity);
  for (let i = 0; i < count; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * s.canopySize * profile.width;
    const vertical = (rand() - 0.42) * s.canopySize * profile.vertical;
    const position = canopyCenter.clone().add(new THREE.Vector3(Math.cos(angle) * radius, vertical, Math.sin(angle) * radius * 0.92));
    if (s.species === 'willow') position.y -= Math.max(0, radius - s.canopySize * 0.45) * 0.45;
    const variation = Number(s.leafVariation);
    const lump = (0.48 + rand() * 0.36 * variation) * Number(s.leafSize);
    const roundness = Number(s.leafShape);
    const scale = new THREE.Vector3(
      lump * (1.25 - roundness * 0.28),
      lump * (0.55 + roundness * 0.8) * (0.9 + rand() * variation * 0.25),
      lump * (1.15 - roundness * 0.18)
    );
    addLeafBlob(root, s, position, scale, leafMats[i % leafMats.length], rand, i + 1);
  }
}

function buildPine(root, s, rand, sides, leafMats, barkMat) {
  const layers = Math.max(6, Math.round(s.leafDensity / 3));
  for (let i = 0; i < Number(s.branchCount); i += 1) {
    const y = s.height * (0.22 + rand() * 0.62);
    const angle = rand() * Math.PI * 2;
    const len = s.branchSpread * (1.25 - y / s.height) * 1.9;
    const start = new THREE.Vector3(s.lean * (y / s.height), y, 0);
    const end = start.clone().add(new THREE.Vector3(Math.cos(angle) * len, -0.14 + rand() * 0.28, Math.sin(angle) * len));
    addTrunkSegment(root, start, end, s.trunkRadius * 0.14, s.trunkRadius * 0.035, barkMat, sides);
  }
  for (let i = 0; i < layers; i += 1) {
    const t = i / Math.max(1, layers - 1);
    const y = s.height * (0.28 + t * 0.68);
    const variation = 1 + (rand() - 0.5) * Number(s.leafVariation) * 0.26;
    const radius = s.canopySize * (1.08 - t * 0.86) * s.branchSpread * Number(s.leafSize) * variation;
    const h = s.height * (0.2 - t * 0.08) * (0.75 + s.leafShape * 0.55);
    addPineLayer(root, y, radius, h, leafMats[i % leafMats.length], sides + 2, rand, i + 1);
  }
}

// Build and return a THREE.Group for the given params (merged over defaults).
export function buildTree(params = {}) {
  const s = { ...defaultParams, ...params };
  const root = new THREE.Group();
  root.name = 'Treegen_asset';

  const rand = rng(Number(s.seed));
  const sides = [6, 8, 12][Number(s.detail)] ?? 8;
  const [barkBase, barkDark] = barkPalettes[s.barkPalette] ?? barkPalettes[0];
  const [leafBase, leafDark, leafLight] = leafPalettes[s.leafPalette] ?? leafPalettes[0];
  const barkMat = material('bark_toon', barkBase);
  const barkAltMat = material('bark_shadow', barkDark);
  const leafMats = [
    material('leaves_base', leafBase),
    material('leaves_shadow', leafDark),
    material('leaves_highlight', leafLight),
  ];

  const top = new THREE.Vector3(s.lean, s.height, s.lean * 0.45);
  addTrunkSegment(root, new THREE.Vector3(0, 0, 0), top, s.trunkRadius, s.trunkRadius * 0.34, barkMat, sides);
  addTrunkSegment(
    root,
    new THREE.Vector3(0.05, s.height * 0.08, -0.04),
    new THREE.Vector3(-0.03, s.height * 0.86, 0.03),
    s.trunkRadius * 0.58,
    s.trunkRadius * 0.18,
    barkAltMat,
    sides
  );

  if (s.species === 'pine') buildPine(root, s, rand, sides, leafMats, barkMat);
  else buildBroadleaf(root, s, rand, sides, leafMats, barkMat);

  return root;
}

// Count meshes/triangles for reporting, matching the app's viewport metrics.
export function meshStats(group) {
  let meshes = 0;
  let triangles = 0;
  group.traverse((child) => {
    if (!child.isMesh) return;
    meshes += 1;
    const indexCount = child.geometry.index?.count ?? child.geometry.attributes.position.count;
    triangles += Math.round(indexCount / 3);
  });
  return { meshes, triangles };
}
