import { build } from 'esbuild'

await build({
  entryPoints: [new URL('src/main.ts', import.meta.url).pathname],
  outfile: new URL('dist/dovecote.mjs', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['pg', 'mysql2', 'mysql2/promise'],
  sourcemap: true,
  legalComments: 'none',
})
