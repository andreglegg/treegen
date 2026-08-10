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

Fourteen presets (`meadow`, `orchard`, `pine`, `oak`, `acacia`, `willow`,
`birch`, `poplar`, `palm`, `baobab`, `sapling`, `ancient`, `giant`, `snag`)
and nine species silhouettes (`round`, `oak`, `acacia`, `willow`, `pine`,
`birch`, `poplar`, `palm`, `baobab`). Everything is bounded — see `paramShape`
in `mcp/server.js` for ranges.

`leafDensity: 0` is winter/bare mode: no foliage at all, and every terminal
branch recurses one extra depth into fine twigs so the leafless silhouette
still reads as a tree. The `snag` preset builds on it — a standing dead tree
with a jagged broken top (`brokenTop`) and weathered grey bark. Two more age
cues appear on their own: broadleaf trees at `age >= 0.78` grow a few bare
stag-head spikes above the crown (`dead_branch_N` meshes), and grown
broadleaves over 20m at `age >= 0.6` drop strangler-fig aerial roots from
their limbs to the ground.

`age` (0–1) plays the tree's whole life: `height`/`trunkRadius` state the
FULL-GROWN size and age moves the tree along its growth curve — a knee-high
sapling shoots up through youth, height saturates by mid-life (0.5 = exactly
the sliders), and girth keeps thickening into a squat veteran with heavy
flare, gnarl, drooping limbs, root spurs, and a retrenched crown wider than
tall. The curves come from tree-allometry research; dragging the slider looks
like the tree growing. `height` runs 2–50m; above ~15m the trunk
blends toward giant proportions — near-columnar shaft, stronger basal flare,
and plank buttress flanges (a star cross-section that rounds out partway up),
the cues that make a big tree read as *giant* instead of "small tree,
enlarged".

`detail` drives the triangle budget, at the generator's default foliage density:

| detail | triangles | intent |
|---|---|---|
| 0 | ~1k | low-poly |
| 1 | ~3k | game-ready |
| 2 | ~7k | hero |

`leafDensity` moves those numbers a lot — each foliage cluster is its own mesh,
so a high-density preset can double the detail-1 count. Read `meshStats()`
rather than assuming.

## How a tree is built

`mcp/skeleton.js` is the structural layer and has no meshes in it: it produces a
curved trunk spine, a recursive branch hierarchy, and foliage anchors. Branches
grow toward targets sampled on a per-species crown hull, and **every foliage
anchor is a branch tip** — so leaves never float and branches never end in open
air. `mcp/generator.js` meshes that skeleton: the trunk and every branch is one
continuous swept tube with parallel-transport frames, and the three leaf tones
are assigned by exposure rank so they read as light and shade rather than by
index.

Species rules in `SPECIES_PROFILES` are set from photographs of the real
species rather than guessed. Two matter most:

- **The trunk can fork.** `split` divides the trunk into leaders that fan out
  in a V before the crown starts. This is the whole character of an acacia —
  photos of *Vachellia tortilis* show two to four limbs leaving the trunk low,
  not branches hung off a single pole — and oaks get a milder version.
- **A crown can hang.** `curtain` draws the outer leaf masses down into long
  thin strands while the inner crown stays a rounded dome, which is what a
  weeping willow actually looks like.

Measured crown spread (width ÷ height) tracks the references: acacia ~1.5,
oak ~1.2, round ~0.75, conifer ~0.5. `inspect-out/stats.json` reports it, so
that claim is checkable rather than asserted.

Because the skeleton is pure math it is unit-tested directly — `npm test`.

## Inspecting output

    npm run inspect

Renders 108 trees through headless Chromium into contact sheets under
`inspect-out/`, plus `stats.json`:

| Sheet | What it is for |
|---|---|
| `species.png` | every preset across several seeds |
| `silhouette.png` | shape only — the "reads at 100m" test |
| `wireframe.png` | topology, bark red and foliage green |
| `angles.png` | one tree rotated, then every species from above |
| `closeups.png` | root flare, branch joins, tips, crown edge |
| `params.png` | both ends of every range the MCP schema accepts |
| `styles.png` | each `leafStyle` against three silhouettes |

`stats.json` also counts structural defects — branches ending in air and
unsupported leaf masses — so quality regressions show up as numbers, not just
as something that looks off. Add `--out=name` to write to a subfolder, and
`--legacy` to score `mcp/generator.legacy.js` instead, which is how two
generator versions get compared like for like.

## Consumers

`mcp/skeleton.js`, `mcp/generator.js` and `mcp/export.js` are the shared core,
and the browser app imports the same generator rather than keeping its own copy
of the geometry. Anything that depends on them should pull this repo as a git
dependency rather than copying the files — the copies drift.
