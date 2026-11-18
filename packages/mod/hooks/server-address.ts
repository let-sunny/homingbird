import type { EngineInterface } from 'claude-code'

export type ServerCheck =
  | { readonly kind: 'found'; readonly server: string }
  | { readonly kind: 'not-https' | 'unreachable' | 'not-homingbird'; readonly typed: string }

/** Checks that an address names a Homingbird server before anything signs in to it. */
export async function checkServer($: Pick<EngineInterface, 'http'>, typed: string): Promise<ServerCheck> {
  const address = typed.trim().replace(/\/+$/, '')
  const parts = ADDRESS.exec(address)
  if (parts === null) return { kind: 'not-https', typed: address }
  const [, scheme = '', host = ''] = parts
  if (scheme.toLowerCase() !== 'https' && !LOOPBACK.test(host)) return { kind: 'not-https', typed: address }
  const answer = await $.http.fetch(`${address}/api/v1/info`).catch(() => null)
  if (answer === null) return { kind: 'unreachable', typed: address }
  return answer.ok && nameIn(answer.text) === 'dovecote'
    ? { kind: 'found', server: address }
    : { kind: 'not-homingbird', typed: address }
}

export const looksLikeAddress = (word: string): boolean => /^https?:\/\//i.test(word.trim())

export const SERVER_SETTING = 'homingbird.server'

const ADDRESS = /^(https?):\/\/([^/\s?#@]+)(\/[^\s?#]*)?$/i
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

const nameIn = (text: string): unknown => {
  try {
    return (JSON.parse(text) as { name?: unknown } | null)?.name
  } catch {
    return undefined
  }
}
