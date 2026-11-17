import { chmod } from 'node:fs/promises'
import { build } from 'esbuild'

const OUTPUT = 'dist/homingbird.js'

await build({
  entryPoints: ['src/main.ts'],
  outfile: OUTPUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})
await chmod(OUTPUT, 0o755)
