import { chmod } from 'node:fs/promises'
import { build } from 'esbuild'

const OUTPUT = new URL('./dist/homingbird-mcp.mjs', import.meta.url).pathname

await build({
  entryPoints: [new URL('./src/stdio.ts', import.meta.url).pathname],
  outfile: OUTPUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
})
await chmod(OUTPUT, 0o755)
