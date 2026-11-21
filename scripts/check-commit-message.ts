import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const problemsWith = (message: string): string[] => {
  const lines = message
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.trimEnd())
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  const header = lines[0] ?? ''
  if (isExempt(header)) return []
  const parts = HEADER.exec(header)
  if (parts === null)
    return [
      `The first line must read "<type>(<scope>): <summary>", such as "fix(dovecote): refuse an archived room". Types: ${TYPES.join(', ')}. Scopes: ${SCOPES.join(', ')}.`,
    ]
  const summary = parts.groups!.summary!
  const problems: string[] = []
  if (summary.length > SUMMARY_MAX)
    problems.push(`The summary has ${summary.length} characters; keep it to ${SUMMARY_MAX}.`)
  if (/^[A-Z]/.test(summary)) problems.push('Start the summary with a lower-case letter.')
  if (summary.endsWith('.')) problems.push('End the summary without a period.')
  if (lines.length > 1 && lines[1] !== '') problems.push('Leave the second line empty.')
  if (withoutTrailers(lines.slice(2)).every((line) => line.trim() === ''))
    problems.push('Add a body that says why the change was made.')
  return problems
}

export const TYPES = ['feat', 'fix', 'docs', 'test', 'refactor', 'perf', 'build', 'ci', 'chore'] as const

export const SCOPES = [
  'kernel',
  'protocol',
  'dovecote',
  'client',
  'ui',
  'pwa',
  'cli',
  'mcp',
  'a2a',
  'plugin',
  'sprites',
  'demo',
  'deploy',
  'release',
  'repo',
] as const

export const SUMMARY_MAX = 72

export const HEADER = new RegExp(
  `^(?<type>${TYPES.join('|')})(?:\\((?<scope>${SCOPES.join('|')})\\))?(?<breaking>!)?: (?<summary>\\S.*)$`,
)

const TRAILER =
  /^(?:Co-authored-by|Signed-off-by|Reviewed-by|Acked-by|Claude-Session|Refs|Fixes|BREAKING CHANGE|BREAKING-CHANGE): \S/i

const withoutTrailers = (body: ReadonlyArray<string>): ReadonlyArray<string> => {
  const lastBreak = body.lastIndexOf('')
  const last = body.slice(lastBreak + 1)
  return last.length > 0 && last.every((line) => TRAILER.test(line))
    ? body.slice(0, Math.max(lastBreak, 0))
    : body
}

const isExempt = (header: string): boolean =>
  header.startsWith('Merge ') || header === 'Version Packages' || header.startsWith('Revert "')

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file] = process.argv.slice(2)
  const messages =
    file === undefined || file === '-'
      ? readFileSync(0, 'utf8')
          .split('\0')
          .map((message) => message.replace(/^\n+/, ''))
          .filter((message) => message.trim() !== '')
      : [readFileSync(file, 'utf8')]
  let failed = false
  for (const message of messages) {
    const problems = problemsWith(message)
    if (problems.length === 0) continue
    failed = true
    process.stderr.write(
      `${message.split('\n')[0]}\n${problems.map((problem) => `  ${problem}`).join('\n')}\n`,
    )
  }
  if (failed) process.exit(1)
}
