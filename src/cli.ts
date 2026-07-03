#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import pc from 'picocolors';
import { applyFixes, scan } from './index.js';
import { renderGitHub, renderJson, renderTerminal, summaryLine } from './report.js';
import type { ScanOptions } from './types.js';

const VERSION = '0.2.3';

const HELP = `
${pc.bold('docrot')} — find the lies in your docs

${pc.bold('Usage')}
  docrot [path] [options]

${pc.bold('Options')}
  --fix                             repair mechanical rot (anchors, names, commas)
  --dry-run                         with --fix: show changes without writing
  --reporter <pretty|github|json>   output format (default: pretty)
  --json                            shorthand for --reporter json
  --fail-on <error|warning|never>   exit non-zero threshold (default: error)
  --only <checks>                   comma list of: examples,links,pkg
  --exclude <glob>                  extra ignore globs (repeatable)
  --include-changelogs              also scan CHANGELOG-style files
  -v, --verbose                     show informational notes
  -h, --help                        show this help
  --version                         print version

${pc.bold('Ignore a block')}
  <!-- docrot-ignore -->            before a fence, or add \`docrot-ignore\`
                                    to the fence meta: \`\`\`js docrot-ignore
`;

interface FileConfig {
  exclude?: string[];
  includeChangelogs?: boolean;
  checks?: ScanOptions['checks'];
}

function loadConfig(root: string): FileConfig {
  try {
    const cfgPath = path.join(root, 'docrot.config.json');
    if (fs.existsSync(cfgPath)) return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as FileConfig;
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { docrot?: FileConfig };
      if (pkg.docrot) return pkg.docrot;
    }
  } catch {
    // malformed config: fall through to defaults
  }
  return {};
}

function parseOnly(only: string | undefined): ScanOptions['checks'] | undefined {
  if (!only) return undefined;
  const enabled = new Set(only.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  return {
    examples: enabled.has('examples'),
    links: enabled.has('links'),
    pkg: enabled.has('pkg'),
  };
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        fix: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        reporter: { type: 'string', default: 'pretty' },
        'fail-on': { type: 'string', default: 'error' },
        only: { type: 'string' },
        exclude: { type: 'string', multiple: true },
        'include-changelogs': { type: 'boolean', default: false },
        verbose: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', default: false },
      },
    });
  } catch (err) {
    console.error(pc.red(`docrot: ${(err as Error).message}`));
    console.error(pc.dim('run `docrot --help` for usage'));
    process.exit(2);
  }

  const { values, positionals } = parsed;
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.version) {
    console.log(VERSION);
    return;
  }

  const root = path.resolve(positionals[0] ?? '.');
  if (!fs.existsSync(root)) {
    console.error(pc.red(`docrot: path not found: ${root}`));
    process.exit(2);
  }

  const fileConfig = loadConfig(root);
  const options: ScanOptions = {
    exclude: [...(fileConfig.exclude ?? []), ...(values.exclude ?? [])],
    includeChangelogs: values['include-changelogs'] || !!fileConfig.includeChangelogs,
    checks: parseOnly(values.only) ?? fileConfig.checks,
  };

  const reporter = values.json ? 'json' : (values.reporter ?? 'pretty');
  if (reporter === 'pretty') {
    console.log(pc.bold(`docrot v${VERSION}`) + pc.dim(` — scanning ${root}`));
  }

  const result = await scan(root, options);

  let finalResult = result;
  if (values.fix) {
    const outcome = await applyFixes(result, { ...options, dryRun: values['dry-run'] });
    if (reporter === 'pretty') {
      const verb = values['dry-run'] ? 'would fix' : 'fixed';
      console.log(
        pc.bold(`\n 🔧 ${verb} ${outcome.applied.length} finding${outcome.applied.length === 1 ? '' : 's'}`),
      );
      for (const a of outcome.applied) {
        console.log(
          `   ${pc.dim(`${a.file}:${a.line}`)}  ${pc.red(a.before.slice(0, 60))} ${pc.dim('→')} ${pc.green(a.after.slice(0, 60))}`,
        );
      }
      if (outcome.reverted.length) {
        console.log(pc.yellow(`   reverted (scanned worse after fixing): ${outcome.reverted.join(', ')}`));
      }
    }
    if (outcome.rescan) finalResult = outcome.rescan;
  }

  switch (reporter) {
    case 'json':
      console.log(renderJson(finalResult));
      break;
    case 'github':
      process.stdout.write(renderGitHub(finalResult));
      console.log(summaryLine(finalResult));
      break;
    default:
      console.log(renderTerminal(finalResult, { verbose: values.verbose }));
  }

  const failOn = values['fail-on'];
  const { errors, warnings } = finalResult.stats;
  const fail = failOn === 'never' ? false : failOn === 'warning' ? errors + warnings > 0 : errors > 0;
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(pc.red(`docrot: unexpected error — ${(err as Error)?.stack ?? err}`));
  process.exit(2);
});
