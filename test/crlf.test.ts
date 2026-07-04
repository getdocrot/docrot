import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyFixes, scan } from '../src/index.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/proj');

// Windows checkouts hand the scanner CRLF files (core.autocrlf). Everything
// must behave exactly as on LF, and --fix must not rewrite a user's endings.
function crlfCopy(prefix: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
      }
    }
  };
  walk(tmp);
  return tmp;
}

describe('CRLF line endings (Windows checkouts)', () => {
  it('scans CRLF markdown identically to LF', async () => {
    const lf = await scan(FIXTURE);
    const tmp = crlfCopy('docrot-crlf-');
    const crlf = await scan(tmp);
    const sig = (r: Awaited<ReturnType<typeof scan>>): string[] =>
      r.findings.map((f) => `${f.file}:${f.line}:${f.severity}:${f.check}`);
    expect(sig(crlf)).toEqual(sig(lf));
    const anyCr = crlf.files.flatMap((f) => f.blocks).some((b) => b.value.includes('\r'));
    expect(anyCr).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('applyFixes repairs CRLF files and preserves their line endings', async () => {
    const tmp = crlfCopy('docrot-crlf-fix-');
    const before = await scan(tmp);
    const outcome = await applyFixes(before, {});
    expect(outcome.applied.length).toBeGreaterThanOrEqual(4);
    const readme = fs.readFileSync(path.join(tmp, 'README.md'), 'utf8');
    expect(readme).toContain('npm run build');
    expect(readme).toContain('a: 1,'); // block-level fix must survive CRLF
    expect(readme.includes('\r\n')).toBe(true); // endings preserved
    expect(readme).not.toMatch(/[^\r]\n/); // no mixed endings introduced
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
