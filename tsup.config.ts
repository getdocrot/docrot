import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts', index: 'src/index.ts', mcp: 'src/mcp.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  splitting: true,
  sourcemap: false,
});
