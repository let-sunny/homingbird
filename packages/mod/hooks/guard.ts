export const forbiddenReason = (toolName: string, input: unknown): string | null => {
  if (toolName.startsWith(OWN_TOOL_PREFIX)) return null
  const text = searchable(input)
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text)))
    return 'homingbird: the credential files on this device are not for the model to read or change.'
  if (APPROVAL_COMMAND.test(text))
    return 'homingbird: only a person can approve or discard a note, with the buttons in the Homingbird pane.'
  return null
}

const OWN_TOOL_PREFIX = 'mcp__homingbird__'

const CREDENTIAL_PATTERNS: ReadonlyArray<RegExp> = [
  /(agent|approval)-credential(\.json)?/,
  /\.config[\\/]+homingbird/,
  /xdg_config_home[^\n]{0,40}homingbird/,
]

const APPROVAL_COMMAND = /homingbird(?:\.js|[\\/]cli)?["']?\s+(?:--?[\w-]+(?:[= ]\S+)?\s+)*["']?(?:approve|discard)\b/

const searchable = (input: unknown): string => {
  try {
    return JSON.stringify(input ?? '').replace(/\\"/g, '"').toLowerCase()
  } catch {
    return ''
  }
}
