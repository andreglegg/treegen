# Treegen: visual inspection harness + generator rewrite

Date: 2026-08-10

## Problem

Tree quality is poor and there is no way to see it. The only visual evidence in
the repo is two cherry-picked screenshots. Reading the source and those renders
surfaces seven defects:

1. **Branches connect to nothing.** Branches are straight cylinders radiating
   from the trunk at random angles; foliage is scattered independently through a
   spherical volume. Bare sticks pass through leaf blobs and end in open air.
2. **No branch recursion.** One trunk, one flat ring of branches. Trees read as
   trees because of branch hierarchy, and there is none.
3. **The trunk is a straight cone.** No curve, no root flare, no taper variation.
4. **The `bark_shadow` cylinder erupts through the trunk.** It is built from
   hardcoded coordinates (`0.05, -0.03`) while the outer trunk is displaced by
   `lean`. At `lean: 0.18` the axes diverge ~0.175 against an outer radius of
   ~0.194, so the dark cylinder breaks the surface. Visible in both committed
   screenshots.
5. **The canopy is a bag of balls.** Randomly rotated icosahedra of near-uniform
   size, so every species is the same blob cloud with different numbers.
6. **Palette misuse.** Leaf colors are assigned by `i % 3`, so the highlight tone
   lands on arbitrary clusters regardless of light direction. It reads as
   disease, not lighting.
7. **Species barely differentiate.** `acacia` and `round` differ only by a few
   profile scalars; the umbrella silhouette never forms.

A further maintenance problem: the geometry math is duplicated between
`src/main.js` and `mcp/generator.js`, and the README already warns consumers
about drift.

## Decisions

- The harness is **agent-facing contact sheets**, not a browser lab. It must be
  runnable in a loop so generator changes can be diffed visually.
- The rewrite replaces **geometry internals only**. Every param name, preset
  name, and MCP schema field keeps working and keeps its meaning. Seeds will not
  reproduce prior geometry; that is accepted.
- The art target is **stylized game low-poly, executed properly**: silhouette
  reads at distance, canopy is one mass rather than N spheres, species are
  instantly distinguishable, chunky facets, flat toon-friendly color.

## Part 1 — Inspection harness

`npm run inspect` runs `tools/inspect.js`. No new dependencies: Playwright and
Vite are already in `devDependencies`.

A new `inspect.html` Vite entry imports the shared generator and exposes
`window.renderSheet(spec)`. The Node script starts Vite programmatically, drives
Chromium to that page, and asks it to render each tree to a WebGL canvas,
composite the frames into one labelled 2D canvas, and return a data URL. Node
writes the PNG. Compositing happens in the browser so no image library is
needed.

### Sheets

| Sheet | Defect class it targets |
|---|---|
| `species.png` | 5 species x 4 seeds, 3/4 view — species distinction, seed variety |
| `silhouette.png` | Same trees as black on white — the "reads at 100m" test |
| `wireframe.png` | Topology: floating foliage, sticks in air, intersections |
| `angles.png` | One tree, 8 orbit angles + top-down — one-sided trees |
| `closeups.png` | Tight crops: root, trunk/branch junction, branch tip, canopy edge |
| `params.png` | Each MCP-exposed param swept to both range extremes |

`params.png` matters because the MCP schema permits those bounds; degenerate
output at a legal value is a bug an agent will hit.

### Numeric diagnostics

`stats.json`, computed from the skeleton without rendering:

- branch tips with no foliage within radius — *sticks in air* count
- foliage clusters with no branch nearby — *floating leaves* count
- triangles against the detail budget
- bounding-box aspect ratio per species, to verify acacia is actually
  wide-and-flat rather than merely labelled so

These give regression detection between runs and catch what the eye misses.

The harness runs first against the **current** generator; output is kept in
`inspect-out/baseline/` so every later change is a diff.

## Part 2 — Generator rewrite

Two focused modules behind an unchanged public API.

### `mcp/skeleton.js` — pure math, no THREE

Produces branch segments and foliage anchor points. Unit-testable with
`node:test` (already available, no runner to install), and it is the input to
the numeric diagnostics above.

- **Trunk spine**: a curved poly-line, bend driven by `lean` plus seeded noise.
  Root flare in the bottom 8%; power-curve taper.
- **Branching**: recursive to depth 2–3, scaled by `detail`. Azimuth by golden
  angle (137.5 degrees) plus jitter rather than an even ring. Child radius
  follows the Da Vinci rule — child radii squared sum to roughly the parent
  radius squared — so joints look structurally sound. Per-species gravity droop.
- **Foliage anchors exist only at terminal branch tips.** This is the core fix:
  no blob without a branch inside it, no branch ending in air.

### `mcp/generator.js` — meshing

Keeps `buildTree`, `meshStats`, `presets`, `randomParams`, both palette exports,
and the existing mesh names (`trunk_segment`, `leaf_cluster_N`,
`pine_bough_layer_N`) so downstream material assignment survives.

- **Tube extrusion** along the spine using parallel-transport frames, replacing
  stacked cylinders. This removes shading seams and deletes the `bark_shadow`
  hack and its eruption bug outright.
- **Canopy as one mass**: each species gets a crown hull function `r(theta, y)`.
  Tips snap onto the hull, blobs are sized so neighbours overlap, and
  fully-interior blobs are culled — which reads better and buys back triangles.
  Acacia becomes genuinely flat-umbrella, oak lobed, willow gets a drooping
  curtain, pine keeps cone skirts but aligned to real branch whorls.
- **Palette by position, not index**: shadow tone for low or interior blobs,
  highlight for high sun-facing ones, so the three colors read as lighting.
- **Budget held** at roughly 1k / 3k / 7k triangles for detail 0 / 1 / 2, and now
  verified by the harness rather than assumed.

### Dedupe

`src/main.js` drops its duplicated geometry code and imports `buildTree`, then
swaps in toon materials and tags foliage for wind by mesh name. One source of
geometry truth.

## Accepted consequences

- Identical seeds produce different trees than before. Unavoidable with any
  structural change.
- Preset *values* are re-tuned against the contact sheets. Preset and param
  *names* do not change.

## Verification

- `node:test` covers the pure-math skeleton: branch counts, absence of NaN,
  every tip carrying foliage, monotonically decreasing radii, bbox matching the
  species profile.
- Visual quality is verified by reading the contact sheets and diffing against
  `inspect-out/baseline/`.
- `npm run dev` and `npm run mcp` must both still work after the dedupe.

## Order of work

1. Harness, run against the current generator for a baseline.
2. `skeleton.js` plus tests.
3. Meshing rewrite.
4. Iterate presets against the sheets.
5. Dedupe `src/main.js`; verify app and MCP server.
