import { describe, expect, it } from 'vitest';
import { healthGrade, renderTerminal } from '../src/report.js';
import type { Finding, ScanResult } from '../src/types.js';

function fake(stats: Partial<ScanResult['stats']>, findings: Finding[] = []): ScanResult {
  return {
    root: '/tmp/x',
    files: [],
    findings,
    stats: {
      files: 3,
      blocks: 0,
      checkedBlocks: 0,
      skippedBlocks: 0,
      brokenBlocks: 0,
      errors: 0,
      warnings: 0,
      infos: 0,
      durationMs: 100,
      skippedChangelogs: 0,
      ...stats,
    },
  } as unknown as ScanResult;
}

describe('healthGrade', () => {
  it('never absolves hard errors — the HN screenshot case', () => {
    // 1057 blocks, 5 broken, 15 errors total (10 of them link errors) was A+.
    const grade = healthGrade(fake({ checkedBlocks: 1057, brokenBlocks: 5, errors: 15 }));
    expect(grade).toBe('F');
  });

  it('caps at C while any hard error exists, even at 99.9% verified', () => {
    expect(healthGrade(fake({ checkedBlocks: 5000, brokenBlocks: 2, errors: 2 }))).toBe('C');
  });

  it('grades D for a handful of errors', () => {
    expect(healthGrade(fake({ checkedBlocks: 500, brokenBlocks: 6, errors: 6 }))).toBe('D');
  });

  it('grades link-only repos by their errors instead of dashing out', () => {
    expect(healthGrade(fake({ checkedBlocks: 0, errors: 2 }))).toBe('C');
  });

  it('gives A+ only to a completely clean run', () => {
    expect(healthGrade(fake({ checkedBlocks: 12 }))).toBe('A+');
  });

  it('gives A when only a few warnings exist', () => {
    expect(healthGrade(fake({ checkedBlocks: 100, warnings: 3 }))).toBe('A');
  });

  it('gives B when warnings pile up', () => {
    expect(healthGrade(fake({ checkedBlocks: 1000, warnings: 200 }))).toBe('B');
  });

  it('dashes out only when there was nothing to verify at all', () => {
    expect(healthGrade(fake({}))).toBe('—');
  });
});

describe('terminal render', () => {
  const link = (file: string): Finding => ({
    file,
    line: 288,
    severity: 'error',
    check: 'broken-link',
    message: 'relative link target `tooltip.html#attributes` does not exist',
  });

  it('explains a capped grade next to it', () => {
    const out = renderTerminal(fake({ checkedBlocks: 1057, brokenBlocks: 5, errors: 15 }, []));
    expect(out).toContain('15 hard errors');
    expect(out).not.toContain('A+');
  });

  it('groups the same finding across locale trees', () => {
    const out = renderTerminal(
      fake({ checkedBlocks: 10, errors: 3 }, [
        link('docs/en-US/component/table.md'),
        link('docs/zh-CN/component/table.md'),
        link('docs/fr-FR/component/table.md'),
      ]),
    );
    const hits = out.split('tooltip.html#attributes').length - 1;
    expect(hits).toBe(1);
    expect(out).toContain('2 other locale file');
  });

  it('groups locale-suffixed basenames too', () => {
    const out = renderTerminal(
      fake({ checkedBlocks: 10, errors: 2 }, [
        link('components/icon/index.en-US.md'),
        link('components/icon/index.zh-CN.md'),
      ]),
    );
    expect(out.split('tooltip.html#attributes').length - 1).toBe(1);
    expect(out).toContain('1 other locale file');
  });

  it('never groups distinct issues', () => {
    const other: Finding = {
      file: 'docs/zh-CN/component/table.md',
      line: 3,
      severity: 'error',
      check: 'broken-link',
      message: 'relative link target `gone.md` does not exist',
    };
    const out = renderTerminal(
      fake({ checkedBlocks: 10, errors: 2 }, [link('docs/en-US/component/table.md'), other]),
    );
    expect(out).toContain('tooltip.html#attributes');
    expect(out).toContain('gone.md');
  });
});
