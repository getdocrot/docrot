#!/usr/bin/env node
// Benchmark docrot against real repositories. Build first: npm run build
// Usage: node scripts/bench.mjs <dir> [dir...]
import path from 'node:path';
import { healthGrade, scan } from '../dist/index.js';

if (process.argv.length < 3) {
  console.error('usage: node scripts/bench.mjs <dir> [dir...]');
  process.exit(2);
}

for (const dir of process.argv.slice(2)) {
  const t0 = performance.now();
  const result = await scan(dir);
  const seconds = (performance.now() - t0) / 1000;
  const s = result.stats;
  console.log(
    `${path.basename(path.resolve(dir))}: ${s.files} files · ${s.blocks} blocks · ` +
      `${s.errors} errors · grade ${healthGrade(result)} — ${seconds.toFixed(2)}s ` +
      `(${Math.round(s.blocks / seconds)} blocks/s)`,
  );
}
