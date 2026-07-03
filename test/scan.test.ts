import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const hasPython =
  spawnSync('python3', ['--version']).status === 0 || spawnSync('python', ['--version']).status === 0;
import { scan } from '../src/index.js';
import type { ScanResult } from '../src/types.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/proj');

let result: ScanResult;

beforeAll(async () => {
  result = await scan(FIXTURE);
});

const has = (check: string, msgPart?: string) =>
  result.findings.some((f) => f.check === check && (!msgPart || f.message.includes(msgPart)));

describe('example verification', () => {
  it('flags phantom named exports', () => {
    expect(has('missing-export', 'fakeFn')).toBe(true);
  });

  it('does not flag real exports', () => {
    expect(result.findings.some((f) => f.check === 'missing-export' && f.message.includes('realFn'))).toBe(false);
    expect(result.findings.some((f) => f.check === 'missing-export' && f.message.includes('REAL_CONST'))).toBe(false);
  });

  it('flags subpaths missing from the exports map', () => {
    expect(has('bad-subpath', 'fixture-pkg/utils')).toBe(true);
  });

  it('flags invalid JSON blocks', () => {
    expect(has('data', 'invalid JSON')).toBe(true);
  });

  it('flags invalid YAML blocks', () => {
    expect(has('data', 'invalid YAML')).toBe(true);
  });

  it('flags genuinely broken syntax', () => {
    expect(result.findings.some((f) => f.check === 'syntax' && f.severity === 'error')).toBe(true);
  });

  it('warns on TypeScript syntax inside js blocks', () => {
    expect(has('syntax', 'TypeScript-only')).toBe(true);
  });

  it('skips partial examples instead of failing them', () => {
    const partial = result.files.flatMap((f) => f.blocks).find((b) => b.value.includes('app.use('));
    expect(partial?.skipped).toBeTruthy();
  });

  it('accepts fluent chains, spec notation, html comments and alternatives', () => {
    const syntaxErrors = result.findings.filter((f) => f.check === 'syntax' && f.severity === 'error');
    // `function broken( {`, the missing-comma block, and (with python) `def bro_ken(:`
    expect(syntaxErrors).toHaveLength(hasPython ? 3 : 2);
  });

  it.skipIf(!hasPython)('verifies python blocks with doctest/fragment/magic tolerance', () => {
    const pythonFindings = result.findings.filter((f) => f.message.startsWith('Python:'));
    expect(pythonFindings).toHaveLength(1); // only `def bro_ken(:`
    expect(pythonFindings[0].snippet).toContain('bro_ken');
  });

  it('accepts jsonc conventions inside json blocks', () => {
    expect(result.findings.some((f) => f.check === 'data' && f.message.includes('jsonc'))).toBe(false);
    const dataErrors = result.findings.filter((f) => f.check === 'data' && f.severity === 'error');
    expect(dataErrors).toHaveLength(1); // the deliberately invalid JSON; YAML is warn-only
  });

  it('reports invalid YAML as a warning, not an error', () => {
    const yaml = result.findings.find((f) => f.check === 'data' && f.message.includes('YAML'));
    expect(yaml?.severity).toBe('warning');
  });

  it('skips intentionally incorrect examples via context', () => {
    const block = result.files.flatMap((f) => f.blocks).find((b) => b.value.includes('= = 2'));
    expect(block?.skipped).toBe('intentionally incorrect example');
  });

  it('skips docrot-ignore blocks', () => {
    const ignored = result.files.flatMap((f) => f.blocks).find((b) => b.value.includes('definitely not valid'));
    expect(ignored?.skipped).toBeTruthy();
  });

  it('reports unknown imports as info only', () => {
    const finding = result.findings.find((f) => f.check === 'unknown-import' && f.message.includes('express'));
    expect(finding?.severity).toBe('info');
  });
});

describe('package refs', () => {
  it('flags scripts that do not exist', () => {
    expect(has('missing-script', 'deploy')).toBe(true);
  });

  it('accepts scripts that exist and skips usage placeholders', () => {
    const missing = result.findings.filter((f) => f.check === 'missing-script');
    expect(missing).toHaveLength(2); // `deploy` (unfixable) and `biuld` (fixable)
    const fixable = missing.find((f) => f.message.includes('biuld'));
    expect(fixable?.fix).toEqual({ search: 'biuld', replace: 'build' });
  });

  it('warns on lookalike install names', () => {
    expect(has('install-name', 'fixture-pk')).toBe(true);
  });

  it('warns on lookalike npx bins', () => {
    expect(has('unknown-bin', 'fixtur')).toBe(true);
  });
});

describe('links', () => {
  it('flags broken relative links', () => {
    expect(has('broken-link', 'nope.md')).toBe(true);
  });

  it('flags missing anchors', () => {
    expect(has('missing-anchor', 'instalation')).toBe(true);
  });

  it('flags missing images', () => {
    expect(has('missing-image', 'logo.png')).toBe(true);
  });

  it('accepts valid links and anchors', () => {
    expect(result.findings.some((f) => f.check === 'broken-link' && f.message.includes('guide.md`'))).toBe(false);
    expect(result.findings.some((f) => f.check === 'missing-anchor' && f.message.includes('getting-started'))).toBe(false);
    expect(result.findings.some((f) => f.check === 'missing-anchor' && f.message.includes('#usage'))).toBe(false);
  });
});

describe('stats', () => {
  it('counts broken blocks and computes severity totals', () => {
    expect(result.stats.errors).toBeGreaterThan(0);
    expect(result.stats.brokenBlocks).toBeGreaterThan(0);
    expect(result.stats.checkedBlocks).toBeGreaterThan(0);
    expect(result.stats.skippedBlocks).toBeGreaterThanOrEqual(2);
  });
});
