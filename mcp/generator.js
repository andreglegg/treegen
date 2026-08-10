// Headless tree generator. Turns the structural skeleton (see skeleton.js)
// into a THREE.Group of named meshes with plain MeshStandardMaterials, ready
// for GLTF/OBJ export in Node or for re-materialising in the browser app.
//
// Public API — buildTree, meshStats, presets, defaultParams, randomParams, rng,
// leafPalettes, barkPalettes — is unchanged from earlier versions, as are the
// mesh names, so downstream importers keep working.
import * as THREE from 'three';
import { buildSkeleton, rng } from './skeleton.js';

export { rng };
export { buildSkeleton, SPECIES_PROFILES } from './skeleton.js';

// Three tones per palette: base, shadow, highlight. They are assigned by where
// a leaf mass sits relative to the sun, not by index, so they read as lighting.
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
  meadow: { species: 'round', seed: 4192, height: 6.2, trunkRadius: 0.42, branchCount: 9, branchSpread: 1.15, canopySize: 2.3, leafDensity: 30, leafShape: 0.66, leafStyle: 'clustered', leafSize: 1, leafVariation: 0.5, detail: 1, lean: 0.14, leafPalette: 0, barkPalette: 1 },
  orchard: { species: 'round', seed: 1327, height: 4.6, trunkRadius: 0.34, branchCount: 7, branchSpread: 1.3, canopySize: 2.1, leafDensity: 34, leafShape: 0.5, leafStyle: 'rounded', leafSize: 1.05, leafVariation: 0.4, detail: 0, lean: 0.08, leafPalette: 2, barkPalette: 0 },
  pine: { species: 'pine', seed: 7714, height: 7.8, trunkRadius: 0.32, branchCount: 12, branchSpread: 1.0, canopySize: 2.0, leafDensity: 34, leafShape: 0.8, leafStyle: 'needles', leafSize: 1, leafVariation: 0.5, detail: 1, lean: 0.06, leafPalette: 1, barkPalette: 4 },
  oak: { species: 'oak', seed: 3048, height: 6.4, trunkRadius: 0.58, branchCount: 11, branchSpread: 1.5, canopySize: 2.5, leafDensity: 38, leafShape: 0.42, leafStyle: 'angular', leafSize: 1.0, leafVariation: 0.6, detail: 1, lean: 0.1, leafPalette: 5, barkPalette: 4 },
  acacia: { species: 'acacia', seed: 6291, height: 7.0, trunkRadius: 0.4, branchCount: 8, branchSpread: 1.7, canopySize: 2.6, leafDensity: 30, leafShape: 0.3, leafStyle: 'clustered', leafSize: 1.15, leafVariation: 0.45, detail: 1, lean: 0.2, leafPalette: 6, barkPalette: 2 },
  willow: { species: 'willow', seed: 8174, height: 6.6, trunkRadius: 0.4, branchCount: 10, branchSpread: 1.35, canopySize: 2.2, leafDensity: 34, leafShape: 0.75, leafStyle: 'clustered', leafSize: 0.9, leafVariation: 0.6, detail: 1, lean: 0.12, leafPalette: 1, barkPalette: 5 },
};

export const defaultParams = { ...presets.meadow };

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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Sweep a ring along a poly-line to produce one continuous tapered tube.
 *
 * Frames are carried along the curve by parallel transport — each ring is the
 * previous one rotated by the change in tangent — so the tube never twists,
 * and the trunk becomes a single smooth piece instead of stacked cylinders
 * with visible seams at every joint.
 */
function tubeGeometry(points, radii, sides, caps = true) {
  const n = points.length;
  const tangents = [];
  for (let i = 0; i < n; i += 1) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a);
    tangents.push(t.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : t.normalize());
  }

  // Any vector not parallel to the first tangent will do as a seed.
  const seed = Math.abs(tangents[0].y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  let normal = new THREE.Vector3().crossVectors(tangents[0], seed).normalize();

  const position = [];
  const normalAttr = [];
  const uv = [];
  const index = [];

  for (let i = 0; i < n; i += 1) {
    if (i > 0) {
      normal.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(tangents[i - 1], tangents[i]));
      // Re-orthogonalise against drift from accumulated rotations.
      normal.addScaledVector(tangents[i], -normal.dot(tangents[i]));
      if (normal.lengthSq() < 1e-12) normal.crossVectors(tangents[i], seed);
      normal.normalize();
    }
    const binormal = new THREE.Vector3().crossVectors(tangents[i], normal).normalize();
    for (let j = 0; j < sides; j += 1) {
      const a = (j / sides) * Math.PI * 2;
      const dir = normal.clone().multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a));
      position.push(
        points[i].x + dir.x * radii[i],
        points[i].y + dir.y * radii[i],
        points[i].z + dir.z * radii[i]
      );
      normalAttr.push(dir.x, dir.y, dir.z);
      uv.push(j / sides, i / (n - 1));
    }
  }

  for (let i = 0; i < n - 1; i += 1) {
    for (let j = 0; j < sides; j += 1) {
      const j2 = (j + 1) % sides;
      const a = i * sides + j;
      const b = i * sides + j2;
      const c = (i + 1) * sides + j;
      const d = (i + 1) * sides + j2;
      index.push(a, b, c, b, d, c);
    }
  }

  // Flat caps close the tube for export. Branches skip them: both ends are
  // buried, in the parent limb below and in a leaf mass above.
  if (caps) {
    const last = n - 1;
    const capStart = position.length / 3;
    position.push(points[0].x, points[0].y, points[0].z);
    normalAttr.push(-tangents[0].x, -tangents[0].y, -tangents[0].z);
    uv.push(0.5, 0);
    const capEnd = position.length / 3;
    position.push(points[last].x, points[last].y, points[last].z);
    normalAttr.push(tangents[last].x, tangents[last].y, tangents[last].z);
    uv.push(0.5, 1);

    for (let j = 0; j < sides; j += 1) {
      const j2 = (j + 1) % sides;
      index.push(capStart, j2, j);
      index.push(capEnd, last * sides + j, last * sides + j2);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normalAttr, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(index);
  return geom;
}

function leafGeometry(style, detail) {
  const d = clamp(detail, 0, 2);
  switch (style) {
    case 'angular':
      return new THREE.DodecahedronGeometry(1, Math.max(0, d - 1));
    case 'rounded':
      return new THREE.SphereGeometry(1, 6 + d * 3, 4 + d * 2);
    case 'flat':
      return new THREE.IcosahedronGeometry(1, Math.max(0, d - 1));
    case 'needles':
      return new THREE.ConeGeometry(1, 1.8, 5 + d * 2, 1);
    case 'clustered':
    default:
      return new THREE.IcosahedronGeometry(1, d);
  }
}

/**
 * Leaf masses that are completely swallowed by a neighbour contribute nothing
 * but triangles. Cheap O(n^2) containment test; n is at most 64.
 */
function cullEnclosed(anchors) {
  const keep = new Array(anchors.length).fill(true);
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = 0; j < anchors.length; j += 1) {
      if (i === j || !keep[i] || !keep[j]) continue;
      if (anchors[j].radius <= anchors[i].radius) continue;
      if (anchors[i].p.distanceTo(anchors[j].p) + anchors[i].radius <= anchors[j].radius * 0.96) {
        keep[i] = false;
      }
    }
  }
  return anchors.filter((_, i) => keep[i]);
}

/** Build and return a THREE.Group for the given params (merged over defaults). */
export function buildTree(params = {}) {
  const s = { ...defaultParams, ...params };
  const skel = buildSkeleton(s);
  const root = new THREE.Group();
  root.name = 'Treegen_asset';

  const detail = clamp(Number(s.detail), 0, 2);
  const trunkSides = [5, 7, 10][detail];
  const [barkBase, barkDark] = barkPalettes[s.barkPalette] ?? barkPalettes[0];
  const [leafBase, leafDark, leafLight] = leafPalettes[s.leafPalette] ?? leafPalettes[0];

  const barkMat = material('bark_toon', barkBase);
  const barkAltMat = material('bark_shadow', barkDark);
  const leafMats = {
    base: material('leaves_base', leafBase),
    shadow: material('leaves_shadow', leafDark),
    highlight: material('leaves_highlight', leafLight),
  };

  // Trunk — one continuous swept tube from flared root to tip.
  const trunk = new THREE.Mesh(
    tubeGeometry(skel.spine.map((p) => p.p), skel.spine.map((p) => p.r), trunkSides),
    barkMat
  );
  trunk.name = 'trunk_segment';
  root.add(trunk);

  // Branches. Twigs get fewer sides, and any branch entirely hidden inside its
  // own leaf mass is skipped outright.
  let branchIndex = 0;
  for (const branch of skel.branches) {
    if (branch.leafRadius) {
      const p = branch.points;
      const length = p[0].distanceTo(p[p.length - 1]);
      if (length < branch.leafRadius * 0.85) continue;
    }
    const sides = Math.max(3, trunkSides - 2 - branch.depth * 2);
    const radii = branch.points.map((_, i) => {
      const u = i / (branch.points.length - 1);
      return Math.max(0.01, branch.radius + (branch.endRadius - branch.radius) * u);
    });
    const mesh = new THREE.Mesh(
      tubeGeometry(branch.points, radii, sides, false),
      branch.depth >= 2 ? barkAltMat : barkMat
    );
    mesh.name = `branch_segment_${branchIndex}`;
    branchIndex += 1;
    root.add(mesh);
  }

  // Foliage. One geometry instance shared by every mass of the same style;
  // per-mass differences ride on the mesh transform.
  const anchors = cullEnclosed(skel.anchors);

  // Assign the three leaf tones by rank, not by an absolute threshold. A fixed
  // cutoff floods whichever species happens to sit high in the light; ranking
  // keeps the base tone dominant and the accents readable as highlight and
  // shade on every species and at every parameter setting.
  const ranked = [...anchors].sort((a, b) => a.exposure - b.exposure);
  const at = (frac) => ranked[clamp(Math.floor(ranked.length * frac), 0, ranked.length - 1)]?.exposure;
  const shadowCut = ranked.length > 3 ? at(0.26) : -Infinity;
  const highlightCut = ranked.length > 3 ? at(0.84) : Infinity;
  const toneFor = (exposure) =>
    exposure >= highlightCut ? leafMats.highlight : exposure <= shadowCut ? leafMats.shadow : leafMats.base;

  const blob = leafGeometry(s.leafStyle, detail);
  const skirt = skel.anchors.some((a) => a.skirt)
    ? new THREE.ConeGeometry(1, 1, trunkSides + 2, 1)
    : null;

  const roundness = Number(s.leafShape);
  const wide = 1.25 - roundness * 0.3;
  const tall = 0.6 + roundness * 0.7;

  anchors.forEach((anchor, i) => {
    if (anchor.skirt) {
      const mesh = new THREE.Mesh(skirt, toneFor(anchor.exposure));
      mesh.name = `pine_bough_layer_${i}`;
      mesh.position.copy(anchor.p);
      mesh.scale.set(anchor.radius, anchor.height, anchor.radius);
      mesh.rotation.y = anchor.spin;
      root.add(mesh);
      return;
    }

    const mesh = new THREE.Mesh(blob, toneFor(anchor.exposure));
    mesh.name = `leaf_cluster_${i}`;
    mesh.position.copy(anchor.p);
    const flat = s.leafStyle === 'flat' ? 0.34 : 1;
    mesh.scale.set(
      anchor.radius * wide,
      anchor.radius * tall * anchor.aspect * flat,
      anchor.radius * wide * 0.94
    );
    mesh.rotation.set(anchor.tilt, anchor.spin, anchor.tilt * 0.6);
    root.add(mesh);
  });

  return root;
}

/** Count meshes/triangles for reporting, matching the app's viewport metrics. */
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
