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
  // position/normal/uv/color and drop anything exotic.
  for (const name of Object.keys(geom.attributes)) {
    if (!['position', 'normal', 'uv', 'color'].includes(name)) geom.deleteAttribute(name);
  }
  return geom;
}

// Merge a buildTree() group into a Group holding at most two meshes named
// "bark" and "foliage". Triangle count is unchanged; draw calls drop to <=2.
export function mergeTree(group) {
  group.updateMatrixWorld(true);
  const buckets = { bark: [], foliage: [] };
  group.traverse((child) => {
    if (!child.isMesh) return;
    buckets[isFoliage(child) ? 'foliage' : 'bark'].push(bakedGeometry(child));
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
