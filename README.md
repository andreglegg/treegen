# treegen

Stylized low-poly tree generator. Deterministic — the same seed always produces
the same tree — and game-ready: exports GLB or OBJ with sane triangle counts.

![treegen](treegen-upgraded.png)

Three ways to use it:

| Surface | Entry point |
|---|---|
| Browser app | `npm run dev` |
| MCP server (stdio) | `npm run mcp` |
| Library | `import { buildTree } from 'treegen/generator'` |

It is also hosted as a remote MCP server at
`https://mcp.andreglegg.no/treegen`, so no install is needed:

    claude mcp add --transport http treegen https://mcp.andreglegg.no/treegen

## Library use

The generator is DOM-free and runs in Node or the browser. Only `three` is a
runtime dependency — everything else here is dev-only.

    npm install github:andreglegg/treegen

```js
import { buildTree, meshStats, presets } from 'treegen/generator';
import { exportGlb } from 'treegen/export';

const tree = buildTree({ ...presets.oak, seed: 42, detail: 1 });
console.log(meshStats(tree));        // { meshes, triangles }
const glb = await exportGlb(tree);   // ArrayBuffer — works in Node and browser
```

`exportGlb` shims `FileReader` when it is missing, so the same code path works
in Node and in the browser.

## Game-ready export

A generated tree is 25–120 small meshes — one draw call each. The game export
stack collapses that to 2:

```js
import { mergeTree } from 'treegen/merge';
import { exportGameGlb, exportForestGlb } from 'treegen/export';

const merged = mergeTree(buildTree(params));   // <=2 meshes: "bark", "foliage"
const glb = await exportGameGlb(params);       // LOD0/LOD1/LOD2 nodes
const kit = await exportForestGlb({ params, count: 9, seedBase: 77, agedSpread: 0.35 });
```

- `mergeTree(group)` bakes world transforms and material colors into per-vertex
  `COLOR_0`, merging everything into at most two vertex-colored meshes named
  `bark` and `foliage`. Triangle count is unchanged.
- `exportGameGlb(params)` builds the same params at detail 2/1/0, merges each,
  and parents them under nodes named `LOD0`/`LOD1`/`LOD2` in one GLB. **Engines
  wire LOD visibility ranges to those node names** (e.g. Unity LOD Group,
  Godot VisibleOnScreenNotifier/HLOD, Unreal LOD screen sizes); each LOD draws
  in at most 2 calls.
- `exportForestGlb({ params, count, seedBase, agedSpread })` is a kit file:
  `count` merged trees (LOD0 only) seeded `seedBase+i`, ages jittered across
  `agedSpread` (deterministic from `seedBase`), laid out on a grid spaced at
  2.5x the max crown radius under nodes `tree_0..N` — cherry-pick single trees
  or drop the whole copse in.

The app has an "Export game GLB" button next to Export GLB, and the MCP server
exposes `export_game_tree` and `export_forest`.

## Parameters

Six presets (`meadow`, `orchard`, `pine`, `oak`, `acacia`, `willow`) and five
species silhouettes (`round`, `oak`, `acacia`, `willow`, `pine`). Everything is
bounded — see `paramShape` in `mcp/server.js` for ranges.

`detail` drives the triangle budget, at the generator's default foliage density:

| detail | triangles | intent |
|---|---|---|
| 0 | ~1k | low-poly |
| 1 | ~3k | game-ready |
| 2 | ~7k | hero |

`leafDensity` moves those numbers a lot — each foliage cluster is its own mesh,
so the oak preset (density 46) roughly doubles the detail-1 count. Read
`meshStats()` rather than assuming.

## Consumers

`mcp/generator.js` and `mcp/export.js` are the shared core. Anything that
depends on them should pull this repo as a git dependency rather than copying
the files — the copies drift.
