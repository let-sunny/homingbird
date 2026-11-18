import { type Stream, Task as T } from '@homingbird/kernel'
import type { CredentialKind, EventBody, MemberId, StreamEvent } from '@homingbird/protocol'
import type { AuditRecord } from '../domain/audit.ts'
import type { AppEnv } from '../environment.ts'
import { all, first, inTransaction, run } from '../sql/database.ts'
import { insertInto, sql } from '../sql/query.ts'

export const EVERYONE = Symbol('everyone')

export interface Delivery {
  readonly memberId: MemberId | typeof EVERYONE
  readonly event: StreamEvent
}

export interface RequestEnv extends AppEnv {
  readonly outbox: Delivery[]
  readonly audited: AuditRecord[]
}

export const transact = <A, E>(task: T.Task<A, E, RequestEnv>): T.Task<A, E, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const outbox: Delivery[] = []
    const audited: AuditRecord[] = []
    const value = yield* T.provide({ outbox, audited })(inTransaction(task)) as T.Task<A, E, AppEnv>
    for (const delivery of outbox) {
      if (delivery.memberId === EVERYONE) {
        env.hub.broadcast(delivery.event)
        continue
      }
      env.hub.publish(delivery.memberId, delivery.event)
      env.pushSink(delivery.memberId, delivery.event)
    }
    for (const record of audited) env.auditSink(record)
    return value
  })

export const emit = (recipients: Iterable<MemberId>, body: EventBody): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const at = env.clock.now()
    for (const memberId of new Set(recipients)) {
      yield* run(sql`UPDATE members SET event_seq = event_seq + 1 WHERE id = ${memberId}`)
      const row = yield* first<{ event_seq: number }>(
        sql`SELECT event_seq FROM members WHERE id = ${memberId}`,
      )
      if (row === null) continue
      const event: StreamEvent = { seq: row.event_seq, at, body }
      yield* run(
        insertInto('events', {
          member_id: memberId,
          seq: event.seq,
          created_at: at,
          body: JSON.stringify(body),
        }),
      )
      env.outbox.push({ memberId, event })
    }
  })

export const announceDirectoryChange = (memberId: MemberId): T.Task<void, never, RequestEnv> =>
  T.map((env: RequestEnv) => {
    env.outbox.push({
      memberId: EVERYONE,
      event: { seq: 0, at: env.clock.now(), body: { type: 'directory.changed', memberId } },
    })
  })(T.ask<RequestEnv>())

export const eventsAfter = (
  memberId: MemberId,
  after: number,
  limit = REPLAY_LIMIT,
): T.Task<{ readonly events: StreamEvent[]; readonly cursor: number }, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const member = yield* first<{ event_seq: number }>(
      sql`SELECT event_seq FROM members WHERE id = ${memberId}`,
    )
    const latest = member?.event_seq ?? 0
    if (after >= latest) return { events: [], cursor: latest }
    const rows = yield* all<EventRow>(
      sql`SELECT seq, created_at, body FROM events WHERE member_id = ${memberId} AND seq > ${after} ORDER BY seq LIMIT ${limit}`,
    )
    const events = rows.map(toEvent)
    const hasGap = events.length === 0 || events[0]!.seq !== after + 1
    if (hasGap) return { events: [resync(env.clock.now())], cursor: latest }
    return { events, cursor: events.at(-1)!.seq }
  })

export const liveEvents = (
  memberId: MemberId,
  kind: CredentialKind,
  after: number | null,
  signal: AbortSignal,
): T.Task<Stream.Stream<StreamEvent>, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const subscription = env.hub.subscribe(memberId, kind, signal)
    const firstPage = after === null ? null : yield* eventsAfter(memberId, after)
    return {
      async *[Symbol.asyncIterator]() {
        try {
          let cursor = 0
          let page = firstPage
          while (page !== null) {
            yield* page.events
            cursor = page.cursor
            if (page.events.length < REPLAY_LIMIT) break
            const next = await T.run(eventsAfter(memberId, cursor), env, signal)
            if (next._tag === 'Err') return
            page = next.value
          }
          for await (const event of subscription) {
            if (event.seq !== 0 && event.seq <= cursor) continue
            yield event
          }
          if (subscription.overflowed()) yield resync(env.clock.now())
        } finally {
          subscription.close()
        }
      },
    }
  })

export const waitForEvents = (
  memberId: MemberId,
  after: number,
  waitMs: number,
): T.Task<{ readonly events: StreamEvent[]; readonly cursor: number }, never, AppEnv> =>
  T.gen(function* () {
    const ready = yield* eventsAfter(memberId, after)
    if (ready.events.length > 0 || waitMs <= 0) return ready
    return yield* T.scoped((scope) =>
      T.gen(function* () {
        const env = yield* T.ask<AppEnv>()
        const waiting = new AbortController()
        yield* scope.addFinalizer(T.sync(() => waiting.abort()))
        const subscription = env.hub.subscribe(memberId, 'hidden', waiting.signal)
        const firstDurable = T.promise(async () => {
          for await (const event of subscription) if (event.seq !== 0) return
        })
        yield* T.race([firstDurable, T.sleep(waitMs)])
        return yield* eventsAfter(memberId, after)
      }),
    )
  })

export const REPLAY_LIMIT = 500

export const deleteEventsBefore = (cutoff: number): T.Task<number, never, AppEnv> =>
  run(sql`DELETE FROM events WHERE created_at < ${cutoff}`)

interface EventRow {
  readonly seq: number
  readonly created_at: number
  readonly body: string
}

const toEvent = (row: EventRow): StreamEvent => ({
  seq: row.seq,
  at: row.created_at,
  body: JSON.parse(row.body) as EventBody,
})

const resync = (at: number): StreamEvent => ({ seq: 0, at, body: { type: 'resync' } })
