import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { scan } from '../src/index.js';
import type { ScanResult } from '../src/types.js';

const fixture = (name: string): string =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name);

describe('workspace-aware export verification', () => {
  let result: ScanResult;

  beforeAll(async () => {
    result = await scan(fixture('monorepo'));
  });

  it('resolves re-exports across workspace packages instead of accusing them', () => {
    const wrongly = result.findings.filter(
      (f) => f.check === 'missing-export' && (f.message.includes('realBeta') || f.message.includes('BETA_CONST')),
    );
    expect(wrongly).toHaveLength(0);
  });

  it('still flags exports no workspace package provides, as errors', () => {
    const ghost = result.findings.find((f) => f.check === 'missing-export' && f.message.includes('ghostBeta'));
    expect(ghost).toBeTruthy();
    expect(ghost!.severity).toBe('error');
  });

  it('never leaks synthetic module names into messages', () => {
    for (const f of result.findings) {
      expect(f.message).not.toContain('__docrot');
    }
  });
});

describe('incomplete type graph safety valve', () => {
  let result: ScanResult;

  beforeAll(async () => {
    result = await scan(fixture('unresolved'));
  });

  it('downgrades missing-export to a warning when the type graph has holes', () => {
    const f = result.findings.find((x) => x.check === 'missing-export' && x.message.includes('mysteryFn'));
    expect(f).toBeTruthy();
    expect(f!.severity).toBe('warning');
    expect(f!.message).toContain('not installed');
  });
});
