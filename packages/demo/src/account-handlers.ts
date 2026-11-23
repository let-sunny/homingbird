import { Task as T } from '@homingbird/kernel'
import {
  FEATURE_NAMES,
  type FeatureName,
  type Member,
  type MemberId,
  type NotificationLevel,
  PRINCIPLES_PER_PERSON,
  PROPOSALS_PER_PERSON,
  PROTOCOL_VERSION,
  type PlaceName,
  type Principle,
  type PrincipleId,
  type PrincipleKind,
  type PrincipleProposal,
  type RoutePoint,
} from '@homingbird/protocol'
import { type Handlers, found } from './handlers.ts'
import { agentReportOf, seededMonthPlaces } from './insights.ts'
import { closeOffer } from './offers.ts'
import { directoryOf, memberById } from './reads.ts'
import { VISITOR_SESSION } from './team.ts'
import type { Records } from './world.ts'
import type { World } from './world.ts'

/** The features the demo offers; the others answer 404, as on a server that switched them off. */
export const DEMO_FEATURES: ReadonlyArray<FeatureName> = [
  'channels',
  'groups',
  'draftRequests',
  'characters',
  'mute',
  'answeringFlow',
  'earlierAnswers',
  'teaching',
  'agentFigures',
  'noteDetails',
  'channelAgents',
  'debateRooms',
  'schedulingRooms',
  'debateSuggestions',
  'insights',
  'invites',
  'joinCodes',
  'deskAvailability',
  'autoSend',
  'draftPreviews',
  'hideConversations',
  'leaveGroups',
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
        const created = addPrinciple(world, {
          ...body,
          origin: 'manual',
          publicText: body.publicText ?? null,
        })
        if (body.offerId !== undefined) closeOffer(world, body.offerId)
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
    'principleProposals.list': () =>
      T.sync(() => ({
        document: world.records().teachingDocument,
        proposals: [...world.records().proposals],
        limit: PROPOSALS_PER_PERSON,
      })),
    'teaching.document.set': ({ body }) =>
      T.sync(() => {
        world.update((records) => ({ ...records, teachingDocument: body.document }))
        return {}
      }),
    'principleProposals.accept': ({ params, body }, viewerId) =>
      T.map((proposal: PrincipleProposal) => {
        const saved = addPrinciple(world, { ...proposal, ...body, origin: 'chat', publicText: null })
        forgetProposals(world, viewerId, [proposal.id])
        return saved
      })(proposalOf(world, params.id)),
    'principleProposals.acceptAll': ({ body }, viewerId) =>
      T.sync(() => {
        const chosen = world.records().proposals.filter((proposal) => body.ids.includes(proposal.id))
        for (const proposal of chosen) addPrinciple(world, { ...proposal, origin: 'chat', publicText: null })
        forgetProposals(
          world,
          viewerId,
          chosen.map((proposal) => proposal.id),
        )
        return taughtOf(world.records())
      }),
    'principleProposals.discard': ({ params }, viewerId) =>
      T.map((proposal: PrincipleProposal) => {
        forgetProposals(world, viewerId, [proposal.id])
        return {}
      })(proposalOf(world, params.id)),
    'principles.offers.dismiss': ({ params }) =>
      T.sync(() => {
        closeOffer(world, params.id)
        return {}
      }),
    'principles.autoSend.set': ({ params, body }) =>
      changePrinciple(world, params.id, (principle) => ({
        ...principle,
        autoSend: { enabled: body.enabled, places: [...new Set(body.places)] },
      })),
  }
}

const TEN_MINUTES = 10 * 60_000

/** Saves a principle as Dovecote does: enabled, last in the list, not yet applied. */
const addPrinciple = (world: World, fields: NewPrinciple): Principle => {
  const now = world.clock.now()
  const created: Principle = {
    id: world.nextId('prin') as PrincipleId,
    kind: fields.kind === 'answer' ? 'answer' : 'rule',
    topic: fields.topic,
    rule: fields.rule,
    source: fields.source ?? null,
    place: fields.place ?? null,
    enabled: true,
    origin: fields.origin,
    position: world.records().principles.length,
    createdAt: now,
    updatedAt: now,
    lastAppliedAt: null,
    publicText: fields.publicText,
    counts: null,
    autoSend: { enabled: false, places: [] },
  }
  world.update((records) => ({ ...records, principles: [...records.principles, created] }))
  return created
}

interface NewPrinciple {
  readonly kind?: PrincipleKind | undefined
  readonly topic: string
  readonly rule: string
  readonly source?: string | null | undefined
  readonly place?: PlaceName | undefined
  readonly origin: Principle['origin']
  readonly publicText: string | null
}

const proposalOf = (world: World, id: string) =>
  found(
    world.records().proposals.find((proposal) => proposal.id === id),
    'No such proposal.',
  )

const forgetProposals = (world: World, viewerId: MemberId, ids: ReadonlyArray<string>): void => {
  world.update((records) => ({
    ...records,
    proposals: records.proposals.filter((proposal) => !ids.includes(proposal.id)),
  }))
  world.emit([viewerId], { type: 'proposals.changed' })
}

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
  offers: [...records.offers],
  routes: placesTaught(records),
  achievements: ['first_principle' as const],
  limit: PRINCIPLES_PER_PERSON,
})

/**
 * Each place as Dovecote counts it: the seeded month's drafts, the principles that apply there (one for
 * any channel applies everywhere), the seeded drafts that applied one and went out as written, and the
 * open chances to teach from there.
 */
const placesTaught = (records: Records): RoutePoint[] => {
  const month = seededMonthPlaces()
  const places = new Set<PlaceName>([
    ...month.map((each) => each.place),
    ...records.principles.flatMap((principle) => (principle.place === null ? [] : [principle.place])),
    ...records.offers.map((offer) => offer.place),
  ])
  return [...places].map((place) => {
    const here = records.principles.filter(
      (principle) => principle.place === null || principle.place === place,
    )
    return {
      place,
      drafted: month.find((each) => each.place === place)?.written ?? 0,
      principles: here.length,
      heldUp: here.reduce(
        (sum, principle) => sum + (HELD_UP_SEEDED[principle.id]?.[place ?? DIRECT] ?? 0),
        0,
      ),
      chances: records.offers.filter((offer) => offer.place === place).length,
    }
  })
}

const DIRECT = 'direct'

/** Where the seeded principles' drafts went out as written: 8 for Migrations and 3 for Annual refunds. */
const HELD_UP_SEEDED: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  prin_demoprin0001: { deploys: 4, billing: 1, [DIRECT]: 3 },
  prin_demoprin0002: { billing: 3 },
}
