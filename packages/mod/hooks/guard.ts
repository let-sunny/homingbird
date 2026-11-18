import { TOOL_PREFIX } from './tools'

export const forbiddenReason = (toolName: string, input: unknown): string | null => {
  if (toolName.startsWith(TOOL_PREFIX)) return null
  const text = searchable(input)
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))
    ? 'homingbird: the credential files on this device are not for the model to read or change; use the Homingbird tools.'
    : null
}

const CREDENTIAL_PATTERNS: ReadonlyArray<RegExp> = [
  /agent-credential(\.json)?/,
  /\.config[\\/]+homingbird/,
  /xdg_config_home[^\n]{0,40}homingbird/,
]

const searchable = (input: unknown): string => {
  try {
    return JSON.stringify(input ?? '')
      .replace(/\\"/g, '"')
      .toLowerCase()
  } catch {
    return ''
  }
}
