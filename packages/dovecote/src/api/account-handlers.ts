import { Task as T } from '@homingbird/kernel'
import { type Contract, type Member, PROTOCOL_VERSION, type ResponseOf } from '@homingbird/protocol'
import { trackAnalytics } from '../domain/analytics.ts'
import { clearCharacter, saveCharacter } from '../domain/characters.ts'
import { chosenLocaleOf, directoryFor, updateOwnProfile } from '../domain/members.ts'
import { offeredFeatures, readSettings } from '../domain/settings.ts'
import { viewerOf } from '../environment.ts'
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
      return {
        member: caller.member,
        credential: caller.credential,
        contactMode: settings.contactMode,
        ...(locale !== null && { locale }),
      }
    }),
  'me.update': ({ body }, caller) =>
    T.tap((_: Member) => announceDirectoryChange(caller.member.id))(updateOwnProfile(caller.member.id, body)),
  'me.character.set': ({ body }, caller) =>
    T.tap((_: Member) => announceDirectoryChange(caller.member.id))(saveCharacter(caller.member.id, body)),
  'me.character.clear': (_, caller) =>
    T.tap((_: Member) => announceDirectoryChange(caller.member.id))(clearCharacter(caller.member.id)),
  'directory.list': ({ query }, caller) =>
    T.map((entries: Awaited<ResponseOf<Contract['directory.list']>>['entries']) => ({ entries }))(
      directoryFor(viewerOf(caller), query.q, query.channel),
    ),
  'analytics.track': ({ body }, caller) => T.as({})(trackAnalytics(caller, body.events)),
} satisfies Partial<Handlers>
