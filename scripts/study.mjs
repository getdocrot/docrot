#!/usr/bin/env node
// docrot study — scan the top npm packages' repositories for documentation rot.
//
// Usage:
//   node scripts/study.mjs --count 50 [--offset 0] [--out study-results]
//                          [--concurrency 4] [--install]
//
// Methodology:
//   - "top packages" = npm-high-impact (top npm packages by download counts)
//   - one GitHub repo is scanned once even when it publishes many packages
//   - shallow clones; monorepo packages scan their repository.directory
//   - docrot --json, errors and warnings recorded; infos ignored
//   - --install runs `npm install --ignore-scripts` first so export checks
//     can resolve types fully (slower; without it unresolved-type findings
//     are downgraded to warnings by docrot itself)

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { npmHighImpact } from 'npm-high-impact';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist/cli.js');

const args = process.argv.slice(2);
const flagValue = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const COUNT = Number(flagValue('count', 30));
const OFFSET = Number(flagValue('offset', 0));
const OUT = path.resolve(String(flagValue('out', 'study-results')));
const CONCURRENCY = Number(flagValue('concurrency', 4));
const INSTALL = args.includes('--install');

fs.mkdirSync(path.join(OUT, 'repos'), { recursive: true });

async function registryMeta(name) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
  if (!res.ok) throw new Error(`registry ${res.status}`);
  return res.json();
}

function githubRepo(meta) {
  const raw = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url;
  if (!raw) return null;
  const m = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[#?].*)?$/i.exec(raw);
  return m ? { slug: m[1], directory: meta.repository?.directory ?? null } : null;
}

const seenRepos = new Set();

async function scanRepo(slug, directory) {
  const dest = path.join(OUT, 'repos', slug.replace(/\//g, '__'));
  if (!fs.existsSync(dest)) {
    await exec('git', ['clone', '--quiet', '--depth', '1', `https://github.com/${slug}.git`, dest], {
      timeout: 180_000,
    });
  }
  if (INSTALL) {
    try {
      await exec(
        'npm',
        ['install', '--ignore-scripts', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund'],
        { cwd: dest, timeout: 300_000 },
      );
    } catch {
      // partial installs are fine; docrot downgrades unresolved-type findings
    }
  }
  const scanPath = directory ? path.join(dest, directory) : dest;
  const target = fs.existsSync(scanPath) ? scanPath : dest;
  const { stdout } = await exec(process.execPath, [CLI, target, '--json', '--fail-on', 'never'], {
    timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function studyOne(pkg) {
  try {
    const meta = await registryMeta(pkg);
    const repo = githubRepo(meta);
    if (!repo) return { pkg, skipped: 'no github repository' };
    const key = `${repo.slug.toLowerCase()}|${repo.directory ?? ''}`;
    if (seenRepos.has(key)) return { pkg, skipped: `same repo already scanned (${repo.slug})` };
    seenRepos.add(key);
    const report = await scanRepo(repo.slug, repo.directory);
    const errors = report.findings.filter((f) => f.severity === 'error');
    const warnings = report.findings.filter((f) => f.severity === 'warning');
    return {
      pkg,
      repo: repo.slug,
      directory: repo.directory,
      grade: report.grade,
      stats: report.stats,
      errorCount: errors.length,
      warningCount: warnings.length,
      findings: [...errors, ...warnings].slice(0, 40),
    };
  } catch (err) {
    return { pkg, failed: String(err?.message ?? err).slice(0, 200) };
  }
}

const list = npmHighImpact.slice(OFFSET, OFFSET + COUNT);
console.log(`docrot study — ${list.length} packages (offset ${OFFSET}), install=${INSTALL}`);
const results = [];
let cursor = 0;

async function worker() {
  while (cursor < list.length) {
    const pkg = list[cursor++];
    const r = await studyOne(pkg);
    results.push(r);
    const tag = r.failed
      ? `FAIL (${r.failed})`
      : r.skipped
        ? `skip (${r.skipped})`
        : `grade ${r.grade} · ${r.errorCount} errors · ${r.warningCount} warnings`;
    console.log(`[${results.length}/${list.length}] ${pkg} — ${tag}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const scanned = results.filter((r) => r.stats);
const withErrors = scanned.filter((r) => r.errorCount > 0);
const withAny = scanned.filter((r) => r.errorCount + r.warningCount > 0);
const byCheck = {};
for (const r of scanned) {
  for (const f of r.findings) byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;
}

const summary = {
  generatedAt: new Date().toISOString(),
  sample: list.length,
  offset: OFFSET,
  installed: INSTALL,
  scanned: scanned.length,
  withErrors: withErrors.length,
  withAnyFinding: withAny.length,
  pctWithErrors: scanned.length ? Math.round((100 * withErrors.length) / scanned.length) : 0,
  pctWithAnyFinding: scanned.length ? Math.round((100 * withAny.length) / scanned.length) : 0,
  byCheck,
  results: results.sort((a, b) => (b.errorCount ?? -1) - (a.errorCount ?? -1)),
};
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(summary, null, 2));

const lines = [
  `# docrot study — top ${OFFSET + 1}–${OFFSET + list.length} npm packages`,
  '',
  `Scanned ${scanned.length} unique repositories. **${summary.pctWithErrors}% have at least one hard error** in their docs; ${summary.pctWithAnyFinding}% have at least one finding.`,
  '',
  '| package | repo | grade | errors | warnings | blocks checked |',
  '| --- | --- | --- | --- | --- | --- |',
  ...scanned.map(
    (r) =>
      `| ${r.pkg} | ${r.repo} | ${r.grade} | ${r.errorCount} | ${r.warningCount} | ${r.stats.checkedBlocks} |`,
  ),
  '',
  '## Findings by check',
  '',
  ...Object.entries(byCheck)
    .sort((a, b) => b[1] - a[1])
    .map(([check, n]) => `- \`${check}\`: ${n}`),
  '',
  '## Most interesting findings',
  '',
];
for (const r of scanned.filter((x) => x.errorCount > 0).slice(0, 15)) {
  lines.push(`### ${r.pkg} (${r.repo}) — ${r.errorCount} errors`);
  for (const f of r.findings.filter((f) => f.severity === 'error').slice(0, 3)) {
    lines.push(`- \`${f.file}:${f.line}\` [${f.check}] ${f.message}`);
  }
  lines.push('');
}
fs.writeFileSync(path.join(OUT, 'REPORT.md'), lines.join('\n'));

console.log(`\nresults: ${path.join(OUT, 'results.json')}`);
console.log(`report:  ${path.join(OUT, 'REPORT.md')}`);
console.log(
  `headline: ${summary.pctWithErrors}% of scanned top-npm repos have at least one hard docs error (${withErrors.length}/${scanned.length})`,
);
