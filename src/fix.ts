import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { scan } from './index.js';
import { SNIPPET_FRIENDLY_CODES } from './checks/syntax.js';
import type { CodeBlock, Finding, ScanOptions, ScanResult } from './types.js';

export interface AppliedFix {
  file: string;
  line: number;
  check: string;
  before: string;
  after: string;
}

export interface FixOutcome {
  applied: AppliedFix[];
  /** Files restored because they scanned worse after fixing. */
  reverted: string[];
  /** Post-fix scan (null on dry runs or when nothing was written). */
  rescan: ScanResult | null;
}

const COMMA_MSG = "',' expected.";
const FIXABLE_LANGS = new Set(['js', 'jsx', 'ts', 'tsx']);

function transpileErrors(code: string, fileName: string): ts.Diagnostic[] {
  const result = ts.transpileModule(code, {
    reportDiagnostics: true,
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
  });
  return (result.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error && !SNIPPET_FRIENDLY_CODES.has(d.code),
  );
}

// Insert commas exactly where the parser expects them — but only claim
// success if the block ends up parsing clean.
function insertCommas(value: string, norm: string): string | null {
  const fileName = norm === 'ts' ? 'snippet.ts' : norm === 'tsx' ? 'snippet.tsx' : 'snippet.jsx';
  let current = value;
  let changed = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const errors = transpileErrors(current, fileName);
    if (!errors.length) return changed ? current : null;
    const target = errors.find(
      (d) =>
        typeof d.start === 'number' &&
        ts.flattenDiagnosticMessageText(d.messageText, ' ') === COMMA_MSG,
    );
    if (!target) return null;
    let pos = target.start as number;
    while (pos > 0 && /\s/.test(current[pos - 1])) pos--;
    current = current.slice(0, pos) + ',' + current.slice(pos);
    changed = true;
  }
  return null;
}

export async function applyFixes(
  result: ScanResult,
  options: ScanOptions & { dryRun?: boolean } = {},
): Promise<FixOutcome> {
  const blocks = new Map<string, CodeBlock>();
  for (const doc of result.files) {
    for (const block of doc.blocks) blocks.set(`${block.file}:${block.fenceLine}`, block);
  }

  const perFile = new Map<string, Finding[]>();
  for (const finding of result.findings) {
    const block = finding.blockId ? blocks.get(finding.blockId) : undefined;
    const commaCandidate =
      finding.check === 'syntax' &&
      finding.message === COMMA_MSG &&
      block !== undefined &&
      FIXABLE_LANGS.has(block.norm);
    if (finding.fix || commaCandidate) {
      const arr = perFile.get(finding.file) ?? [];
      arr.push(finding);
      perFile.set(finding.file, arr);
    }
  }

  const applied: AppliedFix[] = [];
  const originals = new Map<string, string>();
  const fixedFiles: string[] = [];

  for (const [rel, fixFindings] of perFile) {
    const abs = path.join(result.root, rel);
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    let touched = false;
    const doneBlocks = new Set<string>();

    for (const finding of fixFindings) {
      if (finding.fix) {
        const idx = finding.line - 1;
        const lineText = lines[idx];
        if (lineText !== undefined && lineText.includes(finding.fix.search)) {
          const after = lineText.replace(finding.fix.search, finding.fix.replace);
          if (after !== lineText) {
            applied.push({
              file: rel,
              line: finding.line,
              check: finding.check,
              before: lineText.trim(),
              after: after.trim(),
            });
            lines[idx] = after;
            touched = true;
          }
        }
        continue;
      }
      if (!finding.blockId || doneBlocks.has(finding.blockId)) continue;
      doneBlocks.add(finding.blockId);
      const block = blocks.get(finding.blockId);
      if (!block) continue;
      const fixedValue = insertCommas(block.value, block.norm);
      if (!fixedValue) continue;
      const start = block.contentStartLine - 1;
      const oldLines = block.value.split('\n');
      const newLines = fixedValue.split('\n');
      const regionIntact = lines.slice(start, start + oldLines.length).join('\n') === block.value;
      if (newLines.length !== oldLines.length || !regionIntact) continue;
      for (let i = 0; i < newLines.length; i++) {
        if (lines[start + i] !== newLines[i]) {
          applied.push({
            file: rel,
            line: start + i + 1,
            check: 'syntax',
            before: lines[start + i].trim(),
            after: newLines[i].trim(),
          });
          lines[start + i] = newLines[i];
        }
      }
      touched = true;
    }

    if (touched && !options.dryRun) {
      originals.set(abs, content);
      fs.writeFileSync(abs, lines.join('\n'));
      fixedFiles.push(rel);
    }
  }

  if (options.dryRun || !fixedFiles.length) {
    return { applied, reverted: [], rescan: null };
  }

  // Safety net: a fix must never make a file scan worse. Revert offenders.
  const { dryRun: _dryRun, ...scanOptions } = options;
  let rescan = await scan(result.root, scanOptions);
  const errorsIn = (r: ScanResult, file: string): number =>
    r.findings.filter((f) => f.file === file && f.severity === 'error').length;
  const reverted: string[] = [];
  for (const rel of fixedFiles) {
    if (errorsIn(rescan, rel) > errorsIn(result, rel)) {
      const abs = path.join(result.root, rel);
      const original = originals.get(abs);
      if (original !== undefined) {
        fs.writeFileSync(abs, original);
        reverted.push(rel);
      }
    }
  }
  if (reverted.length) rescan = await scan(result.root, scanOptions);

  return {
    applied: applied.filter((a) => !reverted.includes(a.file)),
    reverted,
    rescan,
  };
}
