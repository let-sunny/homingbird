import { Task as T } from '@homingbird/kernel'
import { type Channel, type Contract, type Member, MemberId, type ResponseOf } from '@homingbird/protocol'
import { archiveChannel, reviseChannel } from '../domain/channel-administration.ts'
import { clearCharacter } from '../domain/characters.ts'
import { organizationInsights } from '../domain/insights.ts'
import { administerMember, allMembers } from '../domain/members.ts'
import { readAnsweringFlow, readSettings, writeSettings } from '../domain/settings.ts'
import { viewerOf } from '../environment.ts'
import { announceDirectoryChange } from '../events/events.ts'
import type { Handlers } from './handlers.ts'
import { identifier } from './route-parameters.ts'

/** Organization settings, members, channels and figures, for an administrator. */
export const adminHandlers = {
  'answeringFlow.get': () => readAnsweringFlow,
  'admin.settings.get': () => readSettings,
  'admin.settings.put': ({ body }) => writeSettings(body),
  'admin.members.list': () =>
    T.map((members: Awaited<ResponseOf<Contract['admin.members.list']>>['members']) => ({ members }))(
      allMembers,
    ),
  'admin.members.update': ({ params, body }, caller) =>
    T.flatMap((id: MemberId) =>
      T.tap((_: Member) => announceDirectoryChange(id))(administerMember(caller, id, body)),
    )(identifier(MemberId, params.id)),
  'admin.members.resetCharacter': ({ params }) =>
    T.flatMap((id: MemberId) => T.tap((_: Member) => announceDirectoryChange(id))(clearCharacter(id)))(
      identifier(MemberId, params.id),
    ),
  'admin.channels.update': ({ params, body }, caller) =>
    T.tap((_: Channel) => announceDirectoryChange(caller.member.id))(
      reviseChannel(viewerOf(caller), params.slug, body),
    ),
  'admin.channels.archive': ({ params, body }, caller) =>
    T.as({})(
      T.tap(() => announceDirectoryChange(caller.member.id))(
        archiveChannel(params.slug, body.moveMembersTo ?? null),
      ),
    ),
  'admin.insights': () => organizationInsights,
} satisfies Partial<Handlers>
