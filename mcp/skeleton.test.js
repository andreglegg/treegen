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
  const spread = (species) => {
    const skel = make({ species });
    const box = new THREE.Box3();
    for (const a of skel.anchors) box.expandByPoint(a.p);
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
    height: [3, 10], trunkRadius: [0.18, 0.9], branchCount: [4, 18],
    branchSpread: [0.45, 2.2], canopySize: [0.9, 3.6], leafDensity: [8, 64],
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

test('all presets build', () => {
  for (const [name, params] of Object.entries(presets)) {
    const skel = buildSkeleton({ ...defaultParams, ...params });
    assert.ok(skel.anchors.length > 0, `${name} produced no foliage`);
  }
});
