import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSkeleton, SPECIES_PROFILES } from './skeleton.js';
import { presets, defaultParams } from './generator.js';

const SPECIES = Object.keys(SPECIES_PROFILES);
const make = (over = {}) => buildSkeleton({ ...defaultParams, ...over });

function everyPoint(skel) {
  return [...skel.spine.map((s) => s.p), ...skel.branches.flatMap((b) => b.points), ...skel.anchors.map((a) => a.p)];
}

test('produces finite geometry for every species', () => {
  for (const species of SPECIES) {
    const skel = make({ species });
    for (const p of everyPoint(skel)) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), `NaN in ${species}`);
    }
    assert.ok(skel.branches.length > 0, `${species} has no branches`);
    assert.ok(skel.anchors.length > 0, `${species} has no foliage`);
  }
});

test('every foliage anchor sits on a branch tip', () => {
  for (const species of SPECIES) {
    const skel = make({ species });
    const tips = skel.branches.map((b) => b.points[b.points.length - 1]);
    for (const anchor of skel.anchors) {
      const near = tips.some((t) => t.distanceTo(anchor.p) <= anchor.radius * 1.6);
      assert.ok(near, `${species}: foliage floating away from every branch tip`);
    }
  }
});

test('every branch tip carries foliage', () => {
  for (const species of SPECIES) {
    const skel = make({ species });
    const terminals = skel.branches.filter((b) => b.terminal);
    for (const branch of terminals) {
      const tip = branch.points[branch.points.length - 1];
      const covered = skel.anchors.some((a) => a.p.distanceTo(tip) <= a.radius * 1.6);
      assert.ok(covered, `${species}: branch tip ending in open air`);
    }
  }
});

test('broadleaf foliage count honours leafDensity', () => {
  for (const leafDensity of [8, 21, 46, 64]) {
    for (const species of ['round', 'oak', 'acacia', 'willow']) {
      const skel = make({ species, leafDensity });
      assert.equal(skel.anchors.length, leafDensity, `${species} @ ${leafDensity}`);
    }
  }
});

test('branch radii shrink from parent to child', () => {
  const skel = make({ species: 'oak' });
  for (const branch of skel.branches) {
    if (branch.parent < 0) continue;
    const parent = skel.branches[branch.parent];
    assert.ok(branch.radius <= parent.radius + 1e-9, 'child thicker than parent');
    assert.ok(branch.endRadius < branch.radius, 'branch does not taper');
  }
});

test('trunk tapers upward and flares at the root', () => {
  const skel = make({ trunkRadius: 0.5, lean: 0 });
  const base = skel.spine[0].r;
  const top = skel.spine[skel.spine.length - 1].r;
  assert.ok(top < base * 0.35, 'trunk barely tapers');
  assert.ok(base > skel.spine[2].r, 'no root flare');
});

test('species silhouettes actually differ', () => {
  // Measure the extent of the foliage itself, not just anchor centres — a
  // willow's strands hang well below their anchor, and centres alone would
  // report a shape the tree does not actually have.
  const spread = (species) => {
    const skel = make({ species });
    const box = new THREE.Box3();
    for (const a of skel.anchors) {
      const vertical = a.radius * (a.aspect ?? 1);
      box.expandByPoint(new THREE.Vector3(a.p.x + a.radius, a.p.y + vertical, a.p.z + a.radius));
      box.expandByPoint(new THREE.Vector3(a.p.x - a.radius, a.p.y - vertical, a.p.z - a.radius));
    }
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.z) / (size.y || 1);
  };
  // An acacia must be markedly wider-than-tall; a willow markedly less so.
  assert.ok(spread('acacia') > 2.2, `acacia not umbrella-shaped (${spread('acacia')})`);
  assert.ok(spread('oak') > spread('round'), 'oak no wider than a generic round tree');
  assert.ok(spread('willow') < spread('oak'), 'willow as wide as an oak');
});

test('same seed reproduces identical structure', () => {
  const a = make({ seed: 991 });
  const b = make({ seed: 991 });
  assert.deepEqual(
    a.anchors.map((x) => [+x.p.x.toFixed(6), +x.p.y.toFixed(6), +x.p.z.toFixed(6)]),
    b.anchors.map((x) => [+x.p.x.toFixed(6), +x.p.y.toFixed(6), +x.p.z.toFixed(6)])
  );
});

test('different seeds produce different trees', () => {
  const a = make({ seed: 11 });
  const b = make({ seed: 12 });
  const centre = (s) => s.anchors.reduce((n, x) => n + x.p.x + x.p.y + x.p.z, 0);
  assert.notEqual(centre(a).toFixed(4), centre(b).toFixed(4));
});

test('survives every extreme the MCP schema permits', () => {
  const ranges = {
    age: [0, 1], height: [2, 50], trunkRadius: [0.15, 2.5], branchCount: [4, 18],
    branchSpread: [0.45, 2.2], canopySize: [0.9, 8], leafDensity: [8, 64],
    leafShape: [0.15, 1], leafSize: [0.45, 1.7], leafVariation: [0, 1],
    lean: [0, 0.55], detail: [0, 2],
  };
  for (const [key, bounds] of Object.entries(ranges)) {
    for (const value of bounds) {
      for (const species of SPECIES) {
        const skel = make({ species, [key]: value });
        for (const p of everyPoint(skel)) {
          assert.ok(Number.isFinite(p.x + p.y + p.z), `${species} ${key}=${value} produced NaN`);
        }
        assert.ok(skel.anchors.length > 0, `${species} ${key}=${value} produced no foliage`);
      }
    }
  }
});

test('the trunk stays visible at every height', () => {
  // A crown that reaches the ground turns the tree into a bush. Short trees
  // are where this bites, because canopySize does not scale with height.
  for (const height of [3, 4.5, 6.2, 10]) {
    for (const species of ['round', 'oak', 'acacia', 'willow']) {
      const skel = buildSkeleton({ ...defaultParams, species, height, canopySize: 3.6 });
      const lowest = Math.min(...skel.anchors.map((a) => a.p.y - a.radius));
      assert.ok(lowest > height * 0.22, `${species} @ h=${height}: foliage reaches ${lowest.toFixed(2)}`);
    }
  }
});

test('age produces the allometry it claims', () => {
  const measure = (age) => {
    const skel = buildSkeleton({ ...defaultParams, species: 'oak', age });
    const box = new THREE.Box3();
    for (const a of skel.anchors) {
      box.expandByPoint(new THREE.Vector3(a.p.x + a.radius, a.p.y, a.p.z + a.radius));
      box.expandByPoint(new THREE.Vector3(a.p.x - a.radius, a.p.y, a.p.z - a.radius));
    }
    const size = box.getSize(new THREE.Vector3());
    return { width: Math.max(size.x, size.z), baseR: skel.spine[0].r };
  };
  const young = measure(0.05);
  const old = measure(1);
  assert.ok(old.width > young.width * 1.3, 'old crown should be much wider than young');
  assert.ok(old.baseR > young.baseR * 1.2, 'old base should flare more than young');
  // Saplings are too young to fork.
  const sapling = buildSkeleton({ ...defaultParams, species: 'oak', age: 0.1 });
  assert.ok(!sapling.branches.some((b) => b.leader), 'sapling should not have forked leaders');
});

test('giants get buttress flanges and columnar taper', () => {
  const giant = buildSkeleton({ ...defaultParams, species: 'pine', age: 0.85, height: 42, trunkRadius: 1.9 });
  assert.ok(giant.buttress, 'tall old tree should have buttress data');
  // Columnar: mid-trunk radius stays a large fraction of the base (flare zone excluded).
  const midR = giant.spine[Math.floor(giant.spine.length / 2)].r;
  const upperFlareFree = giant.spine[Math.floor(giant.spine.length * 0.3)].r;
  assert.ok(midR / upperFlareFree > 0.7, `giant trunk should be near-columnar (${(midR / upperFlareFree).toFixed(2)})`);
  const normal = buildSkeleton({ ...defaultParams, species: 'round', age: 0.5 });
  assert.equal(normal.buttress, null, 'ordinary mature tree should have no buttress');
});

test('all presets build', () => {
  for (const [name, params] of Object.entries(presets)) {
    const skel = buildSkeleton({ ...defaultParams, ...params });
    assert.ok(skel.anchors.length > 0, `${name} produced no foliage`);
  }
});
