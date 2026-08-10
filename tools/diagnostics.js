// Numeric defect detection for a generated tree, measured from the finished
// THREE.Group rather than from generator internals — so the same checks work
// against the old generator and the new one, and can't drift from what is
// actually exported.
import * as THREE from 'three';

const BARK = /trunk|branch_segment/;
const FOLIAGE = /leaf_cluster|pine_bough|foliage/;

// A bark mesh's axis, in world space. The current generator stashes its exact
// endpoints (and curve) in userData.axis — use those when present, because a
// bounding box misplaces the endpoints of a bowed limb and every such error
// shows up as a phantom defect. The box estimate remains as the fallback for
// meshes that don't carry the annotation (the legacy generator).
function segmentOf(mesh) {
  const axis = mesh.userData?.axis;
  if (axis) {
    const toWorld = (p) => p.clone().applyMatrix4(mesh.matrixWorld);
    return {
      a: toWorld(axis.a),
      b: toWorld(axis.b),
      radius: axis.radius,
      curve: axis.points ? axis.points.map(toWorld) : null,
    };
  }
  const geom = mesh.geometry;
  geom.computeBoundingBox();
  const size = geom.boundingBox.getSize(new THREE.Vector3());
  const centre = geom.boundingBox.getCenter(new THREE.Vector3());

  const longest = Math.max(size.x, size.y, size.z);
  if (!(longest > 0)) return null;
  const boxAxis =
    size.x === longest ? new THREE.Vector3(1, 0, 0)
    : size.y === longest ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

  const half = boxAxis.multiplyScalar(longest / 2);
  return {
    a: centre.clone().sub(half).applyMatrix4(mesh.matrixWorld),
    b: centre.clone().add(half).applyMatrix4(mesh.matrixWorld),
    radius: Math.min(size.x, size.y, size.z) / 2,
  };
}

// Foliage as a centre plus per-axis half-extents. A bounding sphere is not
// good enough here: a pad squashed flat still gets its full radius vertically,
// so a bare twig under an acacia's umbrella would count as covered. The
// ellipsoid test is what actually catches that.
function blobOf(mesh) {
  mesh.geometry.computeBoundingBox();
  const half = mesh.geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const s = mesh.getWorldScale(new THREE.Vector3());
  const extents = new THREE.Vector3(half.x * s.x, half.y * s.y, half.z * s.z);
  return {
    centre: mesh.getWorldPosition(new THREE.Vector3()),
    extents,
    radius: Math.max(extents.x, extents.y, extents.z),
  };
}

// Normalised ellipsoid distance: <1 means p is inside the mass, and the margin
// scales with the mass's real shape on each axis. Rotation is ignored, which
// errs toward reporting a defect rather than hiding one.
function ellipsoidDistance(p, blob) {
  const dx = (p.x - blob.centre.x) / (blob.extents.x || 1e-9);
  const dy = (p.y - blob.centre.y) / (blob.extents.y || 1e-9);
  const dz = (p.z - blob.centre.z) / (blob.extents.z || 1e-9);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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

  // Distance from a point to a piece of bark, following the real curve when
  // the mesh carries one — the chord of a bowed limb sits well off its path.
  const distToBark = (p, seg) => {
    if (!seg.curve) return distanceToSegment(p, seg.a, seg.b);
    let best = Infinity;
    for (let i = 0; i < seg.curve.length - 1; i += 1) {
      best = Math.min(best, distanceToSegment(p, seg.curve[i], seg.curve[i + 1]));
    }
    return best;
  };

  // An endpoint is connected when it touches the body of some other piece of
  // bark — the trunk it grows out of, or a child growing out of it. Testing
  // against whole segments rather than just their start points matters: a limb
  // joins the trunk half way up it, nowhere near the trunk's own endpoints.
  const connected = (p, self) =>
    bark.some((o) => o !== self && distToBark(p, o) < Math.max(o.radius, 0.04) * 2.2);

  const tips = [];
  for (const seg of bark) {
    if (!connected(seg.b, seg)) tips.push(seg.b);
    if (seg.a.y > 0.2 && !connected(seg.a, seg)) tips.push(seg.a);
  }

  // A tip with no leaf mass around it is a stick poking into open air. The
  // ellipsoid test respects each mass's real shape per axis.
  const sticksInAir = tips.filter(
    (tip) => !foliage.some((f) => ellipsoidDistance(tip, f) < 1.25)
  ).length;

  // A leaf mass with no branch inside or near it is floating unsupported.
  const floatingLeaves = foliage.filter(
    (f) => !bark.some((seg) => distToBark(f.centre, seg) < f.radius * 1.5)
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
