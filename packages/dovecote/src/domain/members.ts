import { Task as T } from '@homingbird/kernel'
import {
  CharacterSpec,
  Conflict,
  type DirectoryEntry,
  Locale,
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
import { containsIgnoringCase, insertInto, list, sql } from '../sql/query.ts'
import { channelsHelpedBy, helpersOfChannelSeenBy } from './channels.ts'
import { type Ties, tiesOf } from './contacts.ts'
import { agentIntroductionsOf } from './principles.ts'
import { featureIsOn, readSettings } from './settings.ts'

export const directoryFor = (
  viewer: Pick<Member, 'id' | 'role'>,
  search: string | undefined,
  channel?: string,
): T.Task<DirectoryEntry[], never, AppEnv> =>
  T.gen(function* () {
    const viewerId = viewer.id
    const env = yield* T.ask<AppEnv>()
    const settings = yield* readSettings
    const ties = yield* tiesOf(viewerId)
    const matching = search
      ? sql`AND (${containsIgnoringCase('name', search)} OR ${containsIgnoringCase('email', search)} OR ${containsIgnoringCase('profile', search)})`
      : sql``
    const helping = channel ? sql`AND id IN (${helpersOfChannelSeenBy(viewerId, channel)})` : sql``
    const rows = yield* all<MemberRow>(
      sql`SELECT * FROM members WHERE status = 'active' ${matching} ${helping} ORDER BY name LIMIT ${DIRECTORY_LIMIT}`,
    )
    const channels = yield* channelsHelpedBy(
      viewer,
      rows.map((row) => row.id),
    )
    const introductions = yield* agentIntroductionsOf(rows.map((row) => row.id))
    const characters = yield* featureIsOn('characters')
    return rows.map((row) => {
      const member = characters || row.id === viewerId ? toMember(row) : withoutCharacter(toMember(row))
      return {
        member,
        presence: env.hub.presenceOf(member.id),
        lastSeenAt: row.last_seen_at,
        relation: relation(relationFacts(viewerId, member.id, ties)),
        canMessage: canMessage(messagingFacts(settings.contactMode, viewerId, member, ties)),
        channels: channels.get(member.id) ?? [],
        agentIntroduction: introductions.get(member.id) ?? [],
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
    const characters = yield* featureIsOn('characters')
    return new Map(rows.map((row) => [row.id, characters ? toMember(row) : withoutCharacter(toMember(row))]))
  })

export const allMembers: T.Task<Member[], never, AppEnv> = T.gen(function* () {
  const rows = yield* all<MemberRow>(sql`SELECT * FROM members ORDER BY name`)
  const characters = yield* featureIsOn('characters')
  return rows.map((row) => (characters ? toMember(row) : withoutCharacter(toMember(row))))
})

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
      const role = env.config.adminEmails.includes(email) ? 'admin' : existing.role
      yield* run(
        sql`UPDATE members SET subject = ${identity.subject}, email = ${email}, role = ${role} WHERE id = ${existing.id}`,
      )
      return toMember({ ...existing, email, role })
    }
    const isFirstDevelopmentMember =
      env.config.identity.devLogin && (yield* first(sql`SELECT id FROM members LIMIT 1`)) === null
    const member: Member = {
      id: MemberId.of(env.random.identifier()),
      email,
      name: identity.name.slice(0, 200) || email,
      profile: '',
      role: isFirstDevelopmentMember || env.config.adminEmails.includes(email) ? 'admin' : 'member',
      status: 'active',
      createdAt: env.clock.now(),
      character: null,
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
  changes: { readonly name?: string; readonly profile?: string; readonly locale?: Locale | null },
): T.Task<Member, NotFound, AppEnv> =>
  T.gen(function* () {
    if (changes.name !== undefined)
      yield* run(sql`UPDATE members SET name = ${changes.name} WHERE id = ${id}`)
    if (changes.profile !== undefined)
      yield* run(sql`UPDATE members SET profile = ${changes.profile} WHERE id = ${id}`)
    if (changes.locale !== undefined)
      yield* run(sql`UPDATE members SET locale = ${changes.locale} WHERE id = ${id}`)
    return yield* memberById(id)
  })

export const chosenLocaleOf = (id: MemberId): T.Task<Locale | null, never, AppEnv> =>
  T.map((row: { locale: unknown } | null) => (Locale.is(row?.locale) ? row.locale : null))(
    first<{ locale: unknown }>(sql`SELECT locale FROM members WHERE id = ${id}`),
  )

export const administerMember = (
  actorId: MemberId,
  id: MemberId,
  changes: { readonly status?: MemberStatus; readonly role?: Role },
): T.Task<Member, NotFound | Conflict, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    yield* memberById(id)
    if (id === actorId)
      return yield* T.fail(Conflict({ message: 'Admins cannot change their own status or role.' }))
    if (changes.role !== undefined)
      yield* run(sql`UPDATE members SET role = ${changes.role} WHERE id = ${id}`)
    if (changes.status !== undefined)
      yield* run(sql`UPDATE members SET status = ${changes.status} WHERE id = ${id}`)
    if (changes.status === 'deactivated')
      yield* run(
        sql`UPDATE credentials SET revoked_at = ${env.clock.now()} WHERE member_id = ${id} AND revoked_at IS NULL`,
      )
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
  readonly character_spec: string | null
}

/** With characters switched off, nobody's character reaches anyone else. */
const withoutCharacter = (member: Member): Member => ({ ...member, character: null })

export const toMember = (row: MemberRow): Member => ({
  id: row.id,
  email: row.email,
  name: row.name,
  profile: row.profile,
  role: row.role,
  status: row.status,
  createdAt: row.created_at,
  character: characterIn(row.character_spec),
})

const characterIn = (stored: string | null): CharacterSpec | null => {
  if (stored === null) return null
  const decoded = CharacterSpec.decode(JSON.parse(stored))
  return decoded._tag === 'Ok' ? decoded.value : null
}

const DIRECTORY_LIMIT = 500

const relationFacts = (viewerId: MemberId, otherId: MemberId, ties: Ties) => ({
  isSelf: otherId === viewerId,
  blockedByViewer: ties.blockedByViewer.has(otherId),
  contact: ties.contacts.get(otherId) ?? null,
})
