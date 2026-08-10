#!/usr/bin/env node
// Treegen MCP server — exposes the stylized tree generator as MCP tools so an
// agent (Claude Code, Codex, ...) can generate game-ready tree assets and write
// them to disk as GLB / OBJ / preset JSON.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildTree, meshStats, presets, randomParams } from './generator.js';
import { exportGlb, exportObj, exportGameGlb, exportForestGlb } from './export.js';
import { mergeTree } from './merge.js';

const SPECIES = ['round', 'oak', 'acacia', 'willow', 'pine'];
const LEAF_STYLES = ['clustered', 'angular', 'rounded', 'flat', 'needles'];
const FORMATS = ['glb', 'obj', 'json'];
const DEFAULT_OUT = path.resolve(process.cwd(), 'treegen-out');

// Build the tree + write the requested format, returning a summary object.
async function generate(params, { format = 'glb', outPath } = {}) {
  if (!FORMATS.includes(format)) throw new Error(`Unknown format "${format}". Use one of: ${FORMATS.join(', ')}`);
  const group = buildTree(params);
  const s = { ...presets.meadow, ...params };
  const stats = meshStats(group);

  const fileName = `treegen_${s.species}_${s.seed}.${format}`;
  const target = outPath ? path.resolve(outPath) : path.join(DEFAULT_OUT, fileName);
  await fs.mkdir(path.dirname(target), { recursive: true });

  if (format === 'glb') await fs.writeFile(target, Buffer.from(await exportGlb(group)));
  else if (format === 'obj') await fs.writeFile(target, exportObj(group), 'utf8');
  else await fs.writeFile(target, JSON.stringify(s, null, 2), 'utf8');

  return { path: target, format, species: s.species, seed: s.seed, meshes: stats.meshes, triangles: stats.triangles };
}

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: 'treegen', version: '1.0.0' });

const paramShape = {
  species: z.enum(SPECIES).optional().describe('Tree species / silhouette'),
  seed: z.number().int().min(1).max(999999).optional().describe('Deterministic seed — same seed reproduces the same tree'),
  height: z.number().min(3).max(10).optional(),
  trunkRadius: z.number().min(0.18).max(0.9).optional(),
  branchCount: z.number().int().min(4).max(18).optional(),
  branchSpread: z.number().min(0.45).max(2.2).optional(),
  canopySize: z.number().min(0.9).max(3.6).optional(),
  leafDensity: z.number().int().min(8).max(64).optional().describe('Number of foliage clusters'),
  leafShape: z.number().min(0.15).max(1).optional().describe('Leaf roundness'),
  leafStyle: z.enum(LEAF_STYLES).optional(),
  leafSize: z.number().min(0.45).max(1.7).optional(),
  leafVariation: z.number().min(0).max(1).optional(),
  detail: z.number().int().min(0).max(2).optional().describe('0 low-poly, 1 game-ready, 2 hero'),
  lean: z.number().min(0).max(0.55).optional(),
  leafPalette: z.number().int().min(0).max(7).optional(),
  barkPalette: z.number().int().min(0).max(5).optional(),
};

server.registerTool(
  'generate_tree',
  {
    title: 'Generate tree',
    description:
      'Generate a stylized low-poly tree and write it to disk. Start from a preset (optional) and override any params. Writes GLB (default), OBJ, or preset JSON, and returns the file path plus mesh/triangle counts.',
    inputSchema: {
      preset: z.enum(Object.keys(presets)).optional().describe('Preset to start from before applying overrides'),
      format: z.enum(FORMATS).optional().describe('Output format (default glb)'),
      outPath: z.string().optional().describe('Full output file path; defaults to ./treegen-out/<name>'),
      ...paramShape,
    },
  },
  async ({ preset, format, outPath, ...params }) => {
    const base = preset ? presets[preset] : {};
    const result = await generate({ ...base, ...params }, { format, outPath });
    return ok(result);
  }
);

server.registerTool(
  'random_tree',
  {
    title: 'Random tree',
    description: 'Roll a random seed and shape (mirrors the app\'s "Random variation") and generate a tree.',
    inputSchema: {
      species: z.enum(SPECIES).optional(),
      rollSeed: z.number().int().min(1).max(999999).optional().describe('Seed used to roll the random params (not the tree seed)'),
      format: z.enum(FORMATS).optional(),
      outPath: z.string().optional(),
    },
  },
  async ({ species, rollSeed, format, outPath }) => {
    const roll = randomParams(rollSeed ?? Math.floor(Date.now() % 999999) + 1);
    const params = { ...presets.meadow, ...roll };
    if (species) params.species = species;
    const result = await generate(params, { format, outPath });
    return ok({ ...result, rolledParams: roll });
  }
);

server.registerTool(
  'export_game_tree',
  {
    title: 'Export game-ready tree (LOD GLB)',
    description:
      'Generate a tree and export a game-ready GLB: the same params built at detail 2/1/0, each merged down to at most 2 vertex-colored meshes (bark + foliage), parented under nodes named LOD0/LOD1/LOD2. Engines wire LOD visibility ranges to those nodes; each LOD renders in <=2 draw calls.',
    inputSchema: {
      preset: z.enum(Object.keys(presets)).optional().describe('Preset to start from before applying overrides'),
      outPath: z.string().optional().describe('Full output file path; defaults to ./treegen-out/<name>'),
      ...paramShape,
    },
  },
  async ({ preset, outPath, ...params }) => {
    const base = preset ? presets[preset] : {};
    const merged = { ...base, ...params };
    const s = { ...presets.meadow, ...merged };
    const target = outPath
      ? path.resolve(outPath)
      : path.join(DEFAULT_OUT, `treegen_game_${s.species}_${s.seed}.glb`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(await exportGameGlb(merged)));
    const lod0 = meshStats(mergeTree(buildTree({ ...merged, detail: 2 })));
    return ok({ path: target, format: 'glb', species: s.species, seed: s.seed, lods: ['LOD0', 'LOD1', 'LOD2'], lod0Meshes: lod0.meshes, lod0Triangles: lod0.triangles });
  }
);

server.registerTool(
  'export_forest',
  {
    title: 'Export forest kit (GLB)',
    description:
      'Export a forest kit GLB: `count` merged trees (LOD0 only) seeded seedBase+i with ages jittered across agedSpread, laid out on a spaced grid under nodes tree_0..N. Engines cherry-pick individual tree_* nodes or place the whole kit. Deterministic: the same seedBase always produces the same forest.',
    inputSchema: {
      preset: z.enum(Object.keys(presets)).optional().describe('Preset to start from before applying overrides'),
      count: z.number().int().min(1).max(64).optional().describe('Number of trees in the kit (default 9)'),
      seedBase: z.number().int().min(1).max(999999).optional().describe('Base seed; tree i uses seedBase+i (default 1)'),
      agedSpread: z.number().min(0).max(0.6).optional().describe('Age jitter: each tree is scaled by 1 +/- agedSpread (default 0.35)'),
      outPath: z.string().optional().describe('Full output file path; defaults to ./treegen-out/<name>'),
      ...paramShape,
    },
  },
  async ({ preset, count, seedBase, agedSpread, outPath, ...params }) => {
    const base = preset ? presets[preset] : {};
    const merged = { ...base, ...params };
    const s = { ...presets.meadow, ...merged };
    const kit = { params: merged, count: count ?? 9, seedBase: seedBase ?? 1, agedSpread: agedSpread ?? 0.35 };
    const target = outPath
      ? path.resolve(outPath)
      : path.join(DEFAULT_OUT, `treegen_forest_${s.species}_${kit.seedBase}x${kit.count}.glb`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(await exportForestGlb(kit)));
    return ok({ path: target, format: 'glb', species: s.species, count: kit.count, seedBase: kit.seedBase, agedSpread: kit.agedSpread, nodes: `tree_0..tree_${kit.count - 1}` });
  }
);

server.registerTool(
  'list_presets',
  {
    title: 'List presets',
    description: 'List the built-in tree presets and their parameters.',
    inputSchema: {},
  },
  async () => ok(presets)
);

const transport = new StdioServerTransport();
await server.connect(transport);
