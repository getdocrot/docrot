import { fromMarkdown } from 'mdast-util-from-markdown';
import type { CodeBlock, DocFile, LinkRef, NormLang } from './types.js';

const LANG_MAP: Record<string, NormLang> = {
  js: 'js',
  javascript: 'js',
  mjs: 'js',
  cjs: 'js',
  node: 'js',
  ts: 'ts',
  typescript: 'ts',
  mts: 'ts',
  cts: 'ts',
  jsx: 'jsx',
  tsx: 'tsx',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  bash: 'shell',
  sh: 'shell',
  shell: 'shell',
  zsh: 'shell',
  console: 'shell',
  'shell-session': 'shell',
  shellsession: 'shell',
  python: 'python',
  py: 'python',
  python3: 'python',
};

const META_SKIP_RE = /(^|\s)(docrot-)?(ignore|skip|no-?check|no-?verify)(\s|$)/i;
const IGNORE_COMMENT_RE = /docrot-(ignore|disable)/i;

function textOf(node: any): string {
  if (node.type === 'text' || node.type === 'inlineCode') return String(node.value ?? '');
  if (Array.isArray(node.children)) return node.children.map(textOf).join('');
  return '';
}

function visit(node: any, fn: (node: any) => void): void {
  fn(node);
  if (Array.isArray(node.children)) for (const child of node.children) visit(child, fn);
}

export function parseDoc(absPath: string, relPath: string, content: string): DocFile {
  const doc: DocFile = {
    path: absPath,
    relPath,
    blocks: [],
    links: [],
    headings: [],
    htmlAnchors: [],
  };

  let tree: unknown;
  try {
    tree = fromMarkdown(content);
  } catch {
    return doc;
  }

  const rawLines = content.split('\n');
  let ignoreUntilLine = -1;

  visit(tree, (node) => {
    const line: number = node.position?.start.line ?? 1;
    switch (node.type) {
      case 'code': {
        const langRaw = node.lang ? String(node.lang).toLowerCase() : null;
        const norm: NormLang = langRaw ? (LANG_MAP[langRaw] ?? 'other') : 'other';
        let skipped: string | null = null;
        if (node.meta && META_SKIP_RE.test(String(node.meta))) {
          skipped = 'ignored via fence meta';
        } else if (ignoreUntilLine >= 0 && line - ignoreUntilLine <= 2) {
          skipped = 'ignored via docrot-ignore comment';
        }
        ignoreUntilLine = -1;
        const block: CodeBlock = {
          file: relPath,
          lang: langRaw,
          norm,
          meta: node.meta ?? null,
          value: String(node.value ?? ''),
          fenceLine: line,
          contentStartLine: line + 1,
          skipped,
          contextHint: rawLines
            .slice(Math.max(0, line - 9), line - 1)
            .filter((l) => l.trim())
            .slice(-4)
            .join(' '),
        };
        doc.blocks.push(block);
        break;
      }
      case 'heading':
        doc.headings.push(textOf(node));
        break;
      case 'link':
        doc.links.push({ file: relPath, line, url: String(node.url ?? ''), kind: 'link' });
        break;
      case 'image':
        doc.links.push({ file: relPath, line, url: String(node.url ?? ''), kind: 'image' });
        break;
      case 'definition':
        doc.links.push({ file: relPath, line, url: String(node.url ?? ''), kind: 'definition' });
        break;
      case 'html': {
        const raw = String(node.value ?? '');
        if (IGNORE_COMMENT_RE.test(raw)) {
          ignoreUntilLine = node.position?.end.line ?? line;
        }
        for (const m of raw.matchAll(/\bid=["']([^"']+)["']/gi)) doc.htmlAnchors.push(m[1]);
        for (const m of raw.matchAll(/<a\b[^>]*?\bname=["']([^"']+)["']/gi)) doc.htmlAnchors.push(m[1]);
        for (const m of raw.matchAll(/<a\b[^>]*?\bhref=["']([^"']+)["']/gi)) {
          doc.links.push({ file: relPath, line, url: m[1], kind: 'link' });
        }
        for (const m of raw.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi)) {
          doc.links.push({ file: relPath, line, url: m[1], kind: 'image' });
        }
        break;
      }
    }
  });

  return doc;
}
