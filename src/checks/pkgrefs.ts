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

function levenshtein(a: string, b: string): number {
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

function commandsIn(block: CodeBlock): Array<{ tokens: string[]; line: number }> {
  const out: Array<{ tokens: string[]; line: number }> = [];
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
    for (const part of line.split(/&&|\|\||;|\|/)) {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      if (tokens.length) out.push({ tokens, line: block.contentStartLine + i });
    }
  });
  return out;
}

export function checkPkgRefs(blocks: CodeBlock[], project: ProjectInfo): Finding[] {
  const findings: Finding[] = [];
  if (!project.pkg) return findings;

  for (const block of blocks) {
    const blockId = `${block.file}:${block.fenceLine}`;
    for (const { tokens, line } of commandsIn(block)) {
      const [cmd, ...rest] = tokens;

      // `npm run x` / `npm test` — the referenced script must exist.
      if (RUN_CAPABLE.has(cmd) && project.scripts.size) {
        let script: string | undefined;
        if ((rest[0] === 'run' || rest[0] === 'run-script') && rest[1] && !rest[1].startsWith('-')) {
          script = rest[1];
        } else if (cmd === 'npm' && (rest[0] === 'test' || rest[0] === 'start') && !rest.includes('--workspace')) {
          script = rest[0];
        }
        if (
          script &&
          !/[<>[\]{}$*]/.test(script) && // `npm run <command>` is a usage pattern
          !project.scripts.has(script) &&
          !rest.includes('--workspace') &&
          !rest.some((t) => t.startsWith('--workspace=') || t === '-w')
        ) {
          findings.push({
            file: block.file,
            line,
            severity: 'error',
            check: 'missing-script',
            message: `package.json has no \`${script}\` script (docs say \`${cmd} run ${script}\`)`,
            snippet: tokens.join(' '),
            blockId,
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
          const bins = [...project.binNames].join('`, `');
          findings.push({
            file: block.file,
            line,
            severity: 'warning',
            check: 'unknown-bin',
            message: `docs run \`${cmd} ${target}\` but this package's bin is \`${bins}\``,
            snippet: tokens.join(' '),
            blockId,
          });
        }
      }
    }
  }

  return findings;
}
