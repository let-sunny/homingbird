import { chmod, copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SOURCE = fileURLToPath(new URL('../cli/dist/homingbird.js', import.meta.url))
const BUNDLED = fileURLToPath(new URL('./cli/homingbird.mjs', import.meta.url))

await mkdir(fileURLToPath(new URL('./cli/', import.meta.url)), { recursive: true })
await copyFile(SOURCE, BUNDLED)
await chmod(BUNDLED, 0o755)
process.stdout.write(`  ${BUNDLED}\n`)
