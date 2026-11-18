import { Result } from '@homingbird/kernel'
import type { RegisteredClient } from './oauth.ts'
import { isAcceptableRedirectUri } from './redirect-policy.ts'

export const parseConfiguredClients = (
  value: string | undefined,
): Result.Result<ReadonlyArray<RegisteredClient>, ReadonlyArray<string>> => {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  const parsed = entries.map((entry, index) => parseEntry(entry, index + 1))
  const problems = parsed.flatMap((entry) => entry.problems)
  const ids = parsed.map((entry) => entry.client.client_id)
  const duplicates = [...new Set(ids.filter((id, index) => id !== '' && ids.indexOf(id) !== index))]
  problems.push(...duplicates.map((id) => `${VARIABLE}: client id "${id}" is listed more than once`))
  return problems.length > 0 ? Result.err(problems) : Result.ok(parsed.map((entry) => entry.client))
}

const VARIABLE = 'HB_OAUTH_CLIENTS'
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,99}$/
const RESERVED_PREFIX = 'client_'
const MAX_NAME_LENGTH = 200
const MAX_REDIRECT_URIS = 10

const parseEntry = (
  entry: string,
  position: number,
): { readonly client: RegisteredClient; readonly problems: ReadonlyArray<string> } => {
  const parts = entry.split('|').map((part) => part.trim())
  const [id = '', name = '', uriList = ''] = parts
  const uris = uriList
    .split(';')
    .map((uri) => uri.trim())
    .filter((uri) => uri !== '')
  const label = `${VARIABLE}: client ${position}${CLIENT_ID.test(id) ? ` ("${id}")` : ''}`
  const problems = [
    parts.length !== 3 ? `${label} must be written as id|Name|redirect;redirect` : null,
    !CLIENT_ID.test(id)
      ? `${label} needs an id of letters, digits, ".", "_", "~" or "-", at most 100 characters`
      : null,
    id.startsWith(RESERVED_PREFIX)
      ? `${label} may not start with "${RESERVED_PREFIX}", which registration uses`
      : null,
    name === '' || name.length > MAX_NAME_LENGTH
      ? `${label} needs a name of 1 to ${MAX_NAME_LENGTH} characters`
      : null,
    uris.length === 0 || uris.length > MAX_REDIRECT_URIS
      ? `${label} needs 1 to ${MAX_REDIRECT_URIS} redirect URIs separated by ";"`
      : null,
    ...uris
      .filter((uri) => !isAcceptableRedirectUri(uri))
      .map(
        (uri) =>
          `${label} has redirect URI "${uri}", which must be https, loopback http, or an app scheme, without a fragment`,
      ),
  ].filter((problem): problem is string => problem !== null)
  return {
    client: { client_id: CLIENT_ID.test(id) ? id : '', client_name: name, redirect_uris: uris },
    problems,
  }
}
