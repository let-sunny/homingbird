import { Task as T } from '@homingbird/kernel'
import type { CredentialId, RouteName } from '@homingbird/protocol'
import type { AppEnv, Caller } from '../environment.ts'
import { transact } from '../events/events.ts'
import { hashSecret } from '../random.ts'
import { first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'

/** Counts a refused route: one `authz.denied` row per credential and route a minute, with a count. */
export const noteDenied = (caller: Caller, route: RouteName): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    yield* flushAttempts('due')
    env.attempts.count(`denied ${caller.credential.id} ${route}`, {
      kind: 'denied',
      caller,
      route,
      requestId: env.requestId,
    })
  })

/** Counts a refused token by its credential or its hash, never itself, and its address for a warning. */
export const noteRefused = (token: string, address: string): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    yield* flushAttempts('due')
    const tokenHash = hashSecret(token)
    const known = yield* first<{ id: CredentialId }>(
      sql`SELECT id FROM credentials WHERE token_hash = ${tokenHash} OR refresh_hash = ${tokenHash}`,
    )
    const credentialId = known?.id ?? null
    env.attempts.count(`refused ${credentialId ?? tokenHash}`, {
      kind: 'refused',
      credentialId,
      tokenHash: credentialId === null ? tokenHash.slice(0, 16) : null,
      requestId: env.requestId,
    })
    const clientAddress = truncatedAddress(address)
    env.attempts.count(`address ${clientAddress}`, { kind: 'address', clientAddress })
  })

/** Writes every window whose minute is over, or every window at shutdown. */
export const flushAttempts = (which: 'due' | 'all'): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    for (const window of env.attempts.take(which === 'all' ? Number.POSITIVE_INFINITY : env.clock.now()))
      yield* written(window)
  })

export interface AttemptWindows {
  readonly count: (key: string, attempt: Attempt) => void
  readonly take: (now: number) => ReadonlyArray<AttemptWindow>
}

export type Attempt =
  | {
      readonly kind: 'denied'
      readonly caller: Caller
      readonly route: RouteName
      readonly requestId: string | null
    }
  | {
      readonly kind: 'refused'
      readonly credentialId: CredentialId | null
      readonly tokenHash: string | null
      readonly requestId: string | null
    }
  | { readonly kind: 'address'; readonly clientAddress: string }

export interface AttemptWindow {
  readonly attempt: Attempt
  readonly firstAt: number
  readonly count: number
}

export const makeAttemptWindows = (now: () => number): AttemptWindows => {
  const open = new Map<string, AttemptWindow>()
  return {
    count: (key, attempt) => {
      const window = open.get(key)
      open.set(
        key,
        window === undefined ? { attempt, firstAt: now(), count: 1 } : { ...window, count: window.count + 1 },
      )
    },
    take: (current) => {
      const due = [...open.entries()].filter(([, window]) => current - window.firstAt >= ATTEMPT_WINDOW_MS)
      for (const [key] of due) open.delete(key)
      return due.map(([, window]) => window)
    },
  }
}

/** An address cut to its network, /24 for IPv4 and /48 for IPv6, for a line that is not an audit row. */
export const truncatedAddress = (address: string): string => {
  const plain = address.replace(/^::ffff:/, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(plain)) return `${plain.split('.').slice(0, 3).join('.')}.0/24`
  if (plain.includes(':')) {
    const [head = ''] = plain.split('::')
    const groups = [...head.split(':').filter((group) => group !== ''), '0', '0', '0'].slice(0, 3)
    return `${groups.join(':')}::/48`
  }
  return 'unknown'
}

export const ATTEMPT_WINDOW_MS = 60_000

const written = (window: AttemptWindow): T.Task<void, never, AppEnv> => {
  const { attempt, firstAt, count } = window
  if (attempt.kind === 'address')
    return T.map((env: AppEnv) =>
      env.log.emit({
        name: 'authn.refused_burst',
        attributes: { clientAddress: attempt.clientAddress, count },
      }),
    )(T.ask<AppEnv>())
  const row =
    attempt.kind === 'denied'
      ? recordAudit('authz.denied', {
          caller: attempt.caller,
          targetId: attempt.route,
          outcome: 'denied',
          detail: { count, firstAt },
        })
      : recordAudit('authn.token_refused', {
          targetId: attempt.credentialId,
          outcome: 'denied',
          detail: { count, firstAt, ...(attempt.tokenHash !== null && { tokenHash: attempt.tokenHash }) },
        })
  return T.provide({ requestId: attempt.requestId })(transact(row))
}
