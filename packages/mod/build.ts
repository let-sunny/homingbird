import { chmod, copyFile, mkdir } from 'node:fs/promises'

const SOURCE = new URL('../cli/dist/homingbird.js', import.meta.url).pathname
const BUNDLED = new URL('./cli/homingbird.mjs', import.meta.url).pathname

await mkdir(new URL('./cli/', import.meta.url).pathname, { recursive: true })
await copyFile(SOURCE, BUNDLED)
await chmod(BUNDLED, 0o755)
process.stdout.write(`  ${BUNDLED}\n`)
