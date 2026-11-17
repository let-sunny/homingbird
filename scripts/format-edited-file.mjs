import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const FORMATTED = /\.(ts|tsx|js|mjs|json|css)$/

const input = await new Response(process.stdin).text()
const filePath = parseFilePath(input)

if (filePath !== null && FORMATTED.test(filePath) && existsSync(filePath)) {
  spawnSync('npx', ['biome', 'check', '--write', filePath], { stdio: 'ignore' })
}

function parseFilePath(text) {
  try {
    return JSON.parse(text).tool_input?.file_path ?? null
  } catch {
    return null
  }
}
