import { chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const OUTPUT = fileURLToPath(new URL('./dist/homingbird-mcp.mjs', import.meta.url))

await build({
  entryPoints: [fileURLToPath(new URL('./src/stdio.ts', import.meta.url))],
  outfile: OUTPUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
})
await chmod(OUTPUT, 0o755)
