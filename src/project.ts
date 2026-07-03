import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import type { PackageJson, ProjectInfo } from './types.js';

function readPkg(file: string): PackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

function workspaceGlobs(pkg: PackageJson | null, root: string): string[] {
  const globs: string[] = [];
  if (pkg?.workspaces) {
    const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces.packages ?? []);
    globs.push(...ws);
  }
  const pnpmFile = path.join(root, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmFile)) {
    try {
      const parsed = parseYaml(fs.readFileSync(pnpmFile, 'utf8')) as { packages?: string[] };
      if (Array.isArray(parsed?.packages)) globs.push(...parsed.packages);
    } catch {
      // malformed pnpm-workspace.yaml: ignore
    }
  }
  return globs.filter((g) => typeof g === 'string' && !g.startsWith('!'));
}

export function loadProject(root: string): ProjectInfo {
  const pkg = readPkg(path.join(root, 'package.json'));
  const deps = new Set<string>();
  const scripts = new Set<string>();
  const binNames = new Set<string>();
  const workspaces = new Map<string, string>();

  if (pkg) {
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ] as const) {
      for (const dep of Object.keys(pkg[field] ?? {})) deps.add(dep);
    }
    for (const script of Object.keys(pkg.scripts ?? {})) scripts.add(script);
    if (typeof pkg.bin === 'string' && pkg.name) {
      binNames.add(pkg.name.startsWith('@') ? pkg.name.split('/')[1] : pkg.name);
    } else if (pkg.bin && typeof pkg.bin === 'object') {
      for (const bin of Object.keys(pkg.bin)) binNames.add(bin);
    }

    for (const glob of workspaceGlobs(pkg, root)) {
      const pattern = glob.replace(/\/+$/, '') + '/package.json';
      for (const rel of fg.sync(pattern, { cwd: root, ignore: ['**/node_modules/**'] })) {
        const wsPkg = readPkg(path.join(root, rel));
        if (wsPkg?.name) workspaces.set(wsPkg.name, path.dirname(path.join(root, rel)));
      }
    }
  }

  if (pkg?.name) workspaces.set(pkg.name, root);

  return {
    root,
    pkg,
    name: pkg?.name ?? null,
    isPrivate: !!pkg?.private,
    deps,
    scripts,
    binNames,
    workspaces,
  };
}
