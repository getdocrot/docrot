import fs from 'node:fs';
import path from 'node:path';
import GithubSlugger from 'github-slugger';
import { levenshtein } from './pkgrefs.js';
import type { DocFile, Finding, FindingFix } from '../types.js';

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

// Slug algorithms disagree about unicode punctuation (CJK TOCs especially),
// so non-matching anchors get a second chance on letters/digits alone.
function fuzzySlug(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFKC')) {
    if (/[\p{L}\p{N}]/u.test(ch)) out += ch;
  }
  return out.toLowerCase();
}

interface AnchorIndex {
  exact: Set<string>;
  fuzzy: Set<string>;
  slugs: string[];
}

function anchorSetOf(doc: DocFile, cache: Map<string, AnchorIndex>): AnchorIndex {
  let index = cache.get(doc.relPath);
  if (index) return index;
  index = { exact: new Set(), fuzzy: new Set(), slugs: [] };
  const slugger = new GithubSlugger();
  for (const heading of doc.headings) {
    const slug = slugger.slug(heading);
    index.exact.add(slug);
    index.fuzzy.add(fuzzySlug(slug));
    index.slugs.push(slug);
  }
  for (const anchor of doc.htmlAnchors) {
    index.exact.add(anchor);
    index.exact.add(anchor.toLowerCase());
    index.fuzzy.add(fuzzySlug(anchor));
    index.slugs.push(anchor);
  }
  cache.set(doc.relPath, index);
  return index;
}

/** Unambiguous repair target for a dead anchor, or null. */
function bestAnchor(fragment: string, index: AnchorIndex): string | null {
  const wanted = fuzzySlug(fragment);
  const fuzzyHits = index.slugs.filter((s) => fuzzySlug(s) === wanted);
  if (fuzzyHits.length === 1) return fuzzyHits[0];
  if (fuzzyHits.length > 1) return null;
  // Only slug ⊇ fragment counts: a long fragment "containing" some generic
  // short slug (#dispatcher, #errors) is a coincidence, not a repair target.
  const substrHits =
    fragment.length >= 4 ? index.slugs.filter((s) => s.includes(fragment)) : [];
  if (substrHits.length === 1) return substrHits[0];
  if (substrHits.length > 1) return null;
  const ranked = index.slugs
    .map((s) => ({ s, d: levenshtein(s, fragment) }))
    .filter((x) => x.d <= 3)
    .sort((a, b) => a.d - b.d);
  if (ranked.length === 1 || (ranked.length > 1 && ranked[0].d < ranked[1].d)) return ranked[0].s;
  return null;
}

function anchorFix(refUrl: string, best: string | null): FindingFix | undefined {
  if (!best) return undefined;
  const hash = refUrl.indexOf('#');
  if (hash === -1) return undefined;
  return { search: refUrl.slice(hash), replace: `#${best}` };
}

function anchorMissing(index: AnchorIndex, fragment: string): boolean {
  return (
    !index.exact.has(fragment) &&
    !index.exact.has(fragment.toLowerCase()) &&
    !index.fuzzy.has(fuzzySlug(fragment))
  );
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
  const anchorCache = new Map<string, AnchorIndex>();

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
        if (anchorMissing(anchors, fragment)) {
          findings.push({
            file: doc.relPath,
            line: ref.line,
            severity: 'warning',
            check: 'missing-anchor',
            message: `anchor \`#${fragment}\` not found in this file`,
            fix: anchorFix(ref.url, bestAnchor(fragment, anchors)),
          });
        }
        continue;
      }

      // Root-absolute paths are docs-site routes, not repo files; template
      // tokens are placeholders. Neither can be verified against the tree.
      if (url.startsWith('/') || isTemplateToken(url)) continue;

      const base = path.resolve(path.dirname(doc.path), url);
      // `migrating-to-1.0.0` has no extension — numbers don't count.
      const hasExt = /\.[a-z][a-z0-9]*$/i.test(url);
      // Docs-site links routinely drop the .md extension; accept the file the
      // route points at before declaring the link dead.
      const withRoutes = (b: string): string[] =>
        hasExt ? [b] : [b, `${b}.md`, `${b}.mdx`, `${b}.html`, path.join(b, 'index.md')];
      let abs = withRoutes(base).find((c) => fs.existsSync(c));
      let siteStyle = false;

      if (!abs) {
        // Docs-site trees write links relative to the site root, not the
        // file. Retry against the repo root and the nearest docs/ ancestor —
        // a hit means the link works on the site but not on GitHub.
        const roots = [root];
        let dir = path.dirname(doc.path);
        while (dir.startsWith(root) && dir !== root) {
          if (/^docs?$/i.test(path.basename(dir)) || /(^|\/)docs?\//.test(path.relative(root, dir) + '/')) {
            roots.push(dir);
          }
          dir = path.dirname(dir);
        }
        for (const r of roots) {
          const retry = withRoutes(path.resolve(r, url.replace(/^\.\//, ''))).find((c) => fs.existsSync(c));
          if (retry) {
            abs = retry;
            siteStyle = true;
            break;
          }
        }
      }

      if (!abs) {
        // i18n docs trees (docs/de/…) link pages that only exist in the
        // default-language tree; static site generators fall back at build
        // time, but the link 404s when browsing the repo.
        const i18n = doc.relPath.match(/(^|\/)docs\/([a-z]{2}(?:[-_][A-Za-z]{2,4})?)\//);
        if (i18n && i18n[2] !== 'en') {
          const enRel = doc.relPath.replace(
            new RegExp(`(^|/)docs/${i18n[2]}/`),
            '$1docs/en/',
          );
          const enBase = path.resolve(path.dirname(path.join(root, enRel)), url);
          if (withRoutes(enBase).some((c) => fs.existsSync(c))) {
            findings.push({
              file: doc.relPath,
              line: ref.line,
              severity: 'warning',
              check: 'broken-link',
              message: `\`${ref.url}\` only exists in the en docs tree — the site falls back, GitHub 404s`,
            });
            continue;
          }
        }
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
      if (siteStyle) {
        const rel = path.relative(path.dirname(doc.path), abs).split(path.sep).join('/');
        const rawFragment = ref.url.includes('#') ? ref.url.slice(ref.url.indexOf('#')) : '';
        findings.push({
          file: doc.relPath,
          line: ref.line,
          severity: 'warning',
          check: 'broken-link',
          message: `link \`${ref.url}\` only resolves from the docs root — works on the site, 404s on GitHub`,
          fix: { search: ref.url, replace: `${rel.startsWith('.') ? rel : './' + rel}${rawFragment}` },
        });
        // still verify the fragment against the file it lands on
      }

      if (fragment && !skippableFragment(fragment) && MD_RE.test(abs)) {
        const relTarget = path.relative(root, abs).split(path.sep).join('/');
        const targetDoc = byRel.get(relTarget);
        if (targetDoc) {
          const anchors = anchorSetOf(targetDoc, anchorCache);
          if (anchorMissing(anchors, fragment)) {
            findings.push({
              file: doc.relPath,
              line: ref.line,
              severity: 'warning',
              check: 'missing-anchor',
              message: `anchor \`#${fragment}\` not found in \`${relTarget}\``,
              fix: anchorFix(ref.url, bestAnchor(fragment, anchors)),
            });
          }
        }
      }
    }
  }

  return findings;
}
