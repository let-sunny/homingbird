import { Task as T } from '@homingbird/kernel'
import {
  INVITE_LIFETIME_SECONDS,
  type Invite,
  JOIN_CODE_LIFETIME_SECONDS,
  type MemberId,
  NotFound,
} from '@homingbird/protocol'
import { type Handlers, found } from './handlers.ts'
import { managersOf, memberById } from './reads.ts'
import type { Records, World } from './world.ts'

/**
 * Invite links, made, listed and revoked as on a server. Nothing redeems them: a new person cannot
 * reach a Dovecote that lives in one browser tab.
 */
export const inviteHandlers = (world: World): Handlers => ({
  'invites.list': (_, viewerId) =>
    T.sync(() => ({
      invites: world
        .records()
        .invites.filter(
          (invite) => invite.expiresAt > world.clock.now() && mayList(world.records(), viewerId, invite),
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    })),
  'invites.create': ({ body }, viewerId) =>
    T.sync(() => {
      const now = world.clock.now()
      const id = world.nextId('inv')
      const invite: Invite = {
        id,
        email: body.email?.toLowerCase() ?? null,
        createdBy: viewerId,
        createdAt: now,
        expiresAt: now + INVITE_LIFETIME_SECONDS * 1000,
      }
      world.update((records) => ({ ...records, invites: [...records.invites, invite] }))
      return { invite, url: `${world.publicUrl}/#/invite/${INVITE_PREFIX}${id}` }
    }),
  'invites.revoke': ({ params }, viewerId) =>
    T.gen(function* () {
      const invite = yield* found(
        world
          .records()
          .invites.find((each) => each.id === params.id && mayList(world.records(), viewerId, each)),
        'No such invite.',
      )
      world.update((records) => ({
        ...records,
        invites: records.invites.filter((each) => each.id !== invite.id),
      }))
      return {}
    }),
})

/** An administrator sees every invite still waiting; anyone else their own. */
const mayList = (records: Records, viewerId: MemberId, invite: Invite): boolean =>
  invite.createdBy === viewerId || memberById(records, viewerId)?.role === 'admin'

const INVITE_PREFIX = 'hbi_'
