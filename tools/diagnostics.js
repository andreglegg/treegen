// Numeric defect detection for a generated tree, measured from the finished
// THREE.Group rather than from generator internals — so the same checks work
// against the old generator and the new one, and can't drift from what is
// actually exported.
import * as THREE from 'three';

const BARK = /trunk|branch_segment/;
const FOLIAGE = /leaf_cluster|pine_bough|foliage/;

// A bark mesh's axis, in world space, derived from the geometry itself: the
// longest side of the local bounding box is the length, the shortest is the
// girth. Works for both a plain cylinder and a swept tube, so old and new
// generators are measured the same way.
function segmentOf(mesh) {
  const geom = mesh.geometry;
  geom.computeBoundingBox();
  const size = geom.boundingBox.getSize(new THREE.Vector3());
  const centre = geom.boundingBox.getCenter(new THREE.Vector3());

  const longest = Math.max(size.x, size.y, size.z);
  if (!(longest > 0)) return null;
  const axis =
    size.x === longest ? new THREE.Vector3(1, 0, 0)
    : size.y === longest ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

  const half = axis.multiplyScalar(longest / 2);
  return {
    a: centre.clone().sub(half).applyMatrix4(mesh.matrixWorld),
    b: centre.clone().add(half).applyMatrix4(mesh.matrixWorld),
    radius: Math.min(size.x, size.y, size.z) / 2,
  };
}

// Foliage as a centre plus an effective radius, so "is this branch inside a
// leaf mass" becomes a distance test.
function blobOf(mesh) {
  mesh.geometry.computeBoundingSphere();
  const s = mesh.getWorldScale(new THREE.Vector3());
  const radius = mesh.geometry.boundingSphere.radius * Math.max(s.x, s.y, s.z);
  return { centre: mesh.getWorldPosition(new THREE.Vector3()), radius };
}

function collect(group) {
  group.updateMatrixWorld(true);
  const bark = [];
  const foliage = [];
  group.traverse((child) => {
    if (!child.isMesh) return;
    if (FOLIAGE.test(child.name)) foliage.push(blobOf(child));
    else if (BARK.test(child.name)) {
      const seg = segmentOf(child);
      if (seg) bark.push(seg);
    }
  });
  return { bark, foliage };
}

function distanceToSegment(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / (ab.lengthSq() || 1e-9)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/**
 * Defects that are easier to count than to see. Every number here should be
 * driven toward zero by the rewrite, so they double as regression detection.
 */
export function diagnose(group) {
  const { bark, foliage } = collect(group);

  // A tip is a branch end that no other branch grows out of.
  const isTip = (end) => !bark.some((o) => o.a.distanceTo(end) < o.radius * 2 + 0.05);
  const tips = [];
  for (const seg of bark) {
    if (isTip(seg.b)) tips.push(seg.b);
    if (isTip(seg.a) && seg.a.y > 0.2) tips.push(seg.a);
  }

  // A tip with no leaf mass around it is a stick poking into open air.
  const sticksInAir = tips.filter(
    (tip) => !foliage.some((f) => tip.distanceTo(f.centre) < f.radius * 1.25)
  ).length;

  // A leaf mass with no branch inside or near it is floating unsupported.
  const floatingLeaves = foliage.filter(
    (f) => !bark.some((seg) => distanceToSegment(f.centre, seg.a, seg.b) < f.radius * 1.5)
  ).length;

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());

  let meshes = 0;
  let triangles = 0;
  group.traverse((c) => {
    if (!c.isMesh) return;
    meshes += 1;
    const n = c.geometry.index?.count ?? c.geometry.attributes.position.count;
    triangles += Math.round(n / 3);
  });

  return {
    meshes,
    triangles,
    tips: tips.length,
    sticksInAir,
    floatingLeaves,
    foliageMasses: foliage.length,
    barkSegments: bark.length,
    height: +size.y.toFixed(2),
    width: +Math.max(size.x, size.z).toFixed(2),
    // Wide-and-flat species should be >1; tall species <1. Catches an "acacia"
    // that is only an acacia by name.
    spread: +(Math.max(size.x, size.z) / (size.y || 1)).toFixed(2),
  };
}

export { collect };
