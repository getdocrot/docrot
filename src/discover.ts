import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import ignoreModule, { type Ignore } from 'ignore';

// `ignore` is CJS with both `module.exports` and `.default` set; which one the
// default import binds to depends on the loader, so accept either.
const createIgnore: () => Ignore = ((ignoreModule as { default?: unknown }).default ??
  ignoreModule) as () => Ignore;
import type { ScanOptions } from './types.js';

const ALWAYS_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/vendor/**',
  '**/third_party/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.venv/**',
  '**/__pycache__/**',
  '**/.docusaurus/**',
  '**/.vitepress/cache/**',
];

// Changelogs and deprecation notes are historical documents: their examples
// legitimately reference old APIs, so scanning them is false-positive noise.
const CHANGELOG_RE =
  /(^|\/)(changelog|changes|history|release[-_ ]?notes|deprecat(?:ed|ions?))[^/]*\.(md|mdx|markdown)$/i;

export interface DiscoverResult {
  files: string[];
  skippedChangelogs: number;
}

export async function discoverMarkdown(
  root: string,
  opts: ScanOptions = {},
): Promise<DiscoverResult> {
  let files = await fg(['**/*.md', '**/*.mdx', '**/*.markdown'], {
    cwd: root,
    ignore: [...ALWAYS_IGNORE, ...(opts.exclude ?? [])],
    dot: false,
    followSymbolicLinks: false,
    onlyFiles: true,
  });

  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      const ig = createIgnore().add(fs.readFileSync(gitignorePath, 'utf8'));
      files = files.filter((f) => !ig.ignores(f));
    } catch {
      // unreadable .gitignore: scan everything
    }
  }

  let skippedChangelogs = 0;
  if (!opts.includeChangelogs) {
    const kept = files.filter((f) => !CHANGELOG_RE.test(f));
    skippedChangelogs = files.length - kept.length;
    files = kept;
  }

  files.sort();
  return { files, skippedChangelogs };
}
