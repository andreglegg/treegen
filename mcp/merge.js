// Game-ready mesh consolidation. A generated tree is ~25-120 small meshes
// (one draw call each in-engine). mergeTree() bakes every mesh's world
// transform and material color into at most TWO vertex-colored meshes —
// "bark" and "foliage" — so a whole tree renders in 2 draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const FOLIAGE_PREFIXES = ['leaf_cluster_', 'pine_bough_layer_'];

// Bark vs foliage is decided by the generator's stable mesh-name prefixes
// (trunk_segment / branch_segment_* are bark; leaf_cluster_* /
// pine_bough_layer_* are foliage). Unknown names fall back to the material
// name so third-party additions still land in a sensible bucket.
function isFoliage(mesh) {
  if (FOLIAGE_PREFIXES.some((p) => mesh.name.startsWith(p))) return true;
  if (mesh.name.startsWith('trunk_segment') || mesh.name.startsWith('branch_segment_')) return false;
  return (mesh.material?.name ?? '').startsWith('leaves');
}

/**
 * Wind data, written to the second UV set as (stiffness, phase).
 *
 * A vegetation shader needs to know how freely each vertex may sway: the
 * trunk foot is bolted to the ground, the outer leaves whip. That weight goes
 * in TEXCOORD_1.x, and a per-mesh phase offset in .y stops every leaf mass
 * swaying in lockstep. UV1 rather than the colour's alpha channel because
 * glTF multiplies COLOR_0 alpha into base opacity — a wind mask there would
 * render the tree semi-transparent in any compliant viewer.
 *
 * Bark rises steeply from a dead-rigid foot and stiffens the closer a vertex
 * sits to the stem; foliage rides a floor, because leaves move even on the
 * inner canopy — a leaf mass frozen against a swaying limb is the tell.
 */
function windAttribute(geom, { foliage, minY, spanY, maxRadius, phase }) {
  const pos = geom.attributes.position;
  const data = new Float32Array(pos.count * 2);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  for (let i = 0; i < pos.count; i += 1) {
    const heightFrac = clamp01((pos.getY(i) - minY) / spanY);
    const radialFrac = clamp01(Math.hypot(pos.getX(i), pos.getZ(i)) / maxRadius);
    const w = foliage
      ? 0.5 + 0.5 * clamp01(0.5 * heightFrac ** 1.3 + 0.5 * radialFrac)
      : heightFrac ** 1.7 * (0.55 + 0.45 * radialFrac);
    data[i * 2] = clamp01(w);
    data[i * 2 + 1] = phase;
  }
  geom.setAttribute('uv1', new THREE.BufferAttribute(data, 2));
}

// Clone a mesh's geometry with the world transform baked in and a per-vertex
// COLOR attribute filled with the mesh's material color (linear-sRGB, which is
// what glTF expects for COLOR_0).
function bakedGeometry(mesh) {
  let geom = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  geom.applyMatrix4(mesh.matrixWorld);
  const count = geom.attributes.position.count;
  const color = mesh.material?.color ?? new THREE.Color(1, 1, 1);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // mergeGeometries requires identical attribute sets across inputs; keep
  // position/normal/uv/color/uv1 (the wind mask) and drop anything exotic.
  for (const name of Object.keys(geom.attributes)) {
    if (!['position', 'normal', 'uv', 'color', 'uv1'].includes(name)) geom.deleteAttribute(name);
  }
  return geom;
}

// Deterministic 0..1 phase per mesh name — no rand() draw, so adding wind data
// cannot shift any tree's randomness.
function phaseOf(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

// Merge a buildTree() group into a Group holding at most two meshes named
// "bark" and "foliage". Triangle count is unchanged; draw calls drop to <=2.
export function mergeTree(group) {
  group.updateMatrixWorld(true);

  // Wind weights are relative to the whole tree, so measure it before baking.
  const bounds = new THREE.Box3().setFromObject(group);
  const minY = bounds.min.y;
  const spanY = Math.max(1e-6, bounds.max.y - minY);
  const maxRadius = Math.max(
    1e-6,
    Math.abs(bounds.max.x), Math.abs(bounds.min.x),
    Math.abs(bounds.max.z), Math.abs(bounds.min.z)
  );

  const buckets = { bark: [], foliage: [] };
  group.traverse((child) => {
    if (!child.isMesh) return;
    const foliage = isFoliage(child);
    const geom = bakedGeometry(child);
    windAttribute(geom, { foliage, minY, spanY, maxRadius, phase: phaseOf(child.name) });
    buckets[foliage ? 'foliage' : 'bark'].push(geom);
  });

  const merged = new THREE.Group();
  merged.name = group.name || 'Treegen_asset';
  for (const [name, geoms] of Object.entries(buckets)) {
    if (geoms.length === 0) continue;
    const geometry = mergeGeometries(geoms, false);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
    mat.name = name;
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = name;
    merged.add(mesh);
  }
  return merged;
}
