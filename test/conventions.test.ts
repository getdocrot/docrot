import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { scan } from '../src/index.js';
import type { ScanResult } from '../src/types.js';

const hasPython =
  spawnSync('python3', ['--version']).status === 0 || spawnSync('python', ['--version']).status === 0;

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/conventions');

let result: ScanResult;

beforeAll(async () => {
  result = await scan(FIXTURE);
});

const readmeErrors = () =>
  result.findings.filter((f) => f.file === 'README.md' && f.severity === 'error');

describe('documentation conventions are not rot', () => {
  it('reports exactly the two deliberate errors in the README and nothing else', () => {
    const errors = readmeErrors();
    const syntax = errors.filter((f) => f.check === 'syntax');
    const links = errors.filter((f) => f.check === 'broken-link');
    expect(syntax.map((f) => f.snippet ?? f.message)).toEqual(
      hasPython ? [expect.stringContaining('genuinely_typoed')] : [],
    );
    expect(links).toHaveLength(1);
    expect(links[0].message).toContain('definitely-not-here.md');
    expect(errors).toHaveLength((hasPython ? 1 : 0) + 1);
  });

  it('downgrades ts-labeled jsx to a relabel warning', () => {
    const w = result.findings.find(
      (f) => f.severity === 'warning' && f.check === 'syntax' && f.message.includes('labeled `ts`'),
    );
    expect(w).toBeTruthy();
  });

  it('downgrades typescript-only syntax in js fences to a warning', () => {
    const w = result.findings.find(
      (f) => f.severity === 'warning' && f.check === 'syntax' && f.message.includes('labeled `js`'),
    );
    expect(w).toBeTruthy();
  });

  it('downgrades js object literals in json fences to a warning', () => {
    const w = result.findings.find(
      (f) => f.check === 'data' && f.severity === 'warning' && f.message.includes('object literal'),
    );
    expect(w).toBeTruthy();
  });

  it('skips twoslash-annotated blocks', () => {
    const block = result.files.flatMap((f) => f.blocks).find((b) => b.value.includes('@errors:'));
    expect(block?.skipped).toBeTruthy();
  });

  it.skipIf(!hasPython)('skips python blocks that opt out via fence meta', () => {
    const block = result.files.flatMap((f) => f.blocks).find((b) => b.value.includes('serialize_foo'));
    expect(block?.skipped).toBeTruthy();
  });

  it('skips diff blocks fenced as code', () => {
    const block = result.files.flatMap((f) => f.blocks).find((b) => b.value.includes('+import react'));
    expect(block?.skipped).toBe('diff notation');
  });

  it('resolves links to convention pages named after files', () => {
    expect(result.findings.some((f) => f.message.includes('special.tsx'))).toBe(false);
  });
});

describe('private repos', () => {
  it('never errors on missing scripts in a private package README', async () => {
    const r = await scan(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/privaterepo'),
    );
    const f = r.findings.find((x) => x.check === 'missing-script');
    expect(f).toBeTruthy();
    expect(f!.severity).toBe('warning');
  });
});

describe('site-generator source trees', () => {
  it('keeps dead links as errors outside any site tree', () => {
    const control = result.findings.find((f) => f.message.includes('definitely-not-here.md'));
    expect(control?.severity).toBe('error');
  });

  it('downgrades dead relative links under a mkdocs docs tree to warnings', () => {
    const f = result.findings.find((x) => x.file === 'docs/page.md' && x.check === 'broken-link');
    expect(f).toBeTruthy();
    expect(f!.severity).toBe('warning');
  });

  it('downgrades dead relative images under a mkdocs docs tree to warnings', () => {
    const f = result.findings.find((x) => x.file === 'docs/page.md' && x.check === 'missing-image');
    expect(f).toBeTruthy();
    expect(f!.severity).toBe('warning');
  });

  it('downgrades dead relative links in front-matter routed files to warnings', () => {
    const f = result.findings.find((x) => x.file === 'fm.md' && x.check === 'broken-link');
    expect(f).toBeTruthy();
    expect(f!.severity).toBe('warning');
  });

  it('resolves .html links against their markdown source', () => {
    expect(result.findings.some((f) => f.message.includes('b.html'))).toBe(false);
  });
});

describe('excluded historical trees', () => {
  it('never reports decision records or *.old.* files', () => {
    const stray = result.findings.filter(
      (f) => f.file.startsWith('decisions/') || f.file.includes('.old.'),
    );
    expect(stray).toHaveLength(0);
  });
});

describe('package refs in scaffold context', () => {
  it('reports no missing scripts anywhere in this fixture', () => {
    expect(result.findings.filter((f) => f.check === 'missing-script')).toHaveLength(0);
  });
});
