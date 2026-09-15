import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(projectRoot, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    'background/service-worker': resolve(projectRoot, 'src/background/service-worker.ts'),
    'content/page-agent': resolve(projectRoot, 'src/content/page-agent.ts'),
    'debug/debug': resolve(projectRoot, 'src/debug/debug.ts'),
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outdir: dist,
  sourcemap: true,
  logLevel: 'info',
});

await build({
  entryPoints: {
    'bridge/server': resolve(projectRoot, 'src/bridge/cli.ts'),
    'mcp/cli': resolve(projectRoot, 'src/mcp/cli.ts'),
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  packages: 'external',
  outdir: dist,
  sourcemap: true,
  logLevel: 'info',
});

// The Native Host is copied into the user's runtime directory during install,
// so it must not resolve dependencies from the npm package or repository.
await build({
  entryPoints: {
    'native-host/host': resolve(projectRoot, 'src/native-host/host.ts'),
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outdir: dist,
  sourcemap: true,
  logLevel: 'info',
});

await cp(resolve(projectRoot, 'manifest.json'), resolve(dist, 'manifest.json'));
await cp(resolve(projectRoot, 'src/debug/debug.html'), resolve(dist, 'debug.html'));
await cp(resolve(projectRoot, 'src/icons'), resolve(dist, 'icons'), { recursive: true });
