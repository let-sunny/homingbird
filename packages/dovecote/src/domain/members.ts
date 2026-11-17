import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type DirectoryEntry,
  type Member,
  MemberId,
  type MemberStatus,
  NotFound,
  type Role,
  canMessage,
  relation,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, likePattern, list, sql } from '../sql/query.ts'
import { type Ties, tiesOf } from './contacts.ts'
import { readSettings } from './settings.ts'

export const directoryFor = (viewerId: MemberId, search: string | undefined): T.Task<DirectoryEntry[], never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const settings = yield* readSettings
    const ties = yield* tiesOf(viewerId)
    const rows = yield* all<MemberRow>(
      search
        ? sql`SELECT * FROM members WHERE status = 'active' AND (LOWER(name) LIKE ${likePattern(search)} OR LOWER(email) LIKE ${likePattern(search)} OR LOWER(profile) LIKE ${likePattern(search)}) ORDER BY name LIMIT ${DIRECTORY_LIMIT}`
        : sql`SELECT * FROM members WHERE status = 'active' ORDER BY name LIMIT ${DIRECTORY_LIMIT}`,
    )
    return rows.map((row) => {
      const member = toMember(row)
      return {
        member,
        presence: env.hub.presenceOf(member.id),
        lastSeenAt: row.last_seen_at,
        relation: relation(relationFacts(viewerId, member.id, ties)),
        canMessage: canMessage(messagingFacts(settings.contactMode, viewerId, member, ties)),
      }
    })
  })

export const memberById = (id: MemberId): T.Task<Member, NotFound, AppEnv> =>
  T.gen(function* () {
    const row = yield* first<MemberRow>(sql`SELECT * FROM members WHERE id = ${id}`)
    return row === null ? yield* T.fail(NotFound({ message: 'No such member.' })) : toMember(row)
  })

export const membersByIds = (ids: ReadonlyArray<MemberId>): T.Task<Map<MemberId, Member>, never, AppEnv> =>
  T.gen(function* () {
    if (ids.length === 0) return new Map()
    const rows = yield* all<MemberRow>(sql`SELECT * FROM members WHERE id IN ${list([...new Set(ids)])}`)
    return new Map(rows.map((row) => [row.id, toMember(row)]))
  })

export const allMembers: T.Task<Member[], never, AppEnv> = T.map((rows: ReadonlyArray<MemberRow>) => rows.map(toMember))(
  all<MemberRow>(sql`SELECT * FROM members ORDER BY name`),
)

export interface Identity {
  readonly subject: string
  readonly email: string
  readonly name: string
}

export const signInMember = (identity: Identity): T.Task<Member, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const email = identity.email.toLowerCase()
    const existing = yield* first<MemberRow>(
      sql`SELECT * FROM members WHERE subject = ${identity.subject} OR email = ${email}`,
    )
    if (existing !== null) {
      yield* run(sql`UPDATE members SET subject = ${identity.subject}, email = ${email} WHERE id = ${existing.id}`)
      return toMember({ ...existing, email })
    }
    const isFirstMember = (yield* first(sql`SELECT id FROM members LIMIT 1`)) === null
    const member: Member = {
      id: MemberId.of(env.random.identifier()),
      email,
      name: identity.name.slice(0, 200) || email,
      profile: '',
      role: isFirstMember || env.config.adminEmails.includes(email) ? 'admin' : 'member',
      status: 'active',
      createdAt: env.clock.now(),
    }
    yield* run(
      insertInto('members', {
        id: member.id,
        email,
        subject: identity.subject,
        name: member.name,
        profile: '',
        role: member.role,
        status: member.status,
        event_seq: 0,
        created_at: member.createdAt,
        last_seen_at: null,
      }),
    )
    return member
  })

export const updateOwnProfile = (
  id: MemberId,
  changes: { readonly name?: string; readonly profile?: string },
): T.Task<Member, NotFound, AppEnv> =>
  T.gen(function* () {
    if (changes.name !== undefined) yield* run(sql`UPDATE members SET name = ${changes.name} WHERE id = ${id}`)
    if (changes.profile !== undefined) yield* run(sql`UPDATE members SET profile = ${changes.profile} WHERE id = ${id}`)
    return yield* memberById(id)
  })

export const administerMember = (
  actorId: MemberId,
  id: MemberId,
  changes: { readonly status?: MemberStatus; readonly role?: Role },
): T.Task<Member, NotFound | Conflict, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    yield* memberById(id)
    if (id === actorId) return yield* T.fail(Conflict({ message: 'Admins cannot change their own status or role.' }))
    if (changes.role !== undefined) yield* run(sql`UPDATE members SET role = ${changes.role} WHERE id = ${id}`)
    if (changes.status !== undefined) yield* run(sql`UPDATE members SET status = ${changes.status} WHERE id = ${id}`)
    if (changes.status === 'deactivated')
      yield* run(sql`UPDATE credentials SET revoked_at = ${env.clock.now()} WHERE member_id = ${id} AND revoked_at IS NULL`)
    return yield* memberById(id)
  })

export const touchLastSeen = (id: MemberId): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    yield* run(sql`UPDATE members SET last_seen_at = ${env.clock.now()} WHERE id = ${id}`)
  })

export const messagingFacts = (mode: 'open' | 'contacts', viewerId: MemberId, other: Member, ties: Ties) => ({
  mode,
  isSelf: other.id === viewerId,
  recipientStatus: other.status,
  blocked: ties.blockedByViewer.has(other.id) || ties.blockingViewer.has(other.id),
  contact: ties.contacts.get(other.id) === 'accepted',
})

export interface MemberRow {
  readonly id: MemberId
  readonly email: string
  readonly name: string
  readonly profile: string
  readonly role: Role
  readonly status: MemberStatus
  readonly created_at: number
  readonly last_seen_at: number | null
}

export const toMember = (row: MemberRow): Member => ({
  id: row.id,
  email: row.email,
  name: row.name,
  profile: row.profile,
  role: row.role,
  status: row.status,
  createdAt: row.created_at,
})

const DIRECTORY_LIMIT = 500

const relationFacts = (viewerId: MemberId, otherId: MemberId, ties: Ties) => ({
  isSelf: otherId === viewerId,
  blockedByViewer: ties.blockedByViewer.has(otherId),
  contact: ties.contacts.get(otherId) ?? null,
})
