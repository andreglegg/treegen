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
    // Wide, heavy, flat-crowned, with pronounced lobes.
    crownY: 0.76, rx: 0.84, ry: 0.36, exponent: 3.1, crownStart: 0.44,
    rise: 0.34, droop: 0.3, curtain: 0, lobe: 0.16, flatBottom: 0.3, leafAspect: 0.85,
  },
  acacia: {
    // The umbrella: branches rise steeply then flatten, crown is a thin disc
    // with a flat underside.
    crownY: 0.87, rx: 0.98, ry: 0.19, exponent: 4.5, crownStart: 0.56,
    rise: 1.0, droop: -0.1, curtain: 0, lobe: 0.07, flatBottom: 0.62, leafAspect: 0.7,
  },
  willow: {
    // Tall dome over a hanging curtain. The curtain is what makes a willow,
    // but it has to fall from a crown that is already clear of the ground.
    crownY: 0.86, rx: 0.7, ry: 0.4, exponent: 2.1, crownStart: 0.52,
    rise: 0.5, droop: 0.6, curtain: 0.62, lobe: 0.06, flatBottom: 0, leafAspect: 1.7,
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
 * The trunk as a curved, tapered poly-line. A seeded S-bend plus a root flare
 * replaces what used to be a perfectly straight cone.
 */
function buildSpine(s, rand, profile) {
  const samples = 8 + Number(s.detail) * 3;
  const lean = Number(s.lean);
  const phase = rand() * Math.PI * 2;
  const wobble = (0.4 + rand() * 0.6) * s.height * 0.035;
  // Conifers keep a visible leader spike; broadleaf trunks taper away to
  // nothing so no bare stick pokes out of the top of the crown.
  const tipRadius = s.species === 'pine' ? 0.14 : 0.04;

  const spine = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1);
    // Lean accelerates with height so the base stays planted and vertical.
    const bend = lean * s.height * 0.55 * t ** 1.5;
    const sway = Math.sin(t * Math.PI * 1.3 + phase) * wobble * t;

    let radius = s.trunkRadius * ((1 - t) ** 0.85 * (1 - tipRadius) + tipRadius);
    // Root flare: a quick widening in the bottom tenth.
    if (t < 0.1) radius *= 1 + 0.85 * ((0.1 - t) / 0.1) ** 2;

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

/**
 * Build the skeleton for one tree.
 *
 * Returns { spine, branches, anchors, crown, profile }, where every anchor is
 * the tip of some branch in `branches`.
 */
export function buildSkeleton(params) {
  const s = params;
  const rand = rng(Number(s.seed));
  const profile = SPECIES_PROFILES[s.species] ?? SPECIES_PROFILES.round;
  let spine = buildSpine(s, rand, profile);

  // A crown wider than the tree is tall swallows the trunk and the result
  // reads as a bush. Only binds on short trees; at the default height and
  // above, canopySize passes through untouched.
  const canopy = Math.min(Number(s.canopySize), Number(s.height) * 0.42);
  const spread = Number(s.branchSpread);
  // Vary the crown itself per seed, not just the branch jitter inside it.
  // Without this every seed of a species shares one silhouette and the
  // generator only appears to be random.
  const vary = (amount) => 1 + (rand() - 0.5) * amount;
  const rx = canopy * profile.rx * lerp(0.75, 1.15, clamp(spread / 2.2, 0, 1)) * vary(0.26);
  const ry = canopy * profile.ry * vary(0.26);
  const crownCentre = spineAt(spine, clamp(profile.crownY + (rand() - 0.5) * 0.07, 0.3, 0.95)).p.clone();
  if (s.species !== 'pine') spine = trimSpine(spine, crownCentre.y + ry * 0.85);

  const branches = [];
  const anchors = [];
  const maxDepth = 2 + Number(s.detail);
  const leafCount = Math.max(1, Math.round(Number(s.leafDensity)));

  if (s.species === 'pine') {
    buildConifer({ s, rand, spine, profile, branches, anchors, crownCentre });
  } else {
    buildBroadleaf({
      s, rand, spine, profile, branches, anchors,
      crownCentre, rx, ry, maxDepth, leafCount,
    });
  }

  return {
    spine,
    branches,
    anchors,
    crown: { centre: crownCentre, rx, ry, exponent: profile.exponent },
    profile,
    params: s,
  };
}

function buildBroadleaf(ctx) {
  const { s, rand, spine, profile, branches, anchors, crownCentre, rx, ry, maxDepth, leafCount } = ctx;
  const primaries = clamp(Math.round(Number(s.branchCount)), 1, 24);

  // Spread the leaf budget over the primaries so the tree ends up with exactly
  // leafDensity foliage masses however the hierarchy splits.
  const quotas = Array.from({ length: primaries }, (_, i) =>
    Math.floor(leafCount / primaries) + (i < leafCount % primaries ? 1 : 0)
  );

  const targets = crownDirections(primaries, rand, profile.flatBottom > 0.4 ? -0.15 : -0.5).map((dir) => {
    const r = hullRadius(dir, rx, ry, rx, profile.exponent, profile.lobe);
    const p = crownCentre.clone().addScaledVector(dir, r);
    if (profile.flatBottom) {
      const floor = crownCentre.y - ry * (1 - profile.flatBottom);
      p.y = Math.max(p.y, floor);
    }
    return p;
  });

  targets.forEach((target, i) => {
    if (quotas[i] === 0) return;
    // Primaries leave the trunk between crownStart and just below the top,
    // ordered so the outermost targets attach lowest — the way real limbs do.
    const t = clamp(
      lerp(profile.crownStart, 0.92, (i + 0.5) / primaries) + (rand() - 0.5) * 0.1,
      profile.crownStart * 0.9,
      0.96
    );
    const at = spineAt(spine, t);
    const outward = new THREE.Vector3(target.x - at.p.x, 0, target.z - at.p.z).normalize();
    const start = at.p.clone().addScaledVector(outward, at.r * 0.6);

    grow({
      ...ctx,
      start,
      target,
      quota: quotas[i],
      depth: 0,
      maxDepth,
      radius: at.r * 0.52,
      parent: -1,
    });
  });
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
  if (terminal && profile.curtain) {
    const out = Math.hypot(target.x - ctx.crownCentre.x, target.z - ctx.crownCentre.z);
    const outward = clamp(out / (ctx.rx || 1), 0, 1);
    aim = target.clone();
    aim.y -= outward ** 1.2 * profile.curtain * s.height * 0.3 * (0.6 + rand() * 0.6);
    // Never let the curtain reach the ground: a willow that swallows its own
    // trunk stops reading as a tree at all.
    aim.y = Math.max(aim.y, s.height * 0.36);
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
  });

  const tip = points[points.length - 1];

  if (terminal) {
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
      const anchor = makeAnchor(ctx, at, rand);
      anchors.push(anchor);
      // Lets the mesher drop branches that are entirely swallowed by their own
      // leaf mass — invisible geometry that still costs triangles.
      if (c === 0) branches[id].leafRadius = anchor.radius;
    }
    return;
  }

  // Da Vinci's rule: the children's cross-sections sum to the parent's, so
  // joints look load-bearing rather than arbitrary.
  const kids = quota >= 3 && rand() > 0.45 ? 3 : 2;
  const childRadius = endRadius / Math.sqrt(kids);
  const shares = splitQuota(quota, kids, rand);

  // Children aim at points scattered around the parent's target, further out.
  const axis = new THREE.Vector3().subVectors(target, start).normalize();
  const side = new THREE.Vector3(-axis.z, 0, axis.x).normalize();
  const up = new THREE.Vector3().crossVectors(axis, side).normalize();
  const scatter = ctx.rx * lerp(0.55, 0.16, depth / Math.max(1, maxDepth)) * Number(s.branchSpread) * 0.6;

  for (let k = 0; k < kids; k += 1) {
    if (shares[k] === 0) continue;
    const a = (k / kids) * Math.PI * 2 + rand() * 1.4;
    const jitter = side
      .clone()
      .multiplyScalar(Math.cos(a) * scatter)
      .addScaledVector(up, Math.sin(a) * scatter * 0.7);
    grow({
      ...ctx,
      start: tip.clone(),
      target: target.clone().add(jitter),
      quota: shares[k],
      depth: depth + 1,
      radius: childRadius,
      parent: id,
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
function makeAnchor(ctx, point, rand) {
  const { s, profile, crownCentre, rx, ry } = ctx;
  const count = Math.max(1, Number(s.leafDensity));
  const variation = Number(s.leafVariation);

  // Size masses so neighbours overlap into a single crown surface. Mean
  // spacing on a hull of N points goes as R/sqrt(N); the constant is tuned so
  // adjacent masses merge without the crown turning into a smooth ball.
  const meanR = (rx * 2 + ry) / 3;
  const base = (2.55 * meanR) / Math.sqrt(count);
  const radius = base * Number(s.leafSize) * (1 - variation * 0.3 + rand() * variation * 0.6);

  const dir = new THREE.Vector3().subVectors(point, crownCentre).normalize();
  const height = clamp((point.y - (crownCentre.y - ry)) / (ry * 2 || 1), 0, 1);
  // Blend "faces the sun" with "is high in the crown" — both are reasons a leaf
  // mass would be bright. Centred on 0.5 so the base tone stays dominant and
  // the accents read as light rather than as a second canopy colour.
  const exposure = clamp(0.5 + dir.dot(SUN) * 0.45 + (height - 0.5) * 0.35, 0, 1);

  return {
    p: point.clone(),
    radius: Math.max(0.05, radius),
    aspect: profile.leafAspect,
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
  const canopy = Number(s.canopySize) * Number(s.branchSpread) * 0.85;

  for (let i = 0; i < whorls; i += 1) {
    const t = i / Math.max(1, whorls - 1);
    const h = lerp(base, 0.95, t);
    const at = spineAt(spine, h);
    // Skirts shrink toward the top; the lowest is widest.
    const reach = canopy * (1.0 - t * 0.72) * (0.9 + rand() * 0.2);

    for (let k = 0; k < perWhorl; k += 1) {
      const a = GOLDEN * (i * perWhorl + k) + rand() * 0.3;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const start = at.p.clone().addScaledVector(dir, at.r * 0.5);
      // Branches stop short of the skirt rim. Letting them through turns the
      // silhouette into a bundle of dead spikes.
      const end = start.clone().addScaledVector(dir, reach * 0.78).setY(at.p.y - reach * 0.3);
      branches.push({
        points: curveBranch(start, end, -0.05, profile.droop * 0.5, 3),
        radius: at.r * 0.34,
        endRadius: at.r * 0.1,
        depth: 0,
        parent: -1,
        terminal: true,
        leafRadius: reach,
      });
    }

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
