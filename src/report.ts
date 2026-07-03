import pc from 'picocolors';
import type { Finding, ScanResult } from './types.js';

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

export function healthGrade(result: ScanResult): string {
  const { checkedBlocks, brokenBlocks } = result.stats;
  if (!checkedBlocks) return '—';
  const ratio = (checkedBlocks - brokenBlocks) / checkedBlocks;
  if (ratio >= 0.99) return 'A+';
  if (ratio >= 0.97) return 'A';
  if (ratio >= 0.92) return 'B';
  if (ratio >= 0.8) return 'C';
  if (ratio >= 0.6) return 'D';
  return 'F';
}

function gradeColored(grade: string): string {
  if (grade.startsWith('A')) return pc.bold(pc.green(grade));
  if (grade === 'B' || grade === 'C') return pc.bold(pc.yellow(grade));
  if (grade === '—') return pc.bold(grade);
  return pc.bold(pc.red(grade));
}

function iconFor(f: Finding): string {
  if (f.severity === 'error') return pc.red('✖');
  if (f.severity === 'warning') return pc.yellow('⚠');
  return pc.cyan('ℹ');
}

export function renderTerminal(result: ScanResult, opts: { verbose?: boolean } = {}): string {
  const out: string[] = [''];
  const visible = result.findings.filter((f) => opts.verbose || f.severity !== 'info');
  const hiddenInfos = result.findings.length - visible.length;

  const byFile = new Map<string, Finding[]>();
  for (const f of visible) {
    const arr = byFile.get(f.file);
    if (arr) arr.push(f);
    else byFile.set(f.file, [f]);
  }

  for (const [file, findings] of byFile) {
    out.push(pc.bold(pc.underline(file)));
    for (const f of findings) {
      out.push(`  ${iconFor(f)} ${pc.dim(String(f.line).padStart(4))}  ${pc.dim(`[${f.check}]`)} ${f.message}`);
      if (f.snippet) out.push(pc.dim(`          › ${truncate(f.snippet, 96)}`));
    }
    out.push('');
  }

  const s = result.stats;
  const verified = Math.max(0, s.checkedBlocks - s.brokenBlocks);
  const summaryParts = [
    `${s.files} markdown file${s.files === 1 ? '' : 's'}`,
    `${s.blocks} code block${s.blocks === 1 ? '' : 's'}`,
    pc.green(`✔ ${verified} verified`),
  ];
  if (s.skippedBlocks) summaryParts.push(pc.dim(`◌ ${s.skippedBlocks} skipped (partial examples)`));
  if (s.brokenBlocks) summaryParts.push(pc.red(`✖ ${s.brokenBlocks} broken`));

  out.push(pc.dim('─'.repeat(62)));
  out.push(' ' + summaryParts.join(pc.dim(' · ')));

  const counts: string[] = [];
  counts.push(s.errors ? pc.red(`${s.errors} error${s.errors === 1 ? '' : 's'}`) : pc.green('0 errors'));
  counts.push(s.warnings ? pc.yellow(`${s.warnings} warning${s.warnings === 1 ? '' : 's'}`) : pc.dim('0 warnings'));
  if (hiddenInfos > 0) counts.push(pc.dim(`${hiddenInfos} notes hidden (-v to show)`));
  out.push(' ' + counts.join(pc.dim(' · ')) + pc.dim(` · ${(s.durationMs / 1000).toFixed(1)}s`));

  out.push('');
  out.push(` Docs health: ${gradeColored(healthGrade(result))}`);
  if (s.skippedChangelogs) {
    out.push(pc.dim(` (${s.skippedChangelogs} changelog file${s.skippedChangelogs === 1 ? '' : 's'} not scanned — --include-changelogs to include)`));
  }
  out.push('');
  return out.join('\n');
}

function escapeGithub(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function renderGitHub(result: ScanResult): string {
  let out = '';
  for (const f of result.findings) {
    if (f.severity === 'info') continue;
    const kind = f.severity === 'error' ? 'error' : 'warning';
    out += `::${kind} file=${f.file},line=${f.line},title=docrot(${f.check})::${escapeGithub(f.message)}\n`;
  }
  return out;
}

export function renderJson(result: ScanResult): string {
  return JSON.stringify(
    {
      root: result.root,
      grade: healthGrade(result),
      stats: result.stats,
      findings: result.findings,
    },
    null,
    2,
  );
}

export function summaryLine(result: ScanResult): string {
  const s = result.stats;
  return `docrot: ${s.errors} errors, ${s.warnings} warnings across ${s.files} files (grade ${healthGrade(result)})`;
}
