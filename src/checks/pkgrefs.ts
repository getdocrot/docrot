import fs from 'node:fs';
import path from 'node:path';
import type { CodeBlock, Finding, ProjectInfo } from '../types.js';

const INSTALL_VERBS: Record<string, Set<string>> = {
  npm: new Set(['install', 'i', 'add']),
  pnpm: new Set(['install', 'i', 'add']),
  yarn: new Set(['add']),
  bun: new Set(['install', 'i', 'add']),
};

const RUN_CAPABLE = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const DLX = new Set(['npx', 'bunx']);
const PKG_NAME_RE = /^(@[a-z0-9-~][\w.-]*\/)?[a-z0-9-~][\w.-]*$/i;

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[a.length];
}

function unscoped(name: string): string {
  return name.startsWith('@') ? (name.split('/')[1] ?? name) : name;
}

function stripVersion(arg: string): string {
  const at = arg.lastIndexOf('@');
  return at > 0 ? arg.slice(0, at) : arg;
}

function looksLikeOurs(arg: string, project: ProjectInfo): boolean {
  const name = project.name;
  if (!name) return false;
  if (arg === name || project.workspaces.has(arg)) return true;
  return false;
}

function similarToOurs(arg: string, project: ProjectInfo): boolean {
  const name = project.name;
  if (!name || arg.length < 4) return false;
  const bare = unscoped(name);
  if (arg === bare && arg !== name) return true; // docs use unscoped name of a scoped package
  if (unscoped(arg) === bare && arg !== name) return true; // wrong scope
  return levenshtein(unscoped(arg), bare) <= 2 && Math.abs(unscoped(arg).length - bare.length) <= 2;
}

function commandsIn(block: CodeBlock): Array<{ tokens: string[]; line: number; afterCd: boolean }> {
  const out: Array<{ tokens: string[]; line: number; afterCd: boolean }> = [];
  const lines = block.value.split('\n');
  const hasPrompt = lines.some((l) => /^\s*\$\s+/.test(l));
  lines.forEach((raw, i) => {
    let line = raw;
    if (hasPrompt) {
      if (!/^\s*\$\s+/.test(line)) return; // session output, not a command
      line = line.replace(/^\s*\$\s+/, '');
    }
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    let afterCd = false;
    for (const part of line.split(/&&|\|\||;|\|/)) {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      if (tokens.length) out.push({ tokens, line: block.contentStartLine + i, afterCd });
      if (tokens[0] === 'cd') afterCd = true;
    }
  });
  return out;
}

const pkgScriptsCache = new Map<string, Set<string>>();

function scriptsInDir(dir: string): Set<string> {
  let set = pkgScriptsCache.get(dir);
  if (set) return set;
  set = new Set<string>();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    for (const key of Object.keys(pkg.scripts ?? {})) set.add(key);
  } catch {
    // no package.json here
  }
  pkgScriptsCache.set(dir, set);
  return set;
}

// `npm run x` inside docs/ usually refers to docs/package.json, and monorepo
// READMEs reference workspace scripts — a script only counts as missing when
// no package.json in scope defines it.
function scriptsInScope(blockFile: string, project: ProjectInfo): Set<string> {
  const all = new Set(project.scripts);
  for (const dir of project.workspaces.values()) {
    for (const s of scriptsInDir(dir)) all.add(s);
  }
  const rootAbs = path.resolve(project.root);
  let dir = path.resolve(rootAbs, path.dirname(blockFile));
  while (dir.startsWith(rootAbs)) {
    for (const s of scriptsInDir(dir)) all.add(s);
    if (dir === rootAbs) break;
    dir = path.dirname(dir);
  }
  return all;
}

/** True when a `cd` target stays inside the repo (workspace hops are fine). */
function cdStaysInRepo(dest: string, blockFile: string, root: string): boolean {
  const clean = dest.replace(/^["']|["']$/g, '');
  if (!clean || clean === '-') return true;
  if (path.isAbsolute(clean) || clean.startsWith('~')) return false;
  return (
    fs.existsSync(path.resolve(root, clean)) ||
    fs.existsSync(path.resolve(root, path.dirname(blockFile), clean))
  );
}

/** `bun run x` also runs the file `x` — only a missing script AND file rots. */
function bunRunnableFile(script: string, blockFile: string, root: string): boolean {
  const dirs = [path.resolve(root, path.dirname(blockFile)), path.resolve(root)];
  const names = [script, `${script}.ts`, `${script}.js`, `${script}.tsx`, `${script}.mjs`, `${script}.sh`];
  return dirs.some((d) => names.some((n) => fs.existsSync(path.join(d, n))));
}

export function checkPkgRefs(blocks: CodeBlock[], project: ProjectInfo): Finding[] {
  const findings: Finding[] = [];
  if (!project.pkg) return findings;

  // Scaffold walkthroughs (`npm create x && cd x`) leave the repo: every
  // script/install reference after that point belongs to the generated app.
  const escapedFiles = new Set<string>();

  for (const block of blocks) {
    const blockId = `${block.file}:${block.fenceLine}`;
    for (const { tokens, line, afterCd } of commandsIn(block)) {
      const [cmd, ...rest] = tokens;

      const fileEscaped = escapedFiles.has(block.file);
      if (cmd === 'cd' && rest[0] && !cdStaysInRepo(rest[0], block.file, project.root)) {
        escapedFiles.add(block.file);
      }
      if (fileEscaped) continue;

      // `npm run x` / `npm test` — the referenced script must exist.
      if (RUN_CAPABLE.has(cmd) && project.scripts.size && !afterCd) {
        let script: string | undefined;
        if ((rest[0] === 'run' || rest[0] === 'run-script') && rest[1] && !rest[1].startsWith('-')) {
          script = rest[1];
        } else if (cmd === 'npm' && (rest[0] === 'test' || rest[0] === 'start') && !rest.includes('--workspace')) {
          script = rest[0];
        }
        // `npm start` without a start script legally falls back to server.js.
        if (script === 'start' && fs.existsSync(path.join(project.root, 'server.js'))) {
          script = undefined;
        }
        // `bun run x` executes the file `x` when no script named `x` exists.
        if (script && cmd === 'bun' && bunRunnableFile(script, block.file, project.root)) {
          script = undefined;
        }
        if (
          script &&
          !/[<>[\]{}$*]/.test(script) && // `npm run <command>` is a usage pattern
          !scriptsInScope(block.file, project).has(script) &&
          !rest.includes('--workspace') &&
          !rest.some((t) => t.startsWith('--workspace=') || t === '-w')
        ) {
          // Deep docs often quote `npm run x` illustratively; only the repo's
          // front-door files state it as an instruction with authority. A
          // private package's README documents the product, not the repo
          // (runtimes like bun teach `bun run <file>` there), so never error.
          const authoritative =
            !project.isPrivate &&
            /^(readme|contributing|development|setup)/i.test(path.basename(block.file));
          const near = [...scriptsInScope(block.file, project)]
            .filter((s) => levenshtein(s, script) <= 2)
            .sort((a, b) => levenshtein(a, script) - levenshtein(b, script));
          const unambiguous =
            near.length === 1 ||
            (near.length > 1 && levenshtein(near[0], script) < levenshtein(near[1], script));
          findings.push({
            file: block.file,
            line,
            severity: authoritative ? 'error' : 'warning',
            check: 'missing-script',
            message: `package.json has no \`${script}\` script (docs say \`${cmd} run ${script}\`)`,
            snippet: tokens.join(' '),
            blockId,
            fix: near.length && unambiguous ? { search: script, replace: near[0] } : undefined,
          });
        }
      }

      // `npm install wrong-name` — catches renamed/rescoped packages.
      const verbs = INSTALL_VERBS[cmd];
      if (verbs && rest.length && verbs.has(rest[0]) && project.name && !project.isPrivate) {
        const args = rest
          .slice(1)
          .filter((t) => !t.startsWith('-'))
          .map(stripVersion)
          .filter((t) => PKG_NAME_RE.test(t));
        for (const arg of args) {
          if (looksLikeOurs(arg, project)) continue;
          if (similarToOurs(arg, project)) {
            findings.push({
              file: block.file,
              line,
              severity: 'warning',
              check: 'install-name',
              message: `docs install \`${arg}\` but this package is \`${project.name}\``,
              snippet: tokens.join(' '),
              blockId,
              fix: { search: arg, replace: project.name },
            });
          }
        }
      }

      // `npx wrong-bin` — catches renamed CLIs.
      if (DLX.has(cmd) || (cmd === 'pnpm' && rest[0] === 'dlx') || (cmd === 'yarn' && rest[0] === 'dlx')) {
        const args = (DLX.has(cmd) ? rest : rest.slice(1)).filter((t) => !t.startsWith('-'));
        const target = args[0] ? stripVersion(args[0]) : undefined;
        const similarBin =
          !!target &&
          target.length >= 4 &&
          ([...project.binNames].some(
            (b) => b !== target && levenshtein(target, b) <= 2 && Math.abs(target.length - b.length) <= 2,
          ) ||
            similarToOurs(target, project));
        if (
          target &&
          project.binNames.size &&
          !project.binNames.has(target) &&
          !looksLikeOurs(target, project) &&
          similarBin
        ) {
          const binList = [...project.binNames];
          const nearBin = binList
            .filter((b) => levenshtein(b, target) <= 2)
            .sort((a, b) => levenshtein(a, target) - levenshtein(b, target));
          findings.push({
            file: block.file,
            line,
            severity: 'warning',
            check: 'unknown-bin',
            message: `docs run \`${cmd} ${target}\` but this package's bin is \`${binList.join('`, `')}\``,
            snippet: tokens.join(' '),
            blockId,
            fix: nearBin.length === 1 ? { search: target, replace: nearBin[0] } : undefined,
          });
        }
      }
    }
  }

  return findings;
}
