import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyFixes, scan } from '../src/index.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/proj');

function copyFixture(prefix: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  return tmp;
}

describe('applyFixes', () => {
  it('repairs mechanical rot and never makes files worse', async () => {
    const tmp = copyFixture('docrot-fix-');
    const before = await scan(tmp);
    const outcome = await applyFixes(before, {});

    expect(outcome.applied.length).toBeGreaterThanOrEqual(4);
    expect(outcome.reverted).toEqual([]);
    expect(outcome.rescan).not.toBeNull();
    expect(outcome.rescan!.stats.errors).toBeLessThan(before.stats.errors);

    const readme = fs.readFileSync(path.join(tmp, 'README.md'), 'utf8');
    expect(readme).toContain('npm run build\n'); // biuld -> build
    expect(readme).not.toMatch(/npm run biuld/);
    expect(readme).toContain('npx fixture'); // fixtur -> fixture
    expect(readme).toContain('#getting-started)'); // getting-startd repaired
    expect(readme).not.toContain('#getting-startd');
    expect(readme).toContain('a: 1,'); // comma inserted, block now parses
    expect(readme).not.toMatch(/fixture-pk\b/); // install name corrected

    // unfixable things stay: deploy has no near script, instalation no near anchor
    expect(readme).toContain('npm run deploy');
    expect(readme).toContain('#instalation');

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('dry run reports fixes without touching files', async () => {
    const tmp = copyFixture('docrot-dry-');
    const original = fs.readFileSync(path.join(tmp, 'README.md'), 'utf8');
    const result = await scan(tmp);
    const outcome = await applyFixes(result, { dryRun: true });

    expect(outcome.applied.length).toBeGreaterThanOrEqual(4);
    expect(outcome.rescan).toBeNull();
    expect(fs.readFileSync(path.join(tmp, 'README.md'), 'utf8')).toBe(original);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
