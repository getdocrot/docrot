import fs from 'node:fs';
import path from 'node:path';
import { discoverMarkdown } from './discover.js';
import { parseDoc } from './extract.js';
import { loadProject } from './project.js';
import { runChecks, VERIFIABLE_LANGS } from './checks/index.js';
import type { DocFile, Finding, ScanOptions, ScanResult } from './types.js';

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

export async function scan(rootInput: string, options: ScanOptions = {}): Promise<ScanResult> {
  const started = Date.now();
  const root = path.resolve(rootInput);
  const project = loadProject(root);
  const { files, skippedChangelogs } = await discoverMarkdown(root, options);

  const docs: DocFile[] = [];
  for (const rel of files) {
    const abs = path.join(root, rel);
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    docs.push(parseDoc(abs, rel, content));
  }

  const findings: Finding[] = runChecks(project, docs, options);
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );

  const blocks = docs.flatMap((d) => d.blocks);
  const verifiable = blocks.filter((b) => VERIFIABLE_LANGS.has(b.norm));
  const verifiableIds = new Set(verifiable.map((b) => `${b.file}:${b.fenceLine}`));
  const skippedBlocks = verifiable.filter((b) => b.skipped).length;
  const brokenBlocks = new Set(
    findings
      .filter((f) => f.severity === 'error' && f.blockId && verifiableIds.has(f.blockId))
      .map((f) => f.blockId as string),
  ).size;

  return {
    root,
    project,
    files: docs,
    findings,
    stats: {
      files: docs.length,
      blocks: blocks.length,
      checkedBlocks: verifiable.length - skippedBlocks,
      skippedBlocks,
      brokenBlocks,
      skippedChangelogs,
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
      infos: findings.filter((f) => f.severity === 'info').length,
      durationMs: Date.now() - started,
    },
  };
}

export { healthGrade, renderGitHub, renderJson, renderTerminal, summaryLine } from './report.js';
export { applyFixes } from './fix.js';
export type { AppliedFix, FixOutcome } from './fix.js';
export * from './types.js';
