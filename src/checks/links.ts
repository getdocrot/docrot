import fs from 'node:fs';
import path from 'node:path';
import GithubSlugger from 'github-slugger';
import type { DocFile, Finding } from '../types.js';

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const MD_RE = /\.(md|mdx|markdown)$/i;

const KNOWN_EXTS = new Set([
  'md', 'mdx', 'markdown', 'html', 'htm', 'txt', 'rst',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'pdf',
  'json', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'csv', 'lock',
  'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'css', 'scss', 'less',
  'sh', 'ps1', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs',
  'woff', 'woff2', 'ttf', 'wasm', 'map', 'zip', 'gz',
]);

// Template docs interpolate values into link targets (`sponsor.website`).
// A dotted identifier chain whose tail is not a file extension is a token,
// not a path.
function isTemplateToken(url: string): boolean {
  if (url.includes('/')) return false;
  const m = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$-]*)+$/.exec(url);
  if (!m) return false;
  const tail = url.slice(url.lastIndexOf('.') + 1).toLowerCase();
  return !KNOWN_EXTS.has(tail);
}

function anchorSetOf(doc: DocFile, cache: Map<string, Set<string>>): Set<string> {
  let set = cache.get(doc.relPath);
  if (set) return set;
  set = new Set<string>();
  const slugger = new GithubSlugger();
  for (const heading of doc.headings) set.add(slugger.slug(heading));
  for (const anchor of doc.htmlAnchors) {
    set.add(anchor);
    set.add(anchor.toLowerCase());
  }
  cache.set(doc.relPath, set);
  return set;
}

function skippableFragment(fragment: string): boolean {
  return (
    fragment === '' ||
    /^L\d+/.test(fragment) || // GitHub line references
    fragment.startsWith(':~:') // text fragments
  );
}

export function checkLinks(docs: DocFile[], root: string): Finding[] {
  const findings: Finding[] = [];
  const byRel = new Map(docs.map((d) => [d.relPath.split(path.sep).join('/'), d]));
  const anchorCache = new Map<string, Set<string>>();

  for (const doc of docs) {
    for (const ref of doc.links) {
      let url = ref.url.trim();
      if (!url || url.startsWith('//') || SCHEME_RE.test(url)) continue;

      const hashIndex = url.indexOf('#');
      let fragment = '';
      if (hashIndex !== -1) {
        fragment = url.slice(hashIndex + 1);
        url = url.slice(0, hashIndex);
      }
      url = url.split('?')[0];
      try {
        url = decodeURIComponent(url);
        fragment = decodeURIComponent(fragment);
      } catch {
        // leave as-is when not valid percent-encoding
      }

      // Anchor within the same document.
      if (!url) {
        if (skippableFragment(fragment)) continue;
        const anchors = anchorSetOf(doc, anchorCache);
        if (!anchors.has(fragment) && !anchors.has(fragment.toLowerCase())) {
          findings.push({
            file: doc.relPath,
            line: ref.line,
            severity: 'warning',
            check: 'missing-anchor',
            message: `anchor \`#${fragment}\` not found in this file`,
          });
        }
        continue;
      }

      // Root-absolute paths are docs-site routes, not repo files; template
      // tokens are placeholders. Neither can be verified against the tree.
      if (url.startsWith('/') || isTemplateToken(url)) continue;

      const base = path.resolve(path.dirname(doc.path), url);
      const hasExt = /\.[^./\\]+$/.test(url);
      // Docs-site links routinely drop the .md extension; accept the file the
      // route points at before declaring the link dead.
      const candidates = hasExt
        ? [base]
        : [base, `${base}.md`, `${base}.mdx`, `${base}.html`, path.join(base, 'index.md')];
      const abs = candidates.find((c) => fs.existsSync(c));

      if (!abs) {
        findings.push({
          file: doc.relPath,
          line: ref.line,
          severity: hasExt ? 'error' : 'warning',
          check: ref.kind === 'image' ? 'missing-image' : 'broken-link',
          message: hasExt
            ? `relative ${ref.kind === 'image' ? 'image' : 'link'} target \`${ref.url}\` does not exist`
            : `relative link \`${ref.url}\` matches no file or .md/.html route`,
        });
        continue;
      }

      if (fragment && !skippableFragment(fragment) && MD_RE.test(abs)) {
        const relTarget = path.relative(root, abs).split(path.sep).join('/');
        const targetDoc = byRel.get(relTarget);
        if (targetDoc) {
          const anchors = anchorSetOf(targetDoc, anchorCache);
          if (!anchors.has(fragment) && !anchors.has(fragment.toLowerCase())) {
            findings.push({
              file: doc.relPath,
              line: ref.line,
              severity: 'warning',
              check: 'missing-anchor',
              message: `anchor \`#${fragment}\` not found in \`${relTarget}\``,
            });
          }
        }
      }
    }
  }

  return findings;
}
