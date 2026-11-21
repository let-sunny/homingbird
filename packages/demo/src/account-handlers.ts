import { Task as T } from '@homingbird/kernel'
import {
  FEATURE_NAMES,
  type FeatureName,
  type Member,
  type MemberId,
  type NotificationLevel,
  PRINCIPLES_PER_PERSON,
  PROTOCOL_VERSION,
  type Principle,
  type PrincipleId,
} from '@homingbird/protocol'
import { type Handlers, found } from './handlers.ts'
import { agentReportOf } from './insights.ts'
import { directoryOf, memberById } from './reads.ts'
import { VISITOR_SESSION } from './team.ts'
import type { Records } from './world.ts'
import type { World } from './world.ts'

/** The features the demo offers; the others answer 404, as on a server that switched them off. */
export const DEMO_FEATURES: ReadonlyArray<FeatureName> = [
  'channels',
  'groups',
  'characters',
  'mute',
  'answeringFlow',
  'teaching',
  'agentFigures',
  'routeMap',
  'noteDetails',
  'channelAgents',
  'debateRooms',
  'insights',
  'invites',
  'joinCodes',
  'deskAvailability',
]

/** The server, the visitor's own account and agent, the directory, and what the visitor taught. */
export const accountHandlers = (world: World): Handlers => {
  let notifications: Exclude<NotificationLevel, 'unknown'> = 'all'
  return {
    'server.info': () =>
      T.succeed({
        name: 'dovecote',
        version: 'demo',
        contactMode: 'open',
        signInWith: 'demo',
        features: Object.fromEntries(FEATURE_NAMES.map((name) => [name, DEMO_FEATURES.includes(name)])),
        protocolVersion: PROTOCOL_VERSION,
      }),
    'me.get': (_, viewerId) =>
      T.map((member: Member) => ({
        member,
        credential: { id: VISITOR_SESSION, kind: 'human' as const, name: 'Chrome on macOS' },
        contactMode: 'open' as const,
        notifications,
        canInvite: true,
      }))(memberOf(world.records(), viewerId)),
    'me.update': ({ body }, viewerId) =>
      changeMember(world, viewerId, (member) => ({
        ...member,
        name: body.name ?? member.name,
        profile: body.profile ?? member.profile,
      })),
    'me.character.set': ({ body }, viewerId) =>
      changeMember(world, viewerId, (member) => ({ ...member, character: body })),
    'me.character.clear': (_, viewerId) =>
      changeMember(world, viewerId, (member) => ({ ...member, character: null })),
    'me.notifications.set': ({ body }) =>
      T.sync(() => {
        notifications = body.notifications
        return { notifications }
      }),
    'directory.list': ({ query }, viewerId) =>
      T.sync(() => ({
        entries: directoryOf(world.records(), viewerId, {
          q: query.q,
          ...(query.channel !== undefined && { channel: query.channel }),
          ...(query.group !== undefined && { group: query.group }),
        }),
      })),
    'contacts.list': () => T.succeed({ contacts: [], blocked: [] }),
    'device.get': ({ params }) =>
      T.sync(() => ({
        userCode: params.userCode,
        client: 'Homingbird CLI',
        expiresAt: world.clock.now() + TEN_MINUTES,
      })),
    'consent.get': ({ params }) =>
      T.sync(() => ({
        id: params.id,
        client: 'Example notes app',
        redirectHost: 'notes.example.com',
        expiresAt: world.clock.now() + TEN_MINUTES,
      })),
    'credentials.list': (_, viewerId) =>
      T.sync(() => ({
        credentials: world
          .records()
          .credentials.filter((each) => each.memberId === viewerId)
          .map((each) => ({ ...each.credential, current: each.credential.id === VISITOR_SESSION })),
      })),
    'presence.visibility': () => T.succeed({}),
    'presence.heartbeat': () => T.succeed({}),
    'events.poll': ({ query }, viewerId) =>
      T.sync(() => {
        const after = Number(query.after ?? 0)
        const events = world.eventsAfter(viewerId, after)
        return { events, cursor: events.at(-1)?.seq ?? after }
      }),
    'answeringFlow.get': () => T.succeed({ flow: null, updatedAt: null }),
    'insights.mine': (_, viewerId) =>
      T.sync(() => agentReportOf(world.records(), viewerId, world.startedAt, world.clock.now())),
    'principles.list': () => T.sync(() => taughtOf(world.records())),
    'principles.drafting': () =>
      T.sync(() => ({
        principles: world
          .records()
          .principles.filter((principle) => principle.enabled)
          .map(({ kind, topic, rule, source }) => ({ kind, topic, rule, source })),
        leftOut: 0,
        ignored: [],
        ignoredLeftOut: 0,
      })),
    'principles.create': ({ body }) =>
      T.sync(() => {
        const now = world.clock.now()
        const created: Principle = {
          id: world.nextId('prin') as PrincipleId,
          kind: body.kind === 'answer' ? 'answer' : 'rule',
          topic: body.topic,
          rule: body.rule,
          source: body.source ?? null,
          place: body.place,
          enabled: true,
          origin: 'manual',
          position: world.records().principles.length,
          createdAt: now,
          updatedAt: now,
          lastAppliedAt: null,
          publicText: body.publicText ?? null,
          counts: null,
        }
        world.update((records) => ({ ...records, principles: [...records.principles, created] }))
        return created
      }),
    'principles.update': ({ params, body }) =>
      changePrinciple(world, params.id, (principle) => ({
        ...principle,
        ...(body.kind !== undefined && { kind: body.kind }),
        ...(body.topic !== undefined && { topic: body.topic }),
        ...(body.rule !== undefined && { rule: body.rule }),
        ...(body.source !== undefined && { source: body.source }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.publicText !== undefined && { publicText: body.publicText }),
        updatedAt: world.clock.now(),
      })),
    'principles.delete': ({ params }) =>
      T.gen(function* () {
        const principle = yield* found(
          world.records().principles.find((each) => each.id === params.id),
          'No such principle.',
        )
        world.update((records) => ({
          ...records,
          principles: records.principles.filter((each) => each.id !== principle.id),
        }))
        return principle
      }),
    'principles.reorder': ({ body }) =>
      T.sync(() => {
        world.update((records) => ({
          ...records,
          principles: records.principles
            .map((principle) => {
              const position = body.ids.indexOf(principle.id)
              return position === -1 ? principle : { ...principle, position }
            })
            .sort((a, b) => a.position - b.position),
        }))
        return taughtOf(world.records())
      }),
    'principles.miss': ({ params }) =>
      changePrinciple(world, params.id, (principle) => ({
        ...principle,
        counts:
          principle.counts === null ? null : { ...principle.counts, missed: principle.counts.missed + 1 },
      })),
    'principles.offers.dismiss': () => T.succeed({}),
  }
}

const TEN_MINUTES = 10 * 60_000

const memberOf = (records: Records, id: MemberId) => found(memberById(records, id), 'No such member.')

const changeMember = (world: World, id: MemberId, change: (member: Member) => Member) =>
  T.map((member: Member) => {
    const changed = change(member)
    world.update((records) => ({
      ...records,
      members: records.members.map((each) => (each.member.id === id ? { ...each, member: changed } : each)),
    }))
    world.emit([id], { type: 'directory.changed', memberId: id })
    return changed
  })(memberOf(world.records(), id))

const changePrinciple = (world: World, id: string, change: (principle: Principle) => Principle) =>
  T.map((principle: Principle) => {
    const changed = change(principle)
    world.update((records) => ({
      ...records,
      principles: records.principles.map((each) => (each.id === principle.id ? changed : each)),
    }))
    return changed
  })(
    found(
      world.records().principles.find((each) => each.id === id),
      'No such principle.',
    ),
  )

const taughtOf = (records: Records) => ({
  principles: [...records.principles],
  offers: [],
  routes: [
    { place: 'billing', drafted: 31, principles: 1, heldUp: 4, chances: 2 },
    { place: null, drafted: 33, principles: 1, heldUp: 9, chances: 1 },
  ],
  achievements: ['first_principle' as const],
  limit: PRINCIPLES_PER_PERSON,
})
