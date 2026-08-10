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
import { exportGlb, exportObj } from './export.js';

const SPECIES = ['round', 'oak', 'acacia', 'willow', 'pine', 'birch', 'poplar', 'palm', 'baobab'];
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
  height: z.number().min(2).max(50).optional().describe('Metres. Above ~15m the trunk blends toward columnar giant proportions'),
  trunkRadius: z.number().min(0.15).max(2.5).optional(),
  branchCount: z.number().int().min(4).max(18).optional(),
  branchSpread: z.number().min(0.45).max(2.2).optional(),
  canopySize: z.number().min(0.9).max(8).optional(),
  age: z.number().min(0).max(1).optional().describe('0 sapling, 0.5 mature, 1 ancient — drives slenderness, crown shape, droop, flare, gnarl, buttressing'),
  leafDensity: z.number().int().min(8).max(64).optional().describe('Number of foliage clusters'),
  leafShape: z.number().min(0.15).max(1).optional().describe('Leaf roundness'),
  leafStyle: z.enum(LEAF_STYLES).optional(),
  leafSize: z.number().min(0.45).max(1.7).optional(),
  leafVariation: z.number().min(0).max(1).optional(),
  detail: z.number().int().min(0).max(2).optional().describe('0 low-poly, 1 game-ready, 2 hero'),
  lean: z.number().min(0).max(0.55).optional(),
  leafPalette: z.number().int().min(0).max(8).optional(),
  barkPalette: z.number().int().min(0).max(6).optional(),
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
