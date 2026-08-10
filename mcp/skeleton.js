// The structural layer of the generator: given params, produce a curved trunk
// spine, a recursive branch hierarchy, and foliage anchors. No meshes and no
// rendering — this is the part worth unit-testing, and it is what the
// inspection diagnostics measure against.
//
// The organising idea is that foliage never floats. Every anchor sits at the
// tip of a branch, and branches grow toward targets sampled on a per-species
// crown hull. That makes the union of leaf masses a coherent crown surface
// while keeping the structure underneath physically sensible.
import * as THREE from 'three';

// Golden angle. Successive branches around the trunk never line up, which is
// what stops the old evenly-spaced ring from reading as a wagon wheel.
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// Matches the sun in the app and the inspector, so foliage shading assignment
// agrees with the actual light.
export const SUN = new THREE.Vector3(5, 9, 4).normalize();

/**
 * Per-species shape rules.
 *
 *  crownY      centre of the crown, as a fraction of total height
 *  rx, ry      crown radii as multiples of canopySize (rz tracks rx)
 *  exponent    superellipsoid power: 2 is a sphere, higher is boxier and
 *              flatter-topped, which is what makes an acacia an acacia
 *  crownStart  height fraction where the first primary branch leaves the trunk
 *  rise        upward bias given to primary branches as they leave the trunk
 *  droop       how much gravity bends a branch along its length
 *  curtain     extra downward pull on outer terminal tips (willow)
 *  lobe        crown surface perturbation, breaks up a too-perfect hull
 *  flatBottom  clamps the underside of the crown flat
 *  leafAspect  vertical stretch applied to this species' leaf masses
 *  split       { at, count, rise, spread } — the trunk divides into this many
 *              leaders at height fraction `at` and they fan outward before the
 *              crown starts. This is the whole character of an acacia: photos
 *              of Vachellia tortilis show two to four limbs leaving the trunk
 *              low in a V, not branches hung off a single pole.
 */
// Radii are deliberately small multiples of canopySize: the crown has to clear
// the trunk. A crown whose underside reaches below about 45% of total height
// swallows the trunk and the tree stops reading as a tree.
export const SPECIES_PROFILES = {
  round: {
    crownY: 0.78, rx: 0.62, ry: 0.5, exponent: 2.3, crownStart: 0.52,
    rise: 0.55, droop: 0.18, curtain: 0, lobe: 0.08, flatBottom: 0.15, leafAspect: 1,
  },
  oak: {
    // Broad dense dome, wider than tall, over a short heavy trunk that forks
    // into a couple of massive low limbs.
    crownY: 0.74, rx: 0.86, ry: 0.44, exponent: 2.8, crownStart: 0.5,
    rise: 0.34, droop: 0.3, curtain: 0, lobe: 0.16, flatBottom: 0.26, leafAspect: 0.9,
    split: { at: 0.34, count: 2, rise: 0.5, spread: 0.3 },
  },
  acacia: {
    // The umbrella: leaders fan out low, then the crown is a thin horizontal
    // disc with a flat underside, wider than the tree is tall.
    crownY: 0.88, rx: 1.34, ry: 0.17, exponent: 5, crownStart: 0.62,
    rise: 1.0, droop: -0.1, curtain: 0, lobe: 0.07, flatBottom: 0.66, leafAspect: 0.62,
    split: { at: 0.24, count: 3, rise: 0.66, spread: 0.42 },
  },
  willow: {
    // A broad dome that hangs in long vertical strands. leafAspect does the
    // work: each leaf mass is stretched into a falling withe rather than a
    // ball, which is what the silhouette actually reads as.
    crownY: 0.84, rx: 0.78, ry: 0.34, exponent: 2.1, crownStart: 0.5,
    rise: 0.45, droop: 0.7, curtain: 0.6, lobe: 0.06, flatBottom: 0, leafAspect: 2.4,
    // Strands are thin as well as long, and only the outer crown draws out
    // into them — photographed willows keep a rounded dome on top.
    leafWidth: 0.44,
  },
  pine: {
    crownY: 0.6, rx: 0.9, ry: 1.2, exponent: 2, crownStart: 0.26,
    rise: -0.25, droop: 0.1, curtain: 0, lobe: 0, flatBottom: 0, leafAspect: 1,
  },
};

export function rng(seed) {
  let value = Number(seed) % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Distance from the crown centre to its surface in direction `dir`, solved in
// closed form for a superellipsoid. `lobe` ripples the surface so the hull
// doesn't read as a machined shape.
function hullRadius(dir, rx, ry, rz, exponent, lobe) {
  const n = exponent;
  const s =
    Math.abs(dir.x / rx) ** n + Math.abs(dir.y / ry) ** n + Math.abs(dir.z / rz) ** n;
  let r = s > 0 ? s ** (-1 / n) : 0;
  if (lobe) {
    const theta = Math.atan2(dir.z, dir.x);
    r *= 1 + lobe * Math.sin(theta * 3) * (1 - Math.abs(dir.y) * 0.6);
  }
  return r;
}

/**
 * Directions to grow branches in, spread over the crown by a Fibonacci spiral.
 * The lower bound stops short of straight down: nothing grows to the underside
 * of a crown from the inside.
 */
function crownDirections(count, rand, lowest = -0.5) {
  const dirs = [];
  for (let i = 0; i < count; i += 1) {
    const y = lerp(1, lowest, (i + 0.5) / count);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN * i + rand() * 0.9;
    dirs.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize());
  }
  return dirs;
}

/**
 * Age (0 sapling — 0.5 mature — 1 ancient) drives morphology through curves
 * fitted from tree allometry research; 0.5 reproduces the pre-age look.
 * Young: slender, straight, upswept, narrow tall crown, no fork, no flare.
 * Old: flared gnarled trunk, low fork, drooping limbs, wide flattened crown.
 */
function ageFactors(s) {
  const age = clamp(Number(s.age ?? 0.5), 0, 1);

  // GROWTH: height/trunkRadius sliders define the FULL-GROWN tree; age moves
  // the tree along its growth curve so dragging the slider plays out a life —
  // sapling shooting up, girth thickening for the whole span. Height
  // saturates by mid-life (age 0.5 = exactly the sliders, so mature presets
  // are unchanged) and even shrinks a touch in old age (crown retrenchment);
  // girth keeps growing, which produces the squat ancient look by itself.
  const rise = clamp(age / 0.5, 0, 1);
  const smooth = rise * rise * (3 - 2 * rise);
  const heightGrowth = age < 0.5 ? lerp(0.2, 1, smooth) : 1 - (age - 0.5) * 0.08;
  const girthGrowth = age < 0.5 ? lerp(0.26, 1, rise) : 1 + (age - 0.5) * 1.7;
  // Young trees carry fewer foliage masses, not just smaller ones.
  const leafGrowth = lerp(0.35, 1, clamp(age / 0.45, 0, 1));

  // Trees taller than ~15m GROWN height blend toward giant proportions:
  // near-columnar shaft with a distinct basal flare zone — scaled-up cone
  // taper is what makes a big tree read as "small tree, enlarged".
  const giant = clamp((Number(s.height) * heightGrowth - 15) / 25, 0, 1);
  return {
    age,
    giant,
    heightGrowth,
    girthGrowth,
    leafGrowth,
    flare: (1 + (age - 0.5) * 0.9) * (1 + giant * 0.6),
    wobble: lerp(0.4, 1.9, age) * (1 - giant * 0.5),
    taperPower: lerp(1.0, 0.7, age) * (1 - giant * 0.6),
    rxMult: lerp(0.8, 1.25, age),
    ryMult: lerp(1.25, 0.75, age),
    droopAdd: (age - 0.5) * 0.5,
    crownShift: lerp(-0.1, 0.06, age),
    // Plank buttress flanges: rainforest giants and ancient veterans.
    buttress: 0.32 * giant + 0.14 * Math.max(0, (age - 0.75) / 0.25),
  };
}

/**
 * The trunk as a curved, tapered poly-line. A seeded S-bend plus a root flare
 * replaces what used to be a perfectly straight cone.
 */
function buildSpine(s, rand, profile, fx) {
  const samples = 8 + Number(s.detail) * 3;
  const lean = Number(s.lean);
  const phase = rand() * Math.PI * 2;
  const wobble = (0.4 + rand() * 0.6) * s.height * 0.035 * fx.wobble;
  // Conifers keep a visible leader spike; broadleaf trunks taper away to
  // nothing so no bare stick pokes out of the top of the crown.
  const tipRadius = s.species === 'pine' ? 0.14 : 0.04;

  const spine = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1);
    // Lean accelerates with height so the base stays planted and vertical.
    const bend = lean * s.height * 0.55 * t ** 1.5;
    const sway = Math.sin(t * Math.PI * 1.3 + phase) * wobble * t;

    let radius = s.trunkRadius * ((1 - t) ** (0.85 * fx.taperPower) * (1 - tipRadius) + tipRadius);
    // Root flare, spread over the bottom quarter so it spans several rings of
    // the tube. A narrower zone lands on a single sample and renders as a
    // ledge — the trunk looks like it is wearing a boot.
    if (t < 0.24) radius *= 1 + 0.62 * fx.flare * ((0.24 - t) / 0.24) ** 1.7;

    spine.push({
      p: new THREE.Vector3(bend + sway, s.height * t, sway * 0.6),
      r: radius,
    });
  }
  return spine;
}

/**
 * Cut the trunk off at the top of the crown. Broadleaf trunks that run past
 * their own foliage leave a bare spike sticking out of the canopy — visible in
 * silhouette even when the radius is hairline-thin.
 */
function trimSpine(spine, maxY) {
  const out = [];
  for (let i = 0; i < spine.length; i += 1) {
    if (spine[i].p.y <= maxY) {
      out.push(spine[i]);
      continue;
    }
    const prev = spine[i - 1];
    if (prev) {
      const f = (maxY - prev.p.y) / (spine[i].p.y - prev.p.y || 1);
      out.push({ p: prev.p.clone().lerp(spine[i].p, f), r: lerp(prev.r, spine[i].r, f) });
    }
    break;
  }
  return out.length >= 2 ? out : spine;
}

function spineAt(spine, t) {
  const x = clamp(t, 0, 1) * (spine.length - 1);
  const i = Math.min(spine.length - 2, Math.floor(x));
  const f = x - i;
  return {
    p: spine[i].p.clone().lerp(spine[i + 1].p, f),
    r: lerp(spine[i].r, spine[i + 1].r, f),
  };
}

/**
 * A branch as a quadratic curve from start to end, sampled into a poly-line,
 * with gravity applied along its length. Curving branches rather than straight
 * cylinders is most of what makes the result look grown instead of assembled.
 */
function curveBranch(start, end, bow, droop, samples) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const length = dir.length();
  const mid = start.clone().addScaledVector(dir, 0.5).addScaledVector(new THREE.Vector3(0, 1, 0), bow * length);
  const points = [];
  for (let i = 0; i < samples; i += 1) {
    const u = i / (samples - 1);
    // Quadratic Bezier through the raised midpoint.
    const p = start
      .clone()
      .multiplyScalar((1 - u) ** 2)
      .addScaledVector(mid, 2 * (1 - u) * u)
      .addScaledVector(end, u ** 2);
    p.y -= droop * length * u ** 2;
    points.push(p);
  }
  return points;
}

/** Highest point of a branch path — how far up the limb reaches. */
function peakY(branch) {
  let y = -Infinity;
  for (const p of branch.points) y = Math.max(y, p.y);
  return y;
}

/**
 * WINTER TWIGS: on a bare tree (leafDensity 0) every terminal recurses one
 * extra depth into 2-3 short, thin twigs instead of placing a foliage anchor.
 * The first twig is the parent's continuation (merged into its tube by the
 * mesher); the others start at the tip — on the parent's centerline — and fan
 * off it, so even leafless the no-floating-geometry rule holds.
 */
function sproutTwigs(ctx, parentId, tip, along, radius, depth) {
  const { s, rand, branches } = ctx;
  const count = 2 + (rand() < 0.45 ? 1 : 0);
  for (let k = 0; k < count; k += 1) {
    const a = rand() * Math.PI * 2;
    const fan = k === 0 ? 0.25 : 0.6 + rand() * 0.35;
    const dir = along
      .clone()
      .addScaledVector(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), fan)
      .add(new THREE.Vector3(0, 0.18, 0))
      .normalize();
    const len = (0.5 + rand() * 0.5) * clamp(s.height * 0.07, 0.2, 1.1);
    const end = tip.clone().addScaledVector(dir, len);
    branches.push({
      points: curveBranch(tip.clone(), end, 0.03, 0.12, 3),
      radius: Math.max(radius * 0.55, 0.012),
      endRadius: 0.008,
      depth: depth + 1,
      parent: parentId,
      terminal: true,
      twig: true,
      cont: k === 0,
    });
  }
}

/**
 * Build the skeleton for one tree.
 *
 * Returns { spine, branches, anchors, crown, profile }, where every anchor is
 * the tip of some branch in `branches`.
 */
export function buildSkeleton(params) {
  const fx = ageFactors(params);
  // Everything downstream sees the GROWN dimensions, so crown clamps, blob
  // sizing, branch reach and giant blending all scale with the life stage.
  const s = {
    ...params,
    height: Number(params.height) * fx.heightGrowth,
    trunkRadius: Number(params.trunkRadius) * fx.girthGrowth,
  };
  const rand = rng(Number(s.seed));
  const baseProfile = SPECIES_PROFILES[s.species] ?? SPECIES_PROFILES.round;

  // Age reshapes the species profile: droop grows, the crown sinks and
  // flattens, and saplings are too young to have forked into leaders at all.
  // A broken-top snag keeps a single pole: the break IS the silhouette, and a
  // fork below a 70% break would leave stubs fighting the shear for attention.
  const profile = {
    ...baseProfile,
    droop: baseProfile.droop + fx.droopAdd,
    crownStart: clamp(baseProfile.crownStart + fx.crownShift, 0.15, 0.8),
    crownY: clamp(baseProfile.crownY + fx.crownShift * 0.5, 0.3, 0.95),
    split: fx.age < 0.35 || s.brokenTop ? null : baseProfile.split,
  };
  let spine = buildSpine(s, rand, profile, fx);

  // Crown size is clamped RELATIVE to height at both ends: wider than 0.42h
  // swallows the trunk and reads as a bush; narrower than 0.12h leaves a
  // pinhead crown on a giant whose leaf masses cannot even cover the trunk
  // tip. Between those bounds canopySize passes through untouched.
  const canopy = clamp(Number(s.canopySize), Number(s.height) * 0.12, Number(s.height) * 0.42);
  const spread = Number(s.branchSpread);
  // Vary the crown itself per seed, not just the branch jitter inside it.
  // Without this every seed of a species shares one silhouette and the
  // generator only appears to be random.
  const vary = (amount) => 1 + (rand() - 0.5) * amount;
  const rx = canopy * profile.rx * lerp(0.75, 1.15, clamp(spread / 2.2, 0, 1)) * vary(0.26) * fx.rxMult;
  const ry = canopy * profile.ry * vary(0.26) * fx.ryMult;
  const crownCentre = spineAt(spine, clamp(profile.crownY + (rand() - 0.5) * 0.07, 0.3, 0.95)).p.clone();
  if (profile.split) spine = trimSpine(spine, Number(s.height) * profile.split.at);
  // Curtain species trim deeper: their masses are narrow strands on the hull,
  // so a trunk reaching the apex pokes out between them as a bare twig.
  else if (s.species !== 'pine') spine = trimSpine(spine, crownCentre.y + ry * (profile.curtain ? 0.5 : 0.85));

  // SNAG: a storm-broken top. The trunk stops at ~70% of its height and the
  // final ring keeps ~40% of the local radius instead of tapering to a point —
  // a blunt shear face, tilted sideways by a short offset stub so the flat cap
  // reads as a jagged break rather than a chainsaw cut. The tilt phase is
  // hashed from the seed (like bark fluting) so no rand() draw shifts the
  // stream of any tree built without brokenTop.
  if (s.brokenTop) {
    spine = trimSpine(spine, s.height * 0.7);
    const last = spine[spine.length - 1];
    const jag = ((Number(s.seed) % 83) / 83) * Math.PI * 2;
    spine.push({
      p: last.p.clone().add(new THREE.Vector3(
        Math.cos(jag) * last.r * 0.45,
        last.r * 0.7,
        Math.sin(jag) * last.r * 0.45
      )),
      r: last.r * 0.4,
    });
  }

  const branches = [];
  const anchors = [];
  const maxDepth = 2 + Number(s.detail);
  // WINTER/BARE MODE: leafDensity 0 means no foliage at all. The branch
  // machinery still runs (with a synthetic quota, see buildBroadleaf) and each
  // terminal recurses one extra depth into fine twigs instead of placing an
  // anchor — the fine outer web is what carries a leafless silhouette.
  const bare = Number(s.leafDensity) <= 0;
  const leafCount = bare ? 0 : Math.max(1, Math.round(Number(s.leafDensity) * fx.leafGrowth));

  if (s.species === 'pine') {
    buildConifer({ s, rand, spine, profile, branches, anchors, crownCentre, bare });
  } else {
    buildBroadleaf({
      s, rand, spine, profile, branches, anchors,
      crownCentre, rx, ry, maxDepth, leafCount, bare,
    });
  }

  // Root spurs: short surface roots sagging from the base to the ground.
  // Mature and old trees only — saplings haven't earned them — and drawn LAST
  // so the extra rand() calls don't shift any of the randomness above (the
  // same seed keeps the same tree, plus roots).
  if (fx.age >= 0.35 && Number(s.detail) >= 1) {
    const at = spineAt(spine, 0.04);
    const count = 3 + (fx.giant > 0.3 ? 1 : 0);
    for (let i = 0; i < count; i += 1) {
      const a = GOLDEN * i + rand() * 0.6;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      // Short and stout: surface roots hug the trunk. Long thin spurs read as
      // spider legs. Tips sink slightly below grade so they end IN the ground.
      const reach = at.r * (1.0 + rand() * 0.55) * (1 + fx.age * 0.35);
      const end = at.p.clone().addScaledVector(dir, reach).setY(-0.04);
      branches.push({
        points: curveBranch(at.p.clone(), end, -0.1, 0, 3),
        radius: at.r * 0.34,
        endRadius: at.r * 0.14,
        depth: 0,
        parent: -1,
        terminal: false,
        root: true,
      });
    }
  }

  // STAG-HEAD DEADWOOD: ancient broadleaf trees carry a few bare tapered
  // spikes rising above the crown from the topmost primaries — the classic
  // retrenchment cue of a veteran tree. Drawn AFTER the root spurs so the
  // extra rand() calls extend the stream instead of shifting it: an existing
  // seed keeps its exact tree, plus spikes. The mesher names these
  // dead_branch_N and the diagnostics exempt them from the sticks-in-air test
  // (ending in open air is their entire point).
  if (s.species !== 'pine' && fx.age >= 0.78) {
    const limbs = branches
      .filter((b) => b.depth === 0 && !b.root && !b.twig)
      .sort((a, b) => peakY(b) - peakY(a));
    const crownTop = crownCentre.y + ry;
    const count = Math.min(limbs.length, 2 + Math.floor(rand() * 3)); // 2-4
    for (let i = 0; i < count; i += 1) {
      const limb = limbs[i];
      const idx = clamp(
        Math.round((0.55 + rand() * 0.3) * (limb.points.length - 1)),
        1, limb.points.length - 1
      );
      const start = limb.points[idx].clone(); // ON the limb centerline
      // Length scales with crown height; the end is pushed above the crown
      // hull so the spike actually breaks the silhouette.
      const len = crownTop * (0.17 + rand() * 0.1);
      const a = rand() * Math.PI * 2;
      const end = new THREE.Vector3(
        start.x + Math.cos(a) * len * 0.3,
        Math.max(start.y + len * 0.85, crownTop + len * 0.45),
        start.z + Math.sin(a) * len * 0.3
      );
      const u = idx / (limb.points.length - 1);
      const atR = lerp(limb.radius, limb.endRadius, u);
      // Thick enough at the base to read at a distance — a hairline spike
      // disappears against the crown and the cue is lost.
      branches.push({
        points: curveBranch(start, end, 0.03, -0.02, 4),
        radius: Math.max(Math.min(atR * 0.75, limb.radius), 0.05),
        endRadius: 0.008, // tapers to a point — a dead spike, not a limb
        depth: 1,
        parent: branches.indexOf(limb),
        terminal: false,
        dead: true,
      });
    }
  }

  // AERIAL ROOTS: the strangler-fig cue. Giant grown broadleaves (>20m, the
  // giant blend) that are old enough drop a few near-straight vertical tubes
  // from major limbs to the ground. Ends sink below grade (y < 0) so the
  // diagnostics' existing ground rule (endpoints at y <= 0.25 are supported by
  // the soil) covers them without change. Also drawn after all prior draws.
  if (s.species !== 'pine' && fx.age >= 0.6 && s.height > 20) {
    const limbs = branches.filter(
      (b) => b.depth === 0 && !b.root && !b.twig && !b.dead && peakY(b) > s.height * 0.3
    );
    if (limbs.length) {
      const count = 2 + Math.floor(rand() * 3); // 2-4
      for (let i = 0; i < count; i += 1) {
        const limb = limbs[i % limbs.length];
        const idx = clamp(
          Math.round((0.45 + rand() * 0.4) * (limb.points.length - 1)),
          1, limb.points.length - 1
        );
        const start = limb.points[idx].clone(); // ON the limb centerline
        if (start.y < s.height * 0.2) continue; // too low to read as aerial
        const end = new THREE.Vector3(
          start.x + (rand() - 0.5) * 0.4,
          -0.05,
          start.z + (rand() - 0.5) * 0.4
        );
        const radius = Math.max(0.05, s.trunkRadius * 0.08);
        branches.push({
          // Near-straight: barely bowed, no droop — a taut hanging root.
          points: curveBranch(start, end, 0.015, 0, 4),
          radius,
          endRadius: radius * 0.85,
          depth: 0,
          parent: branches.indexOf(limb),
          terminal: false,
          aerial: true,
        });
      }
    }
  }

  return {
    spine,
    branches,
    anchors,
    crown: { centre: crownCentre, rx, ry, exponent: profile.exponent },
    profile,
    // Plank buttress flanges at the base of giants and ancient veterans; the
    // mesher turns this into a star-shaped base cross-section that rounds out
    // to circular by `fadeT` of trunk height.
    buttress: fx.buttress > 0.03
      ? { amount: fx.buttress, lobes: 5, phase: rand() * Math.PI * 2, fadeT: 0.16 }
      : null,
    params: s,
  };
}

/**
 * Divide the trunk into fanning leaders. Returns the leaders, each with the
 * poly-line the crown branches will hang off, or an empty list for species
 * that keep a single trunk.
 */
function buildLeaders(ctx) {
  const { s, rand, spine, profile, branches, crownCentre, rx } = ctx;
  const split = profile.split;
  if (!split) return [];

  // The trunk has already been cut off at the fork, so its last sample is the
  // point every leader grows from.
  const foot = spine[spine.length - 1];
  const leaders = [];
  const phase = rand() * Math.PI * 2;

  for (let i = 0; i < split.count; i += 1) {
    // Leaders are spaced evenly around the trunk, not golden-angled: a fork is
    // a small number of limbs balancing each other, not a spiral.
    const a = phase + (i / split.count) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const reach = rx * split.spread * (0.8 + rand() * 0.4);
    const end = foot.p
      .clone()
      .addScaledVector(dir, reach)
      .setY(lerp(foot.p.y, crownCentre.y, split.rise * (0.85 + rand() * 0.3)));

    // Bowed outward and up, so the fork reads as a V rather than a splay.
    const points = curveBranch(foot.p.clone(), end, 0.12, -0.06, 4);
    const id = branches.length;
    // The first leader is the trunk's continuation: the mesher extrudes trunk
    // and leader as one ground-to-crown tube, so the fork has no cap ledge.
    // The others start on the trunk's centerline and emerge through its flank.
    const cont = i === 0;
    const radius = foot.r * (cont ? 0.92 : 0.72);
    const endRadius = foot.r * (cont ? 0.52 : 0.44);
    branches.push({
      points,
      radius,
      endRadius,
      depth: 0,
      parent: -1,
      terminal: false,
      leader: true,
      trunkCont: cont,
    });
    leaders.push({ id, points, dir, radius: endRadius });
  }
  return leaders;
}

function buildBroadleaf(ctx) {
  const { s, rand, spine, profile, branches, anchors, crownCentre, rx, ry, maxDepth, leafCount } = ctx;
  const primaries = clamp(Math.round(Number(s.branchCount)), 1, 24);
  const leaders = buildLeaders(ctx);

  // Curtain species spend one leaf on a round cap at the trunk apex. Their
  // other masses are narrow strands out on the hull, so without a cap the
  // trunk tip pokes through the top of the dome on some seeds — and how much
  // trimming would hide it varies seed by seed, while a cap always covers it.
  let budget = leafCount;
  if (ctx.bare) {
    // Bare/winter tree: no anchors will be placed, but the same quota
    // machinery must still grow a full branch hierarchy or the tree would be
    // a naked pole. Three "virtual leaves" per primary reproduces the depth a
    // mid-density leafy tree would have; grow() turns each would-be anchor
    // into fine twigs instead.
    budget = primaries * 3;
  } else if (profile.curtain && spine.length) {
    anchors.push(makeAnchor({ ...ctx, strandAmount: 0 }, spine[spine.length - 1].p, rand));
    budget = Math.max(1, leafCount - 1);
  }

  // Spread the leaf budget over the primaries so the tree ends up with exactly
  // leafDensity foliage masses however the hierarchy splits.
  const quotas = Array.from({ length: primaries }, (_, i) =>
    Math.floor(budget / primaries) + (i < budget % primaries ? 1 : 0)
  );

  // A flat-bottomed disc keeps every target on or above its equator — one
  // sagging pad under an acacia's umbrella reads as detached, not natural.
  const targets = crownDirections(primaries, rand, profile.flatBottom > 0.4 ? 0 : -0.5).map((dir) => {
    const r = hullRadius(dir, rx, ry, rx, profile.exponent, profile.lobe);
    const p = crownCentre.clone().addScaledVector(dir, r);
    if (profile.flatBottom) {
      const floor = crownCentre.y - ry * (1 - profile.flatBottom);
      p.y = Math.max(p.y, floor);
    }
    return p;
  });

  // With leaders, branches hang off whichever leader is heading their way.
  // Attachment order is decided per leader, not globally: every leader must
  // carry a branch at its very end, or its tip pokes out of the crown as a
  // bare stick.
  const pickLeader = (target) => {
    const dir = new THREE.Vector3(target.x - crownCentre.x, 0, target.z - crownCentre.z).normalize();
    return leaders.reduce((best, l) => (l.dir.dot(dir) > best.dir.dot(dir) ? l : best), leaders[0]);
  };
  const perLeader = new Map(leaders.map((l) => [l, []]));
  if (leaders.length) {
    targets.forEach((target, i) => {
      if (quotas[i] > 0) perLeader.get(pickLeader(target)).push(i);
    });
  }
  const alongFor = new Map();
  for (const assigned of perLeader.values()) {
    assigned.forEach((i, j) => {
      // Last branch of each leader sits at its tip; a single branch goes
      // straight to the tip.
      alongFor.set(i, assigned.length === 1 ? 1 : lerp(0.5, 1, j / (assigned.length - 1)));
    });
  }

  targets.forEach((target, i) => {
    if (quotas[i] === 0) return;

    let at;
    let parent = -1;
    let continues = false;
    if (leaders.length) {
      const leader = pickLeader(target);
      const along = alongFor.get(i) ?? 1;
      const idx = clamp(Math.round(along * (leader.points.length - 1)), 1, leader.points.length - 1);
      at = { p: leader.points[idx], r: leader.radius };
      parent = leader.id;
      // The branch at the leader's very tip is its continuation — flush, full
      // cross-section — so the leader flows into the crown instead of ending
      // in a capped stump with a thinner branch glued on.
      continues = along === 1;
    } else {
      // Primaries leave the trunk between crownStart and just below the top,
      // ordered so the outermost targets attach lowest — the way real limbs do.
      const t = clamp(
        lerp(profile.crownStart, 0.92, (i + 0.5) / primaries) + (rand() - 0.5) * 0.1,
        profile.crownStart * 0.9,
        0.96
      );
      at = spineAt(spine, t);
    }

    // Every branch starts exactly ON its parent's centerline: it is either
    // merged into the parent tube (continuation) or begins strictly inside it
    // and emerges through the flank. Nothing can start in open air.
    grow({
      ...ctx,
      start: at.p.clone(),
      target,
      quota: quotas[i],
      depth: 0,
      maxDepth,
      radius: at.r * (continues ? 0.96 : leaders.length ? 0.7 : 0.52),
      parent,
      cont: continues,
    });
  });

  // A leader every target snubbed still cannot end bare — cap it with a leaf
  // mass of its own (or, on a winter tree, let it break up into twigs).
  for (const [leader, assigned] of perLeader) {
    if (assigned.length) continue;
    const tip = leader.points[leader.points.length - 1];
    if (ctx.bare) {
      const along = new THREE.Vector3(leader.dir.x, 0.6, leader.dir.z).normalize();
      sproutTwigs(ctx, leader.id, tip.clone(), along, leader.radius, 0);
      continue;
    }
    const anchor = makeAnchor(ctx, tip, rand);
    anchors.push(anchor);
    branches[leader.id].anchorRef = anchor;
  }
}

/**
 * Recursively grow a branch toward `target`, splitting its foliage quota
 * between children until each terminal tip carries exactly one leaf mass.
 */
function grow(ctx) {
  const { s, rand, profile, branches, anchors, start, target, quota, depth, maxDepth, radius, parent } = ctx;

  const terminal = quota <= 1 || depth >= maxDepth;

  // Species with a curtain drop their outer tips. Doing it here, before the
  // branch is curved, makes the whole limb arc down into the hanging mass —
  // dropping the tip afterwards would leave the branch above it bare.
  let aim = target;
  let strandAmount = 0;
  // Curtain drop is skipped on bare trees: strand length is derived from leaf
  // mass size, which is meaningless with zero leaves — the winter droop comes
  // from the twigs instead.
  if (terminal && profile.curtain && !ctx.bare) {
    const out = Math.hypot(target.x - ctx.crownCentre.x, target.z - ctx.crownCentre.z);
    const outward = clamp(out / (ctx.rx || 1), 0, 1);
    strandAmount = outward;
    aim = target.clone();
    // Tight jitter: strands of wildly different lengths read as damage, and
    // one long straggler ruins an otherwise even curtain.
    aim.y -= outward ** 1.2 * profile.curtain * s.height * 0.3 * (0.72 + rand() * 0.32);
    // Never let the curtain reach the ground: a willow that swallows its own
    // trunk stops reading as a tree at all. The floor allows for the strand
    // hanging below the tip, not just the tip itself.
    const strand = baseLeafRadius(ctx) * (0.6 + Number(s.leafShape) * 0.7) * profile.leafAspect;
    aim.y = Math.max(aim.y, s.height * 0.3 + strand);
  }

  // Intermediate branches cover part of the distance; terminals finish the job
  // so their tip lands on the crown hull.
  const portion = terminal ? 1 : lerp(0.52, 0.75, depth / Math.max(1, maxDepth));
  const end = start.clone().lerp(aim, portion);

  const rise = depth === 0 ? profile.rise : profile.rise * 0.35;
  const bow = rise * 0.22 - (depth > 0 ? 0.04 : 0);
  const droop = profile.droop * (0.4 + depth * 0.45);
  const samples = terminal && profile.curtain ? 4 : terminal ? 3 : 4;
  const points = curveBranch(start, end, bow, droop, samples);

  const endRadius = radius * (terminal ? 0.45 : 0.68);
  const id = branches.length;
  branches.push({
    points,
    radius,
    endRadius,
    depth,
    parent,
    terminal,
    // Continuation of its parent: starts flush at the parent's last point and
    // carries the cross-section on. The mesher merges these chains into one
    // continuous tube, which is what makes junction seams impossible.
    cont: !!ctx.cont,
  });

  const tip = points[points.length - 1];

  if (terminal) {
    if (ctx.bare) {
      // Winter/bare mode: recurse ONE extra depth into fine twigs instead of
      // placing a foliage anchor — see sproutTwigs.
      const along = new THREE.Vector3().subVectors(tip, points[points.length - 2]).normalize();
      sproutTwigs(ctx, id, tip, along, endRadius, depth);
      return;
    }
    // Depth ran out before the quota did (few branches, dense foliage): clump
    // the remainder around this tip rather than losing the leaf budget.
    const clump = Math.max(1, quota);
    for (let c = 0; c < clump; c += 1) {
      const at = tip.clone();
      if (c > 0) {
        const spill = ctx.rx * 0.13;
        at.x += (rand() - 0.5) * spill;
        at.y += (rand() - 0.5) * spill * 0.8;
        at.z += (rand() - 0.5) * spill;
      }
      const anchor = makeAnchor({ ...ctx, strandAmount }, at, rand);
      anchors.push(anchor);
      // Lets the mesher drop branches that are entirely swallowed by their own
      // leaf mass — invisible geometry that still costs triangles. The whole
      // anchor is stored because the decision needs the mass's real shape: a
      // flattened pad covers far less of a vertical twig than its radius says.
      if (c === 0) branches[id].anchorRef = anchor;
    }
    return;
  }

  // A limb does not end where its children begin — it CONTINUES. One child is
  // the continuation: it starts flush at the tip, keeps almost the parent's
  // cross-section, and aims close to the parent's own target. The others are
  // side shoots that emerge from the parent's flank a sample before the tip,
  // thinner (roughly the Da Vinci residual of the cross-section the
  // continuation kept). Splitting the radius evenly among equal children left
  // a capped stump with twigs glued to it at every junction — geometrically
  // connected, visually broken.
  const kids = quota >= 3 && rand() > 0.45 ? 3 : 2;
  const shares = splitQuota(quota, kids, rand).sort((a, b) => b - a);
  const contRadius = endRadius * 0.92;
  const sideRadius = Math.max(endRadius * 0.55, 0.012);
  const flank = points[points.length - 2];

  // Children aim at points scattered around the parent's target, further out.
  const axis = new THREE.Vector3().subVectors(target, start).normalize();
  const side = new THREE.Vector3(-axis.z, 0, axis.x).normalize();
  const up = new THREE.Vector3().crossVectors(axis, side).normalize();
  const scatter = ctx.rx * lerp(0.55, 0.16, depth / Math.max(1, maxDepth)) * Number(s.branchSpread) * 0.6;

  for (let k = 0; k < kids; k += 1) {
    if (shares[k] === 0) continue;
    const isCont = k === 0;
    const a = (k / kids) * Math.PI * 2 + rand() * 1.4;
    const spread2 = scatter * (isCont ? 0.3 : 1);
    const jitter = side
      .clone()
      .multiplyScalar(Math.cos(a) * spread2)
      .addScaledVector(up, Math.sin(a) * spread2 * 0.7);
    grow({
      ...ctx,
      start: (isCont ? tip : flank).clone(),
      target: target.clone().add(jitter),
      quota: shares[k],
      depth: depth + 1,
      radius: isCont ? contRadius : sideRadius,
      parent: id,
      cont: isCont,
    });
  }
}

function splitQuota(quota, kids, rand) {
  const shares = new Array(kids).fill(Math.floor(quota / kids));
  let rest = quota % kids;
  while (rest > 0) {
    shares[Math.floor(rand() * kids) % kids] += 1;
    rest -= 1;
  }
  return shares;
}

/**
 * A foliage anchor: where a leaf mass sits, how big it is, and how exposed to
 * the sun it is. `exposure` is what lets the palette read as lighting instead
 * of being sprayed on by index.
 */
/**
 * Size leaf masses so neighbours overlap into a single crown surface. Mean
 * spacing of N points on a hull of radius R goes as R/sqrt(N); the constant is
 * tuned so adjacent masses merge without the crown becoming a smooth ball.
 */
function baseLeafRadius(ctx) {
  const { s, rx, ry } = ctx;
  const count = Math.max(1, Number(s.leafDensity));
  const meanR = (rx * 2 + ry) / 3;
  return ((2.68 * meanR) / Math.sqrt(count)) * Number(s.leafSize);
}

function makeAnchor(ctx, point, rand) {
  const { s, profile, crownCentre, ry } = ctx;
  const variation = Number(s.leafVariation);
  const radius = baseLeafRadius(ctx) * (1 - variation * 0.3 + rand() * variation * 0.6);

  const dir = new THREE.Vector3().subVectors(point, crownCentre).normalize();
  const height = clamp((point.y - (crownCentre.y - ry)) / (ry * 2 || 1), 0, 1);
  // Blend "faces the sun" with "is high in the crown" — both are reasons a leaf
  // mass would be bright. Sun direction dominates: weighting height too hard
  // stacks every highlight on the crown's apex, which from above reads as a
  // yellow bullseye instead of light falling across one side.
  const exposure = clamp(0.5 + dir.dot(SUN) * 0.52 + (height - 0.5) * 0.18, 0, 1);

  // On a curtain species the leaf mass is drawn out into a strand in
  // proportion to how far the tip fell — inner masses stay rounded and form
  // the dome, outer ones become long and narrow.
  const drawn = profile.curtain ? clamp(ctx.strandAmount ?? 0, 0, 1) : 1;
  const aspect = lerp(1, profile.leafAspect, drawn);

  // A strand hangs from its branch rather than balancing on the tip. Lifting
  // the centre lets the upper half swallow the descending limb, which would
  // otherwise show through the curtain as a bare twig.
  const seat = point.clone();
  if (drawn > 0 && aspect > 1) {
    seat.y += radius * (0.6 + Number(s.leafShape) * 0.7) * aspect * 0.35;
  }

  return {
    p: seat,
    radius: Math.max(0.05, radius),
    aspect,
    width: lerp(1, profile.leafWidth ?? 1, drawn),
    exposure,
    spin: rand() * Math.PI * 2,
    tilt: (rand() - 0.5) * 0.5,
  };
}

/**
 * Conifers are built from whorls rather than a crown hull: rings of downswept
 * branches up the trunk, each carrying a skirt of foliage. The old version
 * buried its branches inside the cones where they cost triangles and showed
 * nothing; here the branches poke through the skirt edge.
 */
function buildConifer(ctx) {
  const { s, rand, spine, profile, branches, anchors } = ctx;
  const whorls = clamp(Math.round(Number(s.leafDensity) / 4), 4, 14);
  const perWhorl = clamp(Math.round(Number(s.branchCount) / 3), 2, 6);
  const base = profile.crownStart;
  // Narrower than a stylised "Christmas tree": photographed Picea abies runs
  // roughly a third as wide as it is tall.
  const canopy = Number(s.canopySize) * Number(s.branchSpread) * 0.72;

  for (let i = 0; i < whorls; i += 1) {
    const t = i / Math.max(1, whorls - 1);
    const h = lerp(base, 0.95, t);
    const at = spineAt(spine, h);
    // Skirts shrink toward the top; the lowest is widest.
    const reach = canopy * (1.0 - t * 0.72) * (0.9 + rand() * 0.2);

    for (let k = 0; k < perWhorl; k += 1) {
      const a = GOLDEN * (i * perWhorl + k) + rand() * 0.3;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      // Start on the trunk's centerline so the whorl branch is buried at its
      // root and emerges through the bark.
      const start = at.p.clone();
      // Deliberately long enough to pierce the skirt's sloped side — the tick
      // of a branch tip breaking the cone is what keeps the pine from reading
      // as stacked lampshades — while staying above the bottom rim, where a
      // tip would dangle in open air. The 0.88/0.16 pair also keeps the chord
      // safely past the mesher's swallowed-twig cull; an earlier 0.78/0.30
      // survived that cull by 0.2% and quietly died when retuned.
      const end = start.clone().addScaledVector(dir, reach * 0.88).setY(at.p.y - reach * 0.16);
      const id = branches.length;
      branches.push({
        points: curveBranch(start, end, -0.05, profile.droop * 0.5, 3),
        radius: at.r * 0.34,
        endRadius: at.r * 0.1,
        depth: 0,
        parent: -1,
        terminal: true,
        // A bare conifer has no skirt to be swallowed by — keep the branch.
        leafRadius: ctx.bare ? 0 : reach,
      });
      // Winter/bare: the whorl branch tips break up into fine twigs, same as
      // broadleaf terminals do. Use the real curved tip, not the pre-droop end.
      if (ctx.bare) {
        const pts = branches[id].points;
        sproutTwigs(ctx, id, pts[pts.length - 1].clone(), dir, at.r * 0.1, 0);
      }
    }

    // Bare tree: whorl structure only, no foliage skirts.
    if (ctx.bare) continue;

    // One conical skirt per whorl, wide enough to contain its whorl's branches.
    anchors.push({
      p: new THREE.Vector3(at.p.x, at.p.y, at.p.z),
      radius: reach,
      aspect: 1,
      exposure: clamp(0.25 + t * 0.7, 0, 1),
      spin: rand() * Math.PI * 2,
      tilt: 0,
      skirt: true,
      height: Math.max(0.4, s.height * (0.19 - t * 0.07) * (0.7 + Number(s.leafShape) * 0.6)),
    });
  }
}
