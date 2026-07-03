#!/usr/bin/env node
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { applyFixes, healthGrade, scan } from './index.js';
import type { ScanResult } from './types.js';

const VERSION = '0.2.3';
const MAX_FINDINGS = 200;

function compact(result: ScanResult, max = MAX_FINDINGS) {
  const relevant = result.findings.filter((f) => f.severity !== 'info');
  return {
    root: result.root,
    grade: healthGrade(result),
    stats: result.stats,
    findings: relevant
      .slice(0, max)
      .map(({ file, line, severity, check, message }) => ({ file, line, severity, check, message })),
    truncated: relevant.length > max,
  };
}

function asText(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 1) }] };
}

const server = new McpServer({ name: 'docrot', version: VERSION });

server.registerTool(
  'scan_docs',
  {
    title: 'Scan docs for rot',
    description:
      'Verify the markdown documentation in a directory against its code: broken examples, ' +
      'imports of names the package does not export, dead relative links and anchors, missing ' +
      'npm scripts. Deterministic, offline, no LLM. Returns JSON findings with file:line.',
    inputSchema: {
      path: z.string().describe('Directory to scan (absolute, or relative to the server cwd)'),
      includeChangelogs: z
        .boolean()
        .optional()
        .describe('Also scan changelog-style files (default false)'),
    },
  },
  async ({ path: target, includeChangelogs }) => {
    const result = await scan(path.resolve(target), { includeChangelogs });
    return asText(compact(result));
  },
);

server.registerTool(
  'fix_docs',
  {
    title: 'Fix mechanical docs rot',
    description:
      'Repair high-confidence documentation rot: dead anchors with a single unambiguous target, ' +
      'lookalike script/install/bin names, docs-root style links, and missing commas that ' +
      'provably make the block parse. dryRun=true (the default) only previews; pass ' +
      'dryRun=false to write files. Any file that scans worse after fixing is reverted.',
    inputSchema: {
      path: z.string().describe('Directory to fix'),
      dryRun: z.boolean().optional().describe('Preview only, no writes (default true)'),
    },
  },
  async ({ path: target, dryRun }) => {
    const root = path.resolve(target);
    const preview = dryRun !== false;
    const result = await scan(root, {});
    const outcome = await applyFixes(result, { dryRun: preview });
    return asText({
      dryRun: preview,
      applied: outcome.applied,
      reverted: outcome.reverted,
      after: outcome.rescan ? compact(outcome.rescan, 50) : null,
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
