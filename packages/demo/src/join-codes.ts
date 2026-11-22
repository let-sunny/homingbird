import { Task as T } from '@homingbird/kernel'
import { type CredentialId, JOIN_CODE_LIFETIME_SECONDS, type MemberId, NotFound } from '@homingbird/protocol'
import { type Handlers, found } from './handlers.ts'
import { managersOf } from './reads.ts'
import type { JoinCodeRecord, Records, World } from './world.ts'

/**
 * Join codes, made and watched as on a server. No server can reach a Dovecote that lives in one
 * browser tab, so copying a code's line stands in for pasting it there: a few seconds later the code
 * is redeemed, as `homingbird setup` would, and "Run on a server" turns to the connection it made.
 */
export const joinCodeHandlers = (world: World): Handlers => ({
  'joinCodes.create': ({ body }, viewerId) =>
    T.gen(function* () {
      const memberId =
        body.channel === undefined ? viewerId : yield* agentManagedBy(world.records(), viewerId, body.channel)
      const now = world.clock.now()
      const id = world.nextId('join')
      const record: JoinCodeRecord = {
        id,
        code: `${JOIN_CODE_PREFIX}${world.nextId('demo')}`,
        createdBy: viewerId,
        memberId,
        expiresAt: now + JOIN_CODE_LIFETIME_SECONDS * 1000,
        issued: null,
      }
      world.update((records) => ({ ...records, joinCodes: [...records.joinCodes, record] }))
      return {
        id,
        code: record.code,
        serverUrl: DEMO_SERVER_ADDRESS,
        expiresAt: record.expiresAt,
        expiresInSeconds: JOIN_CODE_LIFETIME_SECONDS,
      }
    }),
  'joinCodes.status': ({ params }, viewerId) =>
    T.map((record: JoinCodeRecord) =>
      record.issued === null
        ? { status: 'waiting' as const }
        : { status: 'redeemed' as const, credential: record.issued },
    )(
      found(
        liveCode(world, (each) => each.id === params.id && each.createdBy === viewerId),
        'No such join code.',
      ),
    ),
})

/** Redeems the code in a copied line a few seconds later, as a server pasting it would. */
export const redeemCopiedJoinCode = (world: World, copied: string): void => {
  const code = /--join (hbj_\S+)/.exec(copied)?.[1]
  if (code === undefined) return
  world.after(REDEEM_AFTER_MS, () => {
    const record = liveCode(world, (each) => each.code === code && each.issued === null)
    if (record !== undefined) redeem(world, record)
  })
}

/** The server address the demo's commands name, which no real server answers. */
export const DEMO_SERVER_ADDRESS = 'https://homingbird.example.com'

const REDEEM_AFTER_MS = 4_000
const JOIN_CODE_PREFIX = 'hbj_'
const SERVER_NAME = 'Team server'

const liveCode = (world: World, matches: (record: JoinCodeRecord) => boolean): JoinCodeRecord | undefined =>
  world.records().joinCodes.find((each) => each.expiresAt > world.clock.now() && matches(each))

const redeem = (world: World, record: JoinCodeRecord): void => {
  const now = world.clock.now()
  const id = world.nextId('cred') as CredentialId
  const issued = { id, name: SERVER_NAME }
  world.update((records) => ({
    ...records,
    joinCodes: records.joinCodes.map((each) => (each.id === record.id ? { ...each, issued } : each)),
    credentials: [
      ...records.credentials,
      {
        credential: {
          id,
          kind: 'agent',
          name: SERVER_NAME,
          client: 'Homingbird CLI',
          createdAt: now,
          expiresAt: now + CREDENTIAL_DAYS * 86_400_000,
          lastUsedAt: now,
          revokedAt: null,
        },
        memberId: record.memberId,
        issuedBy: record.createdBy,
      },
    ],
  }))
}

const CREDENTIAL_DAYS = 90

/** A code for a channel's agent is made only by a manager of that channel (rule 6). */
const agentManagedBy = (records: Records, viewerId: MemberId, slug: string): T.Task<MemberId, NotFound> => {
  const channel = records.channels.find((each) => each.slug === slug)
  return channel !== undefined && channel.agentId !== null && managersOf(records, channel).includes(viewerId)
    ? T.succeed(channel.agentId)
    : T.fail(NotFound({ message: 'Only the managers of this channel run its agent.' }))
}
