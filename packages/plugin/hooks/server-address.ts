import type { EngineInterface } from 'claude-code'

import { hostOr } from './effects'
import { T } from './kernel.mjs'

export type ServerCheck =
  | { readonly kind: 'found'; readonly server: string }
  | { readonly kind: 'not-https' | 'unreachable' | 'not-homingbird'; readonly typed: string }

/** Checks that an address names a Homingbird server before anything signs in to it. */
export function checkServer($: Pick<EngineInterface, 'http'>, typed: string): T.Task<ServerCheck> {
  return T.gen(function* () {
    const address = typed.trim().replace(/\/+$/, '')
    const parts = ADDRESS.exec(address)
    if (parts === null) return { kind: 'not-https', typed: address } as const
    const [, scheme = '', host = ''] = parts
    if (scheme.toLowerCase() !== 'https' && !LOOPBACK.test(host))
      return { kind: 'not-https', typed: address } as const
    const answer = yield* hostOr(() => $.http.fetch(`${address}/api/v1/info`), null)
    if (answer === null) return { kind: 'unreachable', typed: address } as const
    return answer.ok && nameIn(answer.text) === 'dovecote'
      ? ({ kind: 'found', server: address } as const)
      : ({ kind: 'not-homingbird', typed: address } as const)
  })
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
