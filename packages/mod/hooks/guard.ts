import { TOOL_PREFIX } from './tools'

export const forbiddenReason = (toolName: string, input: unknown): string | null => {
  if (toolName.startsWith(TOOL_PREFIX)) return null
  const text = searchable(input)
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text)))
    return 'homingbird: the credential files on this device are not for the model to read or change.'
  if (PERSON_ONLY_COMMAND.test(text) || PERSON_ONLY_ROUTE.test(text))
    return 'homingbird: only a person can approve or discard a note or change contacts, with the buttons in the Homingbird pane or the web client.'
  return null
}

const CREDENTIAL_PATTERNS: ReadonlyArray<RegExp> = [
  /(agent|approval)-credential(\.json)?/,
  /\.config[\\/]+homingbird/,
  /xdg_config_home[^\n]{0,40}homingbird/,
]

const PERSON_ONLY_COMMAND =
  /(?:homingbird(?:\.[cm]?[jt]s|[\\/]cli)?|cli[\\/](?:src[\\/]main|dist[\\/]\w+)\.[cm]?[jt]s)["']?\s+(?:--?[\w-]+(?:[= ]\S+)?\s+)*["']?(?:approve|discard)\b/

const PERSON_ONLY_ROUTE = /\/api\/v1\/(?:drafts\/[^\s/"']+\/(?:send|discard)|contacts|blocks|credentials)\b/

const searchable = (input: unknown): string => {
  try {
    return JSON.stringify(input ?? '')
      .replace(/\\"/g, '"')
      .toLowerCase()
  } catch {
    return ''
  }
}
