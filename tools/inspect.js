#!/usr/bin/env node
// Renders contact sheets of generated trees so tree quality can be reviewed as
// images instead of guessed at. Starts Vite in-process, drives headless
// Chromium at inspect.html, and writes PNGs plus numeric diagnostics.
//
//   npm run inspect                  -> inspect-out/
//   npm run inspect -- --out=name    -> inspect-out/name/
//   npm run inspect -- --legacy      -> renders mcp/generator.legacy.js instead,
//                                       so an old generator can be scored with
//                                       today's diagnostics
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = path.join(ROOT, 'inspect-out', outArg ? outArg.slice(6) : '');

const PRESETS = ['meadow', 'orchard', 'pine', 'oak', 'acacia', 'willow'];
const SEEDS = [4192, 1327, 3048];
const SPECIES = ['round', 'oak', 'acacia', 'willow', 'pine'];
const STYLES = ['clustered', 'angular', 'rounded', 'flat', 'needles'];

// Every numeric param the MCP schema exposes, with the bounds it permits. An
// agent is allowed to ask for these values, so degenerate output at either end
// is a real bug — this is what params.png sweeps.
const RANGES = {
  height: [3, 10],
  trunkRadius: [0.18, 0.9],
  branchCount: [4, 18],
  branchSpread: [0.45, 2.2],
  canopySize: [0.9, 3.6],
  leafDensity: [8, 64],
  leafShape: [0.15, 1],
  leafSize: [0.45, 1.7],
  leafVariation: [0, 1],
  lean: [0, 0.55],
};

const cell = (label, params, extra = {}) => ({ label, params, ...extra });

function sheetSpecs(presets) {
  const base = (name, seed) => ({ ...presets[name], ...(seed ? { seed } : {}) });
  const grid = (seeds) =>
    PRESETS.flatMap((p) => seeds.map((s) => cell(`${p} · ${s}`, base(p, s))));

  return [
    {
      file: 'species.png',
      title: 'Species & seeds',
      subtitle: 'do presets differ, and does each survive a seed change?',
      cols: 3,
      cellW: 340,
      cellH: 400,
      cells: grid(SEEDS),
    },
    {
      file: 'silhouette.png',
      title: 'Silhouette',
      subtitle: 'the "reads at 100m" test — shape only, no shading to hide behind',
      cols: 3,
      cellW: 300,
      cellH: 350,
      cells: grid(SEEDS).map((c) => ({ ...c, mode: 'silhouette' })),
    },
    {
      file: 'wireframe.png',
      title: 'Topology',
      subtitle: 'bark red, foliage green — branches ending in air and unsupported leaves show here',
      cols: 3,
      cellW: 340,
      cellH: 400,
      cells: grid(SEEDS.slice(0, 2)).map((c) => ({ ...c, mode: 'wireframe' })),
    },
    {
      file: 'angles.png',
      title: 'Rotation & overhead',
      subtitle: 'oak from five angles, then every species from directly above',
      cols: 5,
      cellW: 280,
      cellH: 330,
      cells: [
        ...[0, 72, 144, 216, 288].map((az) =>
          cell(`oak · ${az}°`, base('oak'), { view: { azimuth: az } })
        ),
        ...SPECIES.map((sp) =>
          cell(`${sp} · top`, { ...presets.meadow, species: sp }, { view: { elevation: 84 } })
        ),
      ],
    },
    {
      file: 'closeups.png',
      title: 'Closeups',
      subtitle: 'where defects hide: root flare, branch joins, branch tips, crown edge',
      cols: 4,
      cellW: 340,
      cellH: 340,
      cells: ['meadow', 'oak', 'acacia'].flatMap((p) =>
        ['root', 'junction', 'tip', 'canopyEdge'].map((focus) =>
          cell(`${p} · ${focus}`, base(p), { view: { focus } })
        )
      ),
    },
    {
      file: 'params.png',
      title: 'Parameter extremes',
      subtitle: 'both ends of every range the MCP schema accepts',
      cols: 5,
      cellW: 250,
      cellH: 300,
      cells: [
        ...Object.entries(RANGES).flatMap(([key, [lo, hi]]) => [
          cell(`${key} = ${lo}`, { ...presets.meadow, [key]: lo }),
          cell(`${key} = ${hi}`, { ...presets.meadow, [key]: hi }),
        ]),
        ...[0, 1, 2].map((d) => cell(`detail = ${d}`, { ...presets.meadow, detail: d })),
      ],
    },
    {
      file: 'styles.png',
      title: 'Foliage styles',
      subtitle: 'every leafStyle against three silhouettes',
      cols: 5,
      cellW: 250,
      cellH: 300,
      cells: ['round', 'oak', 'acacia'].flatMap((sp) =>
        STYLES.map((st) =>
          cell(`${sp} · ${st}`, { ...presets.meadow, species: sp, leafStyle: st })
        )
      ),
    },
  ];
}

async function main() {
  const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  const url = server.resolvedUrls.local[0];

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error('  page error:', e.message));

  const legacy = process.argv.includes('--legacy');
  await page.goto(`${url}inspect.html${legacy ? '?generator=legacy' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.inspectorReady === true, null, { timeout: 30000 });

  const presets = await page.evaluate(() => window.presets);
  await fs.mkdir(OUT, { recursive: true });

  const report = {};
  for (const spec of sheetSpecs(presets)) {
    const { file, ...rest } = spec;
    process.stdout.write(`  ${file} (${rest.cells.length} cells) ... `);
    const { png, stats } = await page.evaluate((s) => window.renderSheet(s), rest);
    await fs.writeFile(path.join(OUT, file), Buffer.from(png.split(',')[1], 'base64'));
    report[file] = stats;
    console.log('done');
  }

  await fs.writeFile(path.join(OUT, 'stats.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();

  const all = Object.values(report).flat();
  const sum = (k) => all.reduce((n, c) => n + c[k], 0);
  const worst = [...all].sort((a, b) => b.sticksInAir + b.floatingLeaves - (a.sticksInAir + a.floatingLeaves));

  console.log(`\n  ${all.length} trees rendered to ${path.relative(ROOT, OUT) || 'inspect-out'}/`);
  console.log(`  branches ending in air : ${sum('sticksInAir')}`);
  console.log(`  unsupported leaf masses: ${sum('floatingLeaves')}`);
  console.log(`  triangles  min/median/max: ${quantiles(all.map((c) => c.triangles)).join(' / ')}`);
  console.log('\n  worst offenders:');
  for (const c of worst.slice(0, 5)) {
    console.log(`    ${c.label.padEnd(20)} air ${String(c.sticksInAir).padStart(3)}  float ${String(c.floatingLeaves).padStart(3)}  ${c.triangles} tris`);
  }
}

function quantiles(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return [s[0], s[Math.floor(s.length / 2)], s[s.length - 1]];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
