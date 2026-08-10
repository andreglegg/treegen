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
  // Fresh light birch green — appended; palette indices are public API.
  ['#a9c86a', '#79a04c', '#e8e08c'],
];

export const barkPalettes = [
  ['#8a5735', '#5c3924'],
  ['#a16a3e', '#73462a'],
  ['#6b5a47', '#44382d'],
  ['#b58254', '#7d5134'],
  ['#584434', '#31261d'],
  ['#73735e', '#48483d'],
  // Birch white bark — appended; palette indices are public API.
  ['#e8e4da', '#3a3733'],
  // Weathered grey-brown — dead wood bleached by sun and rain (snag preset).
  ['#8d8274', '#57504a'],
];

export const presets = {
  meadow: { species: 'round', seed: 4192, height: 6.2, trunkRadius: 0.42, branchCount: 9, branchSpread: 1.15, canopySize: 2.3, leafDensity: 30, leafShape: 0.66, leafStyle: 'clustered', leafSize: 1, leafVariation: 0.5, detail: 1, lean: 0.14, leafPalette: 0, barkPalette: 1 },
  orchard: { species: 'round', seed: 1327, height: 4.6, trunkRadius: 0.34, branchCount: 7, branchSpread: 1.3, canopySize: 2.1, leafDensity: 34, leafShape: 0.5, leafStyle: 'rounded', leafSize: 1.05, leafVariation: 0.4, detail: 0, lean: 0.08, leafPalette: 2, barkPalette: 0 },
  pine: { species: 'pine', seed: 7714, height: 7.8, trunkRadius: 0.32, branchCount: 12, branchSpread: 1.0, canopySize: 2.0, leafDensity: 34, leafShape: 0.8, leafStyle: 'needles', leafSize: 1, leafVariation: 0.5, detail: 1, lean: 0.06, leafPalette: 1, barkPalette: 4 },
  oak: { species: 'oak', seed: 3048, height: 6.4, trunkRadius: 0.58, branchCount: 11, branchSpread: 1.5, canopySize: 2.5, leafDensity: 44, leafShape: 0.42, leafStyle: 'angular', leafSize: 1.0, leafVariation: 0.6, detail: 1, lean: 0.1, leafPalette: 5, barkPalette: 4 },
  acacia: { species: 'acacia', seed: 6291, height: 7.0, trunkRadius: 0.4, branchCount: 8, branchSpread: 1.7, canopySize: 2.6, leafDensity: 30, leafShape: 0.3, leafStyle: 'clustered', leafSize: 1.15, leafVariation: 0.45, detail: 1, lean: 0.2, leafPalette: 6, barkPalette: 2 },
  willow: { species: 'willow', seed: 8174, height: 6.6, trunkRadius: 0.4, branchCount: 10, branchSpread: 1.4, canopySize: 2.3, leafDensity: 46, leafShape: 0.75, leafStyle: 'clustered', leafSize: 0.82, leafVariation: 0.6, detail: 1, lean: 0.12, leafPalette: 1, barkPalette: 5 },
  birch: { species: 'birch', seed: 5521, height: 7.5, trunkRadius: 0.24, branchCount: 9, branchSpread: 0.95, canopySize: 1.9, leafDensity: 26, leafShape: 0.55, leafStyle: 'clustered', leafSize: 0.8, leafVariation: 0.6, detail: 1, lean: 0.08, leafPalette: 8, barkPalette: 6 },
  poplar: { species: 'poplar', seed: 3390, height: 10.5, trunkRadius: 0.32, branchCount: 12, branchSpread: 0.6, canopySize: 2.6, leafDensity: 34, leafShape: 0.6, leafStyle: 'clustered', leafSize: 0.85, leafVariation: 0.4, detail: 1, lean: 0.03, leafPalette: 1, barkPalette: 2 },
  palm: { species: 'palm', seed: 7040, height: 8, trunkRadius: 0.3, branchCount: 10, branchSpread: 1.5, canopySize: 2.4, leafDensity: 20, leafShape: 0.5, leafStyle: 'flat', leafSize: 1.1, leafVariation: 0.35, detail: 1, lean: 0.32, leafPalette: 1, barkPalette: 1 },
  baobab: { species: 'baobab', seed: 6114, height: 9, trunkRadius: 1.15, branchCount: 8, branchSpread: 1.1, canopySize: 2.3, leafDensity: 14, leafShape: 0.45, leafStyle: 'clustered', leafSize: 0.85, leafVariation: 0.5, detail: 1, lean: 0.05, leafPalette: 0, barkPalette: 3 },
  // Age range. Allometry from the references: saplings run slender
  // (height/diameter 40+) with a narrow upswept crown covering most of the
  // stem; ancients go squat (H/D ~15) with a retrenched crown wider than
  // tall; giants keep a near-columnar shaft, a high bare trunk, buttress
  // flanges, and few but huge foliage masses.
  // Sliders state the FULL-GROWN size; age plays the tree back along its
  // growth curve. The sapling is literally a young meadow-class tree.
  sapling: { species: 'round', seed: 2451, age: 0.08, height: 6.5, trunkRadius: 0.34, branchCount: 6, branchSpread: 0.8, canopySize: 2.0, leafDensity: 18, leafShape: 0.7, leafStyle: 'clustered', leafSize: 0.9, leafVariation: 0.45, detail: 1, lean: 0.1, leafPalette: 1, barkPalette: 0 },
  ancient: { species: 'oak', seed: 9218, age: 1, height: 8.5, trunkRadius: 0.72, branchCount: 13, branchSpread: 1.8, canopySize: 3.4, leafDensity: 48, leafShape: 0.45, leafStyle: 'angular', leafSize: 1.05, leafVariation: 0.7, detail: 1, lean: 0.16, leafPalette: 5, barkPalette: 2 },
  giant: { species: 'pine', seed: 5107, age: 0.85, height: 42, trunkRadius: 1.25, branchCount: 14, branchSpread: 1.2, canopySize: 7, leafDensity: 36, leafShape: 0.7, leafStyle: 'needles', leafSize: 1.1, leafVariation: 0.45, detail: 1, lean: 0.03, leafPalette: 1, barkPalette: 4 },
  // Standing dead tree: bare (leafDensity 0 — winter mode), old, trunk snapped
  // at ~70% with a jagged shear (brokenTop), grey weathered bark. Age 0.9 also
  // earns it stag-head dead spikes, which suits a snag fine.
  snag: { species: 'round', seed: 4788, age: 0.9, height: 9.2, trunkRadius: 0.33, branchCount: 8, branchSpread: 1.35, canopySize: 2.6, leafDensity: 0, leafShape: 0.5, leafStyle: 'clustered', leafSize: 1, leafVariation: 0.5, detail: 1, lean: 0.1, brokenTop: true, leafPalette: 0, barkPalette: 7 },
};

export const defaultParams = { ...presets.meadow, age: 0.5 };

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
    age: +(0.15 + rand() * 0.75).toFixed(2),
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
// caps: true = both ends, 'end' = final ring only, false = open.
// radial: optional (t01, angle) => multiplier for non-circular cross-sections
// (buttress flanges); flat/toon shading hides the normal approximation.
function tubeGeometry(points, radii, sides, caps = true, radial = null) {
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
      const r = radii[i] * (radial ? radial(i / (n - 1), a) : 1);
      position.push(
        points[i].x + dir.x * r,
        points[i].y + dir.y * r,
        points[i].z + dir.z * r
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

  // Flat caps close the tube's ends. A branch's start ring is buried inside
  // its parent, so capping it buys nothing — but an open END ring is a hollow
  // shell wherever it outlives its cover: where a thick limb hands off to
  // thinner children, the leftover annulus reads as a severed branch floating
  // in air. Ends always get capped; starts only for the trunk.
  if (caps) {
    const last = n - 1;
    if (caps === true) {
      const capStart = position.length / 3;
      position.push(points[0].x, points[0].y, points[0].z);
      normalAttr.push(-tangents[0].x, -tangents[0].y, -tangents[0].z);
      uv.push(0.5, 0);
      for (let j = 0; j < sides; j += 1) {
        index.push(capStart, (j + 1) % sides, j);
      }
    }
    const capEnd = position.length / 3;
    position.push(points[last].x, points[last].y, points[last].z);
    normalAttr.push(tangents[last].x, tangents[last].y, tangents[last].z);
    uv.push(0.5, 1);
    for (let j = 0; j < sides; j += 1) {
      index.push(capEnd, last * sides + j, last * sides + ((j + 1) % sides));
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normalAttr, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(index);
  return geom;
}

// Subdivision is capped at one level for every style: a twice-subdivided
// icosahedron is a near-sphere, and smooth balloons are the opposite of the
// chunky faceted look this generator is for. Higher detail tiers spend their
// triangles on structure (accent blobs, root spurs, fluting) instead.
function leafGeometry(style, detail) {
  const d = clamp(detail, 0, 1);
  switch (style) {
    case 'angular':
      return new THREE.DodecahedronGeometry(1, 0);
    case 'rounded':
      return new THREE.SphereGeometry(1, 6 + d * 3, 4 + d * 2);
    case 'flat':
      return new THREE.IcosahedronGeometry(1, 0);
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

  // How leaf masses will be scaled — needed before the branch loop, because
  // whether a twig can be culled depends on the real shape of the mass that
  // hides it.
  const roundness = Number(s.leafShape);
  const wide = 1.25 - roundness * 0.3;
  const tall = 0.6 + roundness * 0.7;
  const flat = s.leafStyle === 'flat' ? 0.34 : 1;

  // Branches are meshed as CONTINUOUS PATHS, not per-segment tubes. Each
  // skeleton branch marked `cont` starts flush at its parent's last point, so
  // a parent and its continuation chain merge into one poly-line extruded as
  // a single tube — there is no junction to mis-align. Side shoots start a new
  // path, but their first point lies ON the parent's centerline, so their tube
  // begins strictly inside the parent and emerges through its flank. Between
  // the two rules, a branch that starts in open air cannot be constructed.
  const swallowed = (branch) => {
    const p = branch.points;
    const length = p[0].distanceTo(p[p.length - 1]);
    if (branch.leafRadius) return length < branch.leafRadius * 0.85; // conifer skirt
    if (branch.anchorRef) {
      const a = branch.anchorRef;
      const minHalf = a.radius * Math.min(wide * (a.width ?? 1), tall * (a.aspect ?? 1) * flat);
      return length < minHalf * 0.9;
    }
    return false;
  };

  // parent id -> its continuation branch
  const contOf = new Map();
  skel.branches.forEach((branch, id) => {
    branch.id = id;
    if (branch.cont && branch.parent >= 0) contOf.set(branch.parent, branch);
  });

  // Walk a continuation chain from `head`, concatenating centerline and radii
  // into (pts, radii). A culled terminal tail just ends the path early — its
  // leaf mass covers the last visible point by the cull's own criterion.
  const appendChain = (head, pts, radii) => {
    let cur = head;
    let first = true;
    while (cur) {
      const from = first ? 0 : 1;
      for (let i = from; i < cur.points.length; i += 1) {
        const u = i / (cur.points.length - 1);
        pts.push(cur.points[i]);
        radii.push(Math.max(0.01, cur.radius + (cur.endRadius - cur.radius) * u));
      }
      first = false;
      const next = contOf.get(cur.id);
      cur = next && !swallowed(next) ? next : null;
    }
  };

  const addBark = (name, pts, radii, sides, caps, mat, radial = null) => {
    const mesh = new THREE.Mesh(tubeGeometry(pts, radii, sides, caps, radial), mat);
    mesh.name = name;
    // Exact centerline for the diagnostics — bounding boxes misplace the
    // endpoints of bowed tubes.
    mesh.userData.axis = {
      a: pts[0].clone(),
      b: pts[pts.length - 1].clone(),
      radius: radii[0],
      points: pts.map((p) => p.clone()),
    };
    root.add(mesh);
  };

  // Trunk — one continuous tube from flared root THROUGH the fork: when the
  // species splits into leaders, the first leader is the trunk's continuation
  // and the whole chain up to the crown extrudes as a single piece. The old
  // separate trunk mesh ended in a cap at the fork, which read as a ledge.
  const trunkPts = skel.spine.map((p) => p.p);
  const trunkRadii = skel.spine.map((p) => p.r);
  const trunkHead = skel.branches.find((b) => b.trunkCont);

  // Buttress flanges: a star cross-section at the base that rounds out to
  // circular partway up. The spine fraction covered by the base shrinks when
  // leader chains are appended, so the fade is scaled to spine-local t.
  const spineFrac = skel.spine.length;
  const buttressFn = skel.buttress
    ? (t01, angle, totalRings) => {
        const spineT = t01 * (totalRings / spineFrac);
        const fade = Math.max(0, 1 - spineT / skel.buttress.fadeT);
        if (fade <= 0) return 1;
        const lobe = Math.max(0, Math.cos(angle * skel.buttress.lobes + skel.buttress.phase)) ** 3;
        return 1 + skel.buttress.amount * lobe * fade ** 1.5;
      }
    : null;
  // Giants deserve extra silhouette resolution at the base where the player
  // stands; +4 sides only when flanges exist.
  const trunkSideCount = skel.buttress ? trunkSides + 4 : trunkSides;

  // Bark fluting: shallow vertical lobes fading out partway up the trunk.
  // Hero detail and old trees get it — the organic irregularity that stops a
  // closeup trunk reading as a smooth pipe. Phase comes from the seed, not a
  // rand() draw, so it cannot shift the tree's other randomness.
  const treeAge = clamp(Number(s.age ?? 0.5), 0, 1);
  const fluteAmp = (detail === 2 ? 0.05 : 0) + (treeAge >= 0.8 ? 0.045 : 0);
  const fluteFn = fluteAmp > 0
    ? (() => {
        const lobes = Math.max(3, Math.floor(trunkSideCount / 2) - 1);
        const phase = ((Number(s.seed) % 97) / 97) * Math.PI * 2;
        return (t01, angle) =>
          1 + fluteAmp * Math.cos(angle * lobes + phase) * Math.max(0, 1 - t01 / 0.7);
      })()
    : null;

  const composeRadial = (ringCount) => {
    if (!buttressFn && !fluteFn) return null;
    return (t, a) =>
      (buttressFn ? buttressFn(t, a, ringCount) : 1) * (fluteFn ? fluteFn(t, a) : 1);
  };

  if (trunkHead) {
    // The leader's first point coincides with the spine's last — skip it.
    const pts = trunkPts.slice(0, -1);
    const radii = trunkRadii.slice(0, -1);
    appendChain(trunkHead, pts, radii);
    addBark('trunk_segment', pts, radii, trunkSideCount, true, barkMat, composeRadial(pts.length));
  } else {
    addBark('trunk_segment', trunkPts, trunkRadii, trunkSideCount, true, barkMat, composeRadial(trunkPts.length));
  }

  let branchIndex = 0;
  let deadIndex = 0;
  for (const head of skel.branches) {
    if (head.cont || head.trunkCont) continue; // absorbed into another path
    if (swallowed(head) && !contOf.has(head.id)) continue; // lone hidden twig

    const pts = [];
    const radii = [];
    appendChain(head, pts, radii);

    // Leaders are trunk, structurally and visually — trunk resolution. Other
    // paths get sides by the depth they start at.
    const sides = head.leader ? trunkSides : Math.max(3, trunkSides - 2 - head.depth * 2);
    // Stag-head deadwood gets its own name prefix so the diagnostics can tell
    // deliberate dead spikes (which END in open air) from broken branches —
    // and the shadow bark tone, because dead wood is darker than live bark.
    const name = head.dead ? `dead_branch_${deadIndex}` : `branch_segment_${branchIndex}`;
    addBark(
      name,
      pts,
      radii,
      sides,
      'end',
      head.dead || head.depth >= 2 ? barkAltMat : barkMat
    );
    if (head.dead) deadIndex += 1;
    else branchIndex += 1;
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

  // A strand's shape comes from how far it is stretched, not from how finely
  // it is subdivided, so curtain species buy their density back by dropping a
  // subdivision level. Many fine strands read as a curtain; few fat ones read
  // as a bunch of pods.
  const blob = leafGeometry(s.leafStyle, skel.profile.curtain ? Math.max(0, detail - 1) : detail);
  const skirt = skel.anchors.some((a) => a.skirt)
    ? new THREE.ConeGeometry(1, 1, trunkSides + 2, 1)
    : null;

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

    if (anchor.frond) {
      // Palm frond: one elongated, drooping flat blade. Local X is the
      // frond's length axis; Euler order XYZ applies the Z pitch first (the
      // droop, about the blade's own axis) then the Y yaw out to its azimuth,
      // which is exactly the skeleton's `dir`.
      const mesh = new THREE.Mesh(blob, toneFor(anchor.exposure));
      mesh.name = `leaf_cluster_${i}`;
      mesh.position.copy(anchor.p);
      mesh.scale.set(anchor.radius, anchor.radius * 0.16, anchor.radius * 0.34);
      mesh.rotation.set(0, anchor.spin, -anchor.tilt);
      root.add(mesh);
      return;
    }

    const mesh = new THREE.Mesh(blob, toneFor(anchor.exposure));
    mesh.name = `leaf_cluster_${i}`;
    mesh.position.copy(anchor.p);
    const narrow = anchor.width ?? 1;
    mesh.scale.set(
      anchor.radius * wide * narrow,
      anchor.radius * tall * anchor.aspect * flat,
      anchor.radius * wide * 0.94 * narrow
    );
    mesh.rotation.set(anchor.tilt, anchor.spin, anchor.tilt * 0.6);
    root.add(mesh);
  });

  // Accent blobs: smaller secondary masses lapped over the big ones so the
  // crown surface reads as clumped foliage rather than a bag of balloons.
  // Deterministic from each anchor's own randomness (spin/tilt) — no extra
  // RNG draw, so seeds keep reproducing byte-identical trees. Offset stays
  // within 0.6 R of the anchor so every accent remains attached to the same
  // branch its parent mass sits on.
  if (detail >= 1) {
    const centre = skel.crown.centre;
    const frac = detail === 2 ? 0.9 : 0.45;
    // One subdivision below the main masses: chunkier, and a quarter the tris.
    const accentBlob = leafGeometry(s.leafStyle, detail - 1);
    let accentIndex = anchors.length;
    anchors.forEach((anchor) => {
      if (anchor.skirt || anchor.frond || (anchor.width ?? 1) < 1) return; // not on strands/fronds
      const pick = (Math.sin(anchor.spin * 12.9898) + 1) / 2; // hash of existing noise
      if (pick > frac) return;

      const out = new THREE.Vector3().subVectors(anchor.p, centre);
      out.y = Math.abs(out.y) * 0.6; // bias accents to the upper, visible side
      if (out.lengthSq() < 1e-6) out.set(1, 0.5, 0);
      out.normalize();
      // Swing the offset around the outward direction by the anchor's spin so
      // accents don't all sit at the same latitude.
      const swing = new THREE.Vector3(Math.cos(anchor.spin), 0, Math.sin(anchor.spin));
      const dir = out.clone().multiplyScalar(0.75).addScaledVector(swing, 0.45).normalize();

      const r = anchor.radius * (0.42 + pick * 0.2);
      const mesh = new THREE.Mesh(accentBlob, toneFor(anchor.exposure + 0.08));
      mesh.name = `leaf_cluster_${accentIndex}`;
      accentIndex += 1;
      mesh.position.copy(anchor.p).addScaledVector(dir, anchor.radius * 0.58);
      mesh.scale.set(r * wide, r * tall * flat, r * wide * 0.94);
      mesh.rotation.set(anchor.tilt * 1.4, anchor.spin * 1.7, anchor.tilt);
      root.add(mesh);
    });
  }

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
