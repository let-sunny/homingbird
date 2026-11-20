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

/** Names are compared in capitals, as Windows reads every variable name. */
export const PARENT_SESSION_VARIABLES: ReadonlySet<string> = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_DESKTOP_APP_VERSION',
  'CLAUDE_EFFORT',
  'CLAUDE_PID',
  'CLAUDE_AGENT_SDK_VERSION',
  'CODEX_THREAD_ID',
  'CODEX_SESSION_ID',
  'CODEX_TOOL_CALL_ID',
  'CODEX_VERSION',
  'CODEX_CI',
  'CODEX_PERMISSION_PROFILE',
])

const WITHHELD_NAME = /^(?:HOMINGBIRD|HB)_/i

const isWithheld = (name: string, value: string, secrets: ReadonlyArray<string>): boolean =>
  WITHHELD_NAME.test(name) ||
  PARENT_SESSION_VARIABLES.has(name.toUpperCase()) ||
  secrets.some((secret) => secret !== '' && value.includes(secret))
