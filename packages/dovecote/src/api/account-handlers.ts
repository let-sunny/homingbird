import { Task as T } from '@homingbird/kernel'
import { type Contract, type Member, PROTOCOL_VERSION, type ResponseOf } from '@homingbird/protocol'
import { trackAnalytics } from '../domain/analytics.ts'
import { clearCharacter, saveCharacter } from '../domain/characters.ts'
import { chosenLocaleOf, directoryFor, updateOwnProfile } from '../domain/members.ts'
import { notificationLevelOf, setNotificationLevel } from '../domain/notification-level.ts'
import { featureIsOn, offeredFeatures, readSettings } from '../domain/settings.ts'
import { isHuman, viewerOf } from '../environment.ts'
import { type RequestEnv, announceDirectoryChange } from '../events/events.ts'
import { SERVER_VERSION } from '../version.ts'
import type { Handlers } from './handlers.ts'

/** The server, the signed-in person, their profile and the directory they see. */
export const accountHandlers = {
  'server.info': () =>
    T.gen(function* () {
      const env = yield* T.ask<RequestEnv>()
      const settings = yield* readSettings
      return {
        name: 'dovecote',
        version: SERVER_VERSION,
        contactMode: settings.contactMode,
        signInWith: env.config.identity.label,
        features: offeredFeatures(settings, env.config),
        protocolVersion: PROTOCOL_VERSION,
      }
    }),
  'me.get': (_, caller) =>
    T.gen(function* () {
      const settings = yield* readSettings
      const locale = yield* chosenLocaleOf(caller.member.id)
      const notifications =
        isHuman(caller) && (yield* featureIsOn('mute')) ? yield* notificationLevelOf(caller.member.id) : null
      return {
        member: caller.member,
        credential: caller.credential,
        contactMode: settings.contactMode,
        ...(locale !== null && { locale }),
        ...(notifications !== null && { notifications }),
      }
    }),
  'me.update': ({ body }, caller) =>
    T.tap((_: Member) => announceDirectoryChange(caller.member.id))(updateOwnProfile(caller.member.id, body)),
  'me.character.set': ({ body }, caller) =>
    T.tap((_: Member) => announceDirectoryChange(caller.member.id))(saveCharacter(caller.member.id, body)),
  'me.notifications.set': ({ body }, caller) => setNotificationLevel(caller.member.id, body.notifications),
  'me.character.clear': (_, caller) =>
    T.tap((_: Member) => announceDirectoryChange(caller.member.id))(clearCharacter(caller.member.id)),
  'directory.list': ({ query }, caller) =>
    T.map((entries: Awaited<ResponseOf<Contract['directory.list']>>['entries']) => ({ entries }))(
      directoryFor(viewerOf(caller), query.q, { channel: query.channel, group: query.group }),
    ),
  'analytics.track': ({ body }, caller) => T.as({})(trackAnalytics(caller, body.events)),
} satisfies Partial<Handlers>
