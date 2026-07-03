import type { DocFile, Finding, ProjectInfo, ScanOptions } from '../types.js';
import { checkBlockSyntax } from './syntax.js';
import { classifyImport, extractImports } from './imports.js';
import { addSelfImport, checkSelfExports, type SelfImportGroup } from './exports.js';
import { checkLinks } from './links.js';
import { checkPkgRefs } from './pkgrefs.js';

const CODE_LANGS = new Set(['js', 'ts', 'jsx', 'tsx']);
const VERIFIABLE_LANGS = new Set(['js', 'ts', 'jsx', 'tsx', 'json', 'yaml']);

export function runChecks(project: ProjectInfo, docs: DocFile[], opts: ScanOptions): Finding[] {
  const findings: Finding[] = [];
  const checks = opts.checks ?? {};

  if (checks.examples !== false) {
    const selfGroups = new Map<string, SelfImportGroup>();
    for (const doc of docs) {
      for (const block of doc.blocks) {
        if (block.skipped) continue;
        if (VERIFIABLE_LANGS.has(block.norm)) {
          findings.push(...checkBlockSyntax(block));
        }
        if (!CODE_LANGS.has(block.norm)) continue;
        // Import lines are usually complete even in partial snippets, so this
        // runs even when the syntax pass just demoted the block to "skipped".
        for (const ref of extractImports(block)) {
          const classified = classifyImport(ref.specifier, project);
          if (classified.kind === 'self') {
            addSelfImport(selfGroups, classified.pkgDir, classified.subpath, ref);
          } else if (classified.kind === 'unknown') {
            findings.push({
              file: ref.file,
              line: ref.line,
              severity: 'info',
              check: 'unknown-import',
              message: `\`${classified.packageName}\` is not a dependency of this project (fine if the example is illustrative)`,
              blockId: ref.blockId,
            });
          }
        }
      }
    }
    if (selfGroups.size) {
      findings.push(...checkSelfExports(project, [...selfGroups.values()]));
    }
  }

  if (checks.links !== false) {
    findings.push(...checkLinks(docs, project.root));
  }

  if (checks.pkg !== false && project.pkg) {
    const shellBlocks = docs.flatMap((d) => d.blocks).filter((b) => b.norm === 'shell' && !b.skipped);
    findings.push(...checkPkgRefs(shellBlocks, project));
  }

  return findings;
}

export { VERIFIABLE_LANGS };
