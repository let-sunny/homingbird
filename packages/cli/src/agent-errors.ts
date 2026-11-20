import type { AgentRun } from './environment.ts'

/**
 * The first line an agent command wrote to its error output, to say why it failed: one line of at most
 * 160 characters, without control characters and with every secret replaced. It can still quote a
 * note only if the program repeats its prompt in its own first error line.
 */
export const firstErrorLine = (run: AgentRun, secrets: ReadonlyArray<string>): string | null => {
  const line = (run.errors ?? '')
    .split(/\r?\n/)
    .map((each) => each.trim())
    .find((each) => each !== '')
  if (line === undefined) return null
  const withheld = secrets.reduce(
    (text, secret) => (secret === '' ? text : text.split(secret).join('[withheld]')),
    line,
  )
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control and format characters are what is removed.
  const clean = withheld.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
  return clean.length <= ERROR_LINE_MAX ? clean : `${clean.slice(0, ERROR_LINE_MAX - 1)}…`
}

/**
 * Whether Claude Code refused `--strict-mcp-config` because the organization's managed MCP
 * configuration is present, which only a run without it can get past.
 */
export const isManagedMcpRefusal = (run: AgentRun): boolean =>
  run.exitCode !== 0 && MANAGED_MCP_REFUSAL.test(`${run.errors ?? ''}\n${run.output}`)

const MANAGED_MCP_REFUSAL = /cannot use --strict-mcp-config when an enterprise MCP config is present/i

const ERROR_LINE_MAX = 160
