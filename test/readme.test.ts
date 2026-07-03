import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

describe('README pre-commit recipe', () => {
  it('documents a staged-markdown Husky hook that runs the fast checks', () => {
    expect(readme).toContain('## Pre-commit');
    expect(readme).toContain('npx husky init');
    expect(readme).toContain('git diff --cached --name-only --diff-filter=ACMR');
    expect(readme).toContain("'*.md' '*.mdx' '*.markdown'");
    expect(readme).toContain('while IFS= read -r file; do dirname "$file"; done');
    expect(readme).toContain('npx docrot-cli "$dir" --only links,pkg');
    expect(readme).toContain('CI should still run `docrot` on the whole repo');
  });
});
