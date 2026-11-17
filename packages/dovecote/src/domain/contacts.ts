import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type Contact,
  type ContactState,
  Forbidden,
  type MemberId,
  NotFound,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { type RequestEnv, emit } from '../events/events.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { insertIgnoringConflict, insertInto, sql } from '../sql/query.ts'

export interface Ties {
  readonly contacts: ReadonlyMap<MemberId, ContactState>
  readonly since: ReadonlyMap<MemberId, number>
  readonly blockedByViewer: ReadonlySet<MemberId>
  readonly blockingViewer: ReadonlySet<MemberId>
}

export const tiesOf = (viewerId: MemberId): T.Task<Ties, never, AppEnv> =>
  T.gen(function* () {
    const contactRows = yield* all<ContactRow>(
      sql`SELECT * FROM contacts WHERE low_id = ${viewerId} OR high_id = ${viewerId}`,
    )
    const blockRows = yield* all<{ blocker_id: MemberId; blocked_id: MemberId }>(
      sql`SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id = ${viewerId} OR blocked_id = ${viewerId}`,
    )
    const otherOf = (row: ContactRow): MemberId => (row.low_id === viewerId ? row.high_id : row.low_id)
    return {
      contacts: new Map(contactRows.map((row) => [otherOf(row), stateFor(viewerId, row)])),
      since: new Map(contactRows.map((row) => [otherOf(row), row.created_at])),
      blockedByViewer: new Set(
        blockRows.filter((row) => row.blocker_id === viewerId).map((row) => row.blocked_id),
      ),
      blockingViewer: new Set(
        blockRows.filter((row) => row.blocked_id === viewerId).map((row) => row.blocker_id),
      ),
    }
  })

export const listContacts = (
  viewerId: MemberId,
): T.Task<{ contacts: Contact[]; blocked: MemberId[] }, never, AppEnv> =>
  T.map((ties: Ties) => ({
    contacts: [...ties.contacts].map(([memberId, state]) => ({
      memberId,
      state,
      since: ties.since.get(memberId)!,
    })),
    blocked: [...ties.blockedByViewer],
  }))(tiesOf(viewerId))

export const requestContact = (
  viewerId: MemberId,
  otherId: MemberId,
): T.Task<Contact, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (otherId === viewerId)
      return yield* T.fail(Conflict({ message: 'You cannot add yourself as a contact.' }))
    const other = yield* first<{ status: string }>(sql`SELECT status FROM members WHERE id = ${otherId}`)
    if (other === null || other.status !== 'active')
      return yield* T.fail(NotFound({ message: 'No such member.' }))
    const ties = yield* tiesOf(viewerId)
    if (ties.blockedByViewer.has(otherId) || ties.blockingViewer.has(otherId))
      return yield* T.fail(Forbidden({ message: 'You cannot send a contact request to this member.' }))
    const existing = ties.contacts.get(otherId)
    if (existing === 'request_received') return yield* acceptContact(viewerId, otherId)
    if (existing !== undefined) return { memberId: otherId, state: existing, since: ties.since.get(otherId)! }
    const [low, high] = ordered(viewerId, otherId)
    const now = env.clock.now()
    yield* run(
      insertInto('contacts', {
        low_id: low,
        high_id: high,
        requested_by: viewerId,
        status: 'pending',
        created_at: now,
      }),
    )
    yield* emit([viewerId], { type: 'contact.changed', memberId: otherId })
    yield* emit([otherId], { type: 'contact.changed', memberId: viewerId })
    return { memberId: otherId, state: 'request_sent', since: now }
  })

export const acceptContact = (viewerId: MemberId, otherId: MemberId): T.Task<Contact, NotFound, RequestEnv> =>
  T.gen(function* () {
    const [low, high] = ordered(viewerId, otherId)
    const changed = yield* run(
      sql`UPDATE contacts SET status = 'accepted' WHERE low_id = ${low} AND high_id = ${high} AND requested_by = ${otherId}`,
    )
    const row = yield* first<ContactRow>(
      sql`SELECT * FROM contacts WHERE low_id = ${low} AND high_id = ${high}`,
    )
    if (row === null || row.status !== 'accepted')
      return yield* T.fail(NotFound({ message: 'There is no contact request from this member.' }))
    if (changed > 0) {
      yield* emit([viewerId], { type: 'contact.changed', memberId: otherId })
      yield* emit([otherId], { type: 'contact.changed', memberId: viewerId })
    }
    return { memberId: otherId, state: 'accepted', since: row.created_at }
  })

export const removeContact = (viewerId: MemberId, otherId: MemberId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const [low, high] = ordered(viewerId, otherId)
    const removed = yield* run(sql`DELETE FROM contacts WHERE low_id = ${low} AND high_id = ${high}`)
    if (removed === 0) return
    yield* emit([viewerId], { type: 'contact.changed', memberId: otherId })
    yield* emit([otherId], { type: 'contact.changed', memberId: viewerId })
  })

export const block = (viewerId: MemberId, otherId: MemberId): T.Task<void, Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (otherId === viewerId) return yield* T.fail(Conflict({ message: 'You cannot block yourself.' }))
    yield* run(
      insertIgnoringConflict(yield* dialect, 'blocks', {
        blocker_id: viewerId,
        blocked_id: otherId,
        created_at: env.clock.now(),
      }),
    )
    yield* removeContact(viewerId, otherId)
    yield* emit([viewerId], { type: 'contact.changed', memberId: otherId })
  })

export const unblock = (viewerId: MemberId, otherId: MemberId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    yield* run(sql`DELETE FROM blocks WHERE blocker_id = ${viewerId} AND blocked_id = ${otherId}`)
    yield* emit([viewerId], { type: 'contact.changed', memberId: otherId })
  })

interface ContactRow {
  readonly low_id: MemberId
  readonly high_id: MemberId
  readonly requested_by: MemberId
  readonly status: 'pending' | 'accepted'
  readonly created_at: number
}

const ordered = (a: MemberId, b: MemberId): [MemberId, MemberId] => (a < b ? [a, b] : [b, a])

const stateFor = (viewerId: MemberId, row: ContactRow): ContactState =>
  row.status === 'accepted' ? 'accepted' : row.requested_by === viewerId ? 'request_sent' : 'request_received'
