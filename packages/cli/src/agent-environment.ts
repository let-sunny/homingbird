/**
 * The environment an agent command runs with: the person's own, without Homingbird's variables, any
 * value holding a secret, and the variables by which a Claude Code or Codex session that started the
 * runner marks its own child processes. An agent command is a session of its own, never part of that one.
 */
export const agentEnvironment = (
  variables: Readonly<Record<string, string | undefined>>,
  secrets: ReadonlyArray<string>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(variables).flatMap(([name, value]) =>
      value === undefined || isWithheld(name, value, secrets) ? [] : [[name, value]],
    ),
  )

/**
 * Claude Code variables a person sets themself for the agent, which it keeps; every other
 * `CLAUDE_CODE_` variable is one a Claude Code session sets for its own children.
 */
export const PERSON_CLAUDE_CODE_VARIABLES: ReadonlySet<string> = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_GIT_BASH_PATH',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
])

/** Names are compared in capitals, as Windows reads every variable name. */
export const PARENT_SESSION_VARIABLES: ReadonlySet<string> = new Set([
  'CLAUDECODE',
  'CLAUDE_EFFORT',
  'CLAUDE_PID',
  'MCP_SERVER_CONNECTION_BATCH_SIZE',
  'CODEX_THREAD_ID',
  'CODEX_SESSION_ID',
  'CODEX_TOOL_CALL_ID',
  'CODEX_VERSION',
  'CODEX_CI',
  'CODEX_PERMISSION_PROFILE',
])

const PARENT_SESSION_PREFIXES = ['CLAUDE_CODE_', 'CLAUDE_AGENT_SDK_', 'CLAUDE_PREVIEW_']

const isParentSession = (name: string): boolean => {
  const upper = name.toUpperCase()
  if (PARENT_SESSION_VARIABLES.has(upper)) return true
  return (
    PARENT_SESSION_PREFIXES.some((prefix) => upper.startsWith(prefix)) &&
    !PERSON_CLAUDE_CODE_VARIABLES.has(upper)
  )
}

const WITHHELD_NAME = /^(?:HOMINGBIRD|HB)_/i

const isWithheld = (name: string, value: string, secrets: ReadonlyArray<string>): boolean =>
  WITHHELD_NAME.test(name) ||
  isParentSession(name) ||
  secrets.some((secret) => secret !== '' && value.includes(secret))
