// Headless GLB/OBJ export. three's GLTFExporter uses the browser FileReader API
// for binary output, so we shim a minimal FileReader (backed by Blob.arrayBuffer)
// before the exporter runs in Node.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer()
        .then((buf) => { this.result = buf; this.onloadend?.(); })
        .catch((err) => this.onerror?.(err));
    }
    readAsDataURL(blob) {
      blob.arrayBuffer()
        .then((buf) => {
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
          this.onloadend?.();
        })
        .catch((err) => this.onerror?.(err));
    }
  };
}

const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');

import * as THREE from 'three';
import { buildTree, defaultParams, rng } from './generator.js';
import { mergeTree } from './merge.js';

// Returns an ArrayBuffer so this works in both Node and the browser. Node
// callers that want a Buffer should wrap it: Buffer.from(await exportGlb(g)).
export async function exportGlb(group) {
  const exporter = new GLTFExporter();
  return await new Promise((resolve, reject) => {
    exporter.parse(group, resolve, (err) => reject(err), { binary: true, onlyVisible: true, trs: false });
  });
}

export function exportObj(group) {
  return new OBJExporter().parse(group);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Game-ready single-tree export: the SAME params built at detail 2/1/0, each
// merged down to <=2 vertex-colored meshes, parented under nodes named
// "LOD0"/"LOD1"/"LOD2". Engines wire their LOD visibility ranges to those
// node names; a tree renders in at most 2 draw calls per LOD.
export async function exportGameGlb(params = {}) {
  const root = new THREE.Group();
  root.name = 'Treegen_asset';
  [2, 1, 0].forEach((detail, lod) => {
    const merged = mergeTree(buildTree({ ...params, detail }));
    merged.name = `LOD${lod}`;
    root.add(merged);
  });
  return await exportGlb(root);
}

// Forest kit: `count` trees seeded seedBase+i, ages jittered across
// agedSpread (deterministic from seedBase via the generator's rng stream —
// one draw per tree, in tree order). Each tree is merged (LOD0 only, detail 2)
// and laid out on a spaced grid (spacing = 2.5x the max crown radius) under
// nodes named tree_0..tree_N-1, so engines can cherry-pick individual trees
// or drop the whole kit in as a copse.
export async function exportForestGlb({ params = {}, count = 9, seedBase = 1, agedSpread = 0.35 } = {}) {
  count = Math.max(1, Math.floor(count));
  const base = { ...defaultParams, ...params };
  const rand = rng(Number(seedBase));

  const trees = [];
  let maxCrownRadius = 0;
  for (let i = 0; i < count; i += 1) {
    // agedSpread jitters the REAL age param around the kit's base age, so a
    // mixed stand contains genuine saplings through veterans — the growth
    // curves (height saturation, girth thickening, root spurs, gnarl) do the
    // size variation, not a scale factor.
    const age = clamp(Number(base.age ?? 0.5) + (rand() * 2 - 1) * Number(agedSpread), 0, 1);
    const merged = mergeTree(buildTree({
      ...params,
      seed: Number(seedBase) + i,
      detail: 2,
      age,
    }));
    merged.name = `tree_${i}`;
    const box = new THREE.Box3().setFromObject(merged);
    maxCrownRadius = Math.max(maxCrownRadius, (box.max.x - box.min.x) / 2, (box.max.z - box.min.z) / 2);
    trees.push(merged);
  }

  const spacing = maxCrownRadius * 2.5;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const root = new THREE.Group();
  root.name = 'Treegen_forest_kit';
  trees.forEach((tree, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    tree.position.set((col - (cols - 1) / 2) * spacing, 0, (row - (rows - 1) / 2) * spacing);
    root.add(tree);
  });
  return await exportGlb(root);
}
