// Tests for the game-ready export stack: mergeTree, exportGameGlb,
// exportForestGlb. Run with `npm test` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, meshStats, presets, defaultParams } from './generator.js';
import { mergeTree } from './merge.js';
import { exportGameGlb, exportForestGlb } from './export.js';

// Parse the JSON chunk out of a GLB ArrayBuffer.
function glbJson(buffer) {
  const view = new DataView(buffer);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'GLB magic');
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
}

test('mergeTree collapses a tree to at most 2 meshes (bark + foliage)', () => {
  for (const [name, preset] of Object.entries(presets)) {
    const merged = mergeTree(buildTree(preset));
    const { meshes } = meshStats(merged);
    assert.ok(meshes <= 2, `${name}: got ${meshes} meshes`);
    const names = merged.children.map((c) => c.name).sort();
    // Bare trees (leafDensity 0, e.g. the snag) have no foliage to merge —
    // they legitimately collapse to a single bark mesh.
    const expected = (preset.leafDensity ?? 1) === 0 ? ['bark'] : ['bark', 'foliage'];
    assert.deepEqual(names, expected, name);
  }
});

test('merged meshes carry a per-vertex color attribute and vertexColors materials', () => {
  const merged = mergeTree(buildTree(presets.oak));
  for (const mesh of merged.children) {
    const color = mesh.geometry.attributes.color;
    assert.ok(color, `${mesh.name} has no color attribute`);
    assert.equal(color.itemSize, 3);
    assert.equal(color.count, mesh.geometry.attributes.position.count);
    assert.equal(mesh.material.vertexColors, true);
    assert.equal(mesh.material.roughness, 0.88);
  }
});

test('merge preserves triangle count within 1%', () => {
  for (const preset of Object.values(presets)) {
    const tree = buildTree(preset);
    const before = meshStats(tree).triangles;
    const after = meshStats(mergeTree(tree)).triangles;
    assert.ok(Math.abs(after - before) / before <= 0.01, `${preset.species}: ${before} -> ${after}`);
  }
});

test('exportGameGlb returns a non-empty GLB with LOD0/LOD1/LOD2 nodes', async () => {
  const glb = await exportGameGlb(presets.pine);
  assert.ok(glb instanceof ArrayBuffer);
  assert.ok(glb.byteLength > 0);
  const names = glbJson(glb).nodes.map((n) => n.name);
  for (const lod of ['LOD0', 'LOD1', 'LOD2']) assert.ok(names.includes(lod), `missing ${lod}`);
});

test('exportForestGlb returns a non-empty GLB with tree_0..N nodes', async () => {
  const count = 5;
  const glb = await exportForestGlb({ params: presets.meadow, count, seedBase: 77 });
  assert.ok(glb instanceof ArrayBuffer);
  assert.ok(glb.byteLength > 0);
  const names = glbJson(glb).nodes.map((n) => n.name);
  for (let i = 0; i < count; i += 1) assert.ok(names.includes(`tree_${i}`), `missing tree_${i}`);
});

test('forest export is deterministic: same seedBase gives an identical kit', async () => {
  const args = { params: presets.oak, count: 4, seedBase: 1234, agedSpread: 0.4 };
  const a = await exportForestGlb(args);
  const b = await exportForestGlb(args);
  assert.ok(Buffer.from(a).equals(Buffer.from(b)), 'GLB bytes differ between identical runs');
  // Layout specifically: every tree node's transform matches.
  const nodesA = glbJson(a).nodes.filter((n) => n.name?.startsWith('tree_'));
  const nodesB = glbJson(b).nodes.filter((n) => n.name?.startsWith('tree_'));
  assert.deepEqual(nodesA, nodesB);
  assert.equal(nodesA.length, 4);
});

test('different seedBase changes the forest', async () => {
  const a = await exportForestGlb({ params: presets.meadow, count: 3, seedBase: 10 });
  const b = await exportForestGlb({ params: presets.meadow, count: 3, seedBase: 11 });
  assert.ok(!Buffer.from(a).equals(Buffer.from(b)), 'expected different kits for different seedBase');
});

test('merged meshes carry a wind mask in UV1: rigid at the base, loose at the tips', () => {
  const merged = mergeTree(buildTree({ ...defaultParams, species: 'oak', seed: 1234 }));
  let bark = null, foliage = null;
  merged.traverse((c) => {
    if (c.name === 'bark') bark = c;
    if (c.name === 'foliage') foliage = c;
  });
  assert.ok(bark && foliage, 'merge produces bark and foliage');

  for (const mesh of [bark, foliage]) {
    const uv1 = mesh.geometry.getAttribute('uv1');
    assert.ok(uv1, `${mesh.name} carries a uv1 wind attribute`);
    assert.equal(uv1.itemSize, 2, 'uv1 is (stiffness, phase)');
    for (let i = 0; i < uv1.count; i += 1) {
      const s = uv1.getX(i), p = uv1.getY(i);
      assert.ok(s >= 0 && s <= 1, `${mesh.name} stiffness out of range: ${s}`);
      assert.ok(p >= 0 && p <= 1, `${mesh.name} phase out of range: ${p}`);
    }
  }

  // The trunk foot must not sway; the outer canopy must.
  const pos = bark.geometry.getAttribute('position');
  const uv1 = bark.geometry.getAttribute('uv1');
  let footMax = 0;
  for (let i = 0; i < pos.count; i += 1) if (pos.getY(i) < 0.3) footMax = Math.max(footMax, uv1.getX(i));
  assert.ok(footMax < 0.15, `trunk foot should be rigid, got ${footMax.toFixed(2)}`);

  const fuv = foliage.geometry.getAttribute('uv1');
  let leafMax = 0;
  for (let i = 0; i < fuv.count; i += 1) leafMax = Math.max(leafMax, fuv.getX(i));
  assert.ok(leafMax > 0.8, `outer foliage should sway freely, got ${leafMax.toFixed(2)}`);
});

test('wind phase varies between foliage masses so leaves do not sway in unison', () => {
  const merged = mergeTree(buildTree({ ...defaultParams, species: 'oak', seed: 1234 }));
  let foliage = null;
  merged.traverse((c) => { if (c.name === 'foliage') foliage = c; });
  const uv1 = foliage.geometry.getAttribute('uv1');
  const phases = new Set();
  for (let i = 0; i < uv1.count; i += 1) phases.add(uv1.getY(i).toFixed(3));
  assert.ok(phases.size > 5, `expected distinct per-cluster phases, got ${phases.size}`);
});
