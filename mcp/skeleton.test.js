import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSkeleton, SPECIES_PROFILES } from './skeleton.js';
import { presets, defaultParams, buildTree } from './generator.js';

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
    for (const species of ['round', 'oak', 'acacia', 'willow', 'birch', 'poplar', 'baobab']) {
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
    branchSpread: [0.45, 2.2], canopySize: [0.9, 8], leafDensity: [0, 64],
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
        // leafDensity 0 is bare/winter mode: zero foliage is the contract
        // there, and the silhouette is carried by twigs instead.
        if (key === 'leafDensity' && value === 0) {
          assert.equal(skel.anchors.length, 0, `${species} bare tree still grew foliage`);
          assert.ok(skel.branches.some((b) => b.twig), `${species} bare tree grew no twigs`);
        } else {
          assert.ok(skel.anchors.length > 0, `${species} ${key}=${value} produced no foliage`);
        }
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

test('age grows the tree: height rises to mid-life, girth keeps thickening', () => {
  const top = (age) => {
    const spine = buildSkeleton({ ...defaultParams, age }).spine;
    return spine[spine.length - 1].p.y;
  };
  const baseR = (age) => buildSkeleton({ ...defaultParams, age }).spine[0].r;
  assert.ok(top(0) < top(0.25) && top(0.25) < top(0.5), 'height should rise through youth');
  assert.ok(top(0) < top(0.5) * 0.45, 'a newborn sapling should be a fraction of mature height');
  assert.ok(baseR(1) > baseR(0.5) * 1.4, 'girth should keep thickening after height stalls');
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

test('palm is a bare trunk with a frond rosette at the apex', () => {
  const skel = make({ species: 'palm' });
  // 7-12 fronds, one stub branch each, no recursive branching.
  assert.ok(skel.anchors.length >= 7 && skel.anchors.length <= 12, `frond count ${skel.anchors.length}`);
  assert.equal(skel.branches.length, skel.anchors.length, 'palm should have exactly one stub per frond');
  assert.ok(skel.branches.every((b) => b.terminal && b.parent === -1), 'palm stubs must not branch');
  assert.ok(skel.anchors.every((a) => a.frond), 'every palm mass is a frond');
  // The rosette sits at the apex: every frond centre in the top quarter.
  const top = skel.spine[skel.spine.length - 1].p.y;
  assert.ok(skel.anchors.every((a) => a.p.y > top * 0.75), 'fronds should crowd the apex');
  // The trunk keeps a columnar top for the rosette to sit on.
  assert.ok(skel.spine[skel.spine.length - 1].r > skel.spine[0].r * 0.3, 'palm trunk should stay columnar');
});

test('poplar is a fastigiate column', () => {
  const width = (species) => {
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
  assert.ok(width('poplar') < 0.62, `poplar crown not columnar (${width('poplar').toFixed(2)})`);
  assert.ok(width('poplar') < width('round') * 0.55, 'poplar should be far narrower than a round tree');
  // The column hugs the trunk from low on the stem.
  const skel = make({ species: 'poplar' });
  const low = Math.min(...skel.anchors.map((a) => a.p.y));
  assert.ok(low < skel.params.height * 0.45, 'poplar foliage should start low');
});

test('baobab keeps a barrel trunk and short fat leaders', () => {
  const skel = make({ species: 'baobab', trunkRadius: 1.15, height: 9, lean: 0 });
  // Mid-trunk stays as thick as the flare-free lower shaft (barrel), where a
  // normal trunk has already tapered well away.
  const rAt = (s, t) => s.spine[Math.min(s.spine.length - 1, Math.round(t * (s.spine.length - 1)))].r;
  const barrel = rAt(skel, 0.7) / rAt(skel, 0.4);
  assert.ok(barrel > 0.9, `baobab should stay barrel-thick up the shaft (${barrel.toFixed(2)})`);
  const oak = make({ species: 'oak', trunkRadius: 1.15, height: 9, lean: 0 });
  assert.ok(barrel > (rAt(oak, 0.7) / rAt(oak, 0.4)) * 1.1, 'baobab must taper less than an oak');
  // Root-like crown: a cluster of leaders, each markedly shorter than the trunk.
  const leaders = skel.branches.filter((b) => b.leader);
  assert.ok(leaders.length >= 4, 'baobab should fork into a cluster of leaders');
  for (const b of leaders) {
    const len = b.points[0].distanceTo(b.points[b.points.length - 1]);
    assert.ok(len < skel.params.height * 0.45, `leader too long (${len.toFixed(2)})`);
    assert.ok(b.radius > skel.params.trunkRadius * 0.4, 'baobab leaders should be fat');
  }
});

test('birch carries a small crown high on a slim trunk', () => {
  const skel = make({ species: 'birch', height: 7.5, trunkRadius: 0.24 });
  const low = Math.min(...skel.anchors.map((a) => a.p.y - a.radius));
  assert.ok(low > skel.params.height * 0.45, `birch crown should start high (${low.toFixed(2)})`);
  const spanOf = (s) => {
    let min = Infinity;
    let max = -Infinity;
    for (const a of s.anchors) {
      min = Math.min(min, a.p.x - a.radius, a.p.z - a.radius);
      max = Math.max(max, a.p.x + a.radius, a.p.z + a.radius);
    }
    return max - min;
  };
  const oak = make({ species: 'oak' });
  assert.ok(spanOf(skel) < spanOf(oak) * 0.8, 'birch crown should be airier and smaller than an oak');
});

test('all presets build', () => {
  for (const [name, params] of Object.entries(presets)) {
    const skel = buildSkeleton({ ...defaultParams, ...params });
    // The snag is bare by design; every living preset must carry foliage.
    if (name === 'snag') assert.equal(skel.anchors.length, 0, 'snag grew foliage');
    else assert.ok(skel.anchors.length > 0, `${name} produced no foliage`);
  }
});

test('bare tree (leafDensity 0) has no anchors and one extra depth of twigs', () => {
  for (const species of SPECIES) {
    const skel = make({ species, leafDensity: 0 });
    assert.equal(skel.anchors.length, 0, `${species} bare tree still has foliage`);
    const twigs = skel.branches.filter((b) => b.twig);
    assert.ok(twigs.length >= 2, `${species} bare tree grew no twigs`);
    for (const twig of twigs) {
      const parent = skel.branches[twig.parent];
      assert.ok(parent, `${species} twig has no parent branch`);
      // The extra depth: twigs recurse one level past the terminal they
      // replace an anchor on, and start exactly at its tip.
      assert.equal(twig.depth, parent.depth + 1, `${species} twig not one depth deeper`);
      const tip = parent.points[parent.points.length - 1];
      assert.ok(twig.points[0].distanceTo(tip) < 1e-6, `${species} twig floats off its parent tip`);
    }
  }
  // A leafy tree of the same params must have no twigs at all.
  assert.ok(!make({ leafDensity: 30 }).branches.some((b) => b.twig), 'leafy tree grew winter twigs');
});

test('snag preset: zero foliage and a jagged broken top', () => {
  const params = { ...defaultParams, ...presets.snag };
  const skel = buildSkeleton(params);
  assert.equal(skel.anchors.length, 0, 'snag grew foliage');
  // Trunk is trimmed at ~70% of its grown height…
  const grownHeight = skel.params.height;
  const top = skel.spine[skel.spine.length - 1].p.y;
  assert.ok(top < grownHeight * 0.78, `snag trunk not broken (top at ${top.toFixed(2)} of ${grownHeight.toFixed(2)})`);
  // …and the last ring stays blunt (~40% of the shear radius), not a point.
  const lastR = skel.spine[skel.spine.length - 1].r;
  const shearR = skel.spine[skel.spine.length - 2].r;
  assert.ok(lastR > shearR * 0.3, `snag tip tapers to a point (${lastR} vs ${shearR})`);
});

test('ancient broadleaf grows stag-head dead spikes above the crown', () => {
  const skel = make({ species: 'oak', age: 1 });
  const dead = skel.branches.filter((b) => b.dead);
  assert.ok(dead.length >= 2 && dead.length <= 4, `expected 2-4 dead spikes, got ${dead.length}`);
  const crownTop = skel.crown.centre.y + skel.crown.ry;
  for (const spike of dead) {
    const tip = spike.points[spike.points.length - 1];
    assert.ok(tip.y > crownTop, 'dead spike does not rise above the crown');
    assert.ok(spike.endRadius < 0.02, 'dead spike does not taper to a point');
    const parent = skel.branches[spike.parent];
    assert.ok(parent, 'dead spike has no source limb');
  }
  // The meshes carry the dead_branch_N names the diagnostics exempt.
  const group = buildTree({ ...defaultParams, species: 'oak', age: 1 });
  let named = 0;
  group.traverse((c) => { if (c.isMesh && /^dead_branch_\d+$/.test(c.name)) named += 1; });
  assert.equal(named, dead.length, 'dead spikes not named dead_branch_N in the mesh');
  // A merely mature tree has none.
  assert.ok(!make({ species: 'oak', age: 0.5 }).branches.some((b) => b.dead), 'mature oak grew deadwood');
});

test('giant old broadleaf drops aerial roots to the ground', () => {
  const skel = make({ species: 'oak', height: 30, age: 0.8, trunkRadius: 1.1, canopySize: 6 });
  const roots = skel.branches.filter((b) => b.aerial);
  assert.ok(roots.length >= 2 && roots.length <= 4, `expected 2-4 aerial roots, got ${roots.length}`);
  for (const root of roots) {
    const start = root.points[0];
    const end = root.points[root.points.length - 1];
    assert.ok(start.y > skel.params.height * 0.2, 'aerial root starts too low to be aerial');
    assert.ok(end.y < 0.25, 'aerial root does not reach the ground');
    // Thin tube: ~8% of the (grown) trunk radius.
    assert.ok(root.radius < skel.params.trunkRadius * 0.12, 'aerial root too thick');
    // Its top sits on a limb: the parent's centerline passes through it.
    const limb = skel.branches[root.parent];
    assert.ok(limb && limb.points.some((p) => p.distanceTo(start) < 1e-6), 'aerial root floats off its limb');
  }
  // Short or young trees get none.
  assert.ok(!make({ species: 'oak', height: 10, age: 0.8 }).branches.some((b) => b.aerial), 'small oak grew aerial roots');
  assert.ok(!make({ species: 'oak', height: 30, age: 0.4, trunkRadius: 1.1 }).branches.some((b) => b.aerial), 'young giant grew aerial roots');
});
