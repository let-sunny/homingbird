import { Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  type ChannelTeaching,
  type MemberId,
  PRINCIPLES_PER_PERSON,
  type Principle,
  type PrincipleId,
} from '@homingbird/protocol'
import { managedChannel } from './channel-handlers.ts'
import { type Handlers, found } from './handlers.ts'
import type { ChannelRecord, ChannelTeachingRecord, World } from './world.ts'

/** What a channel's managers teach its agent, kept on the channel; only its managers reach it. */
export const channelTeachingHandlers = (world: World): Handlers => ({
  'channels.agent.teaching.get': ({ params }, viewerId) =>
    T.map((channel: ChannelRecord) => teachingOf(channel))(taught(world, viewerId, params.slug)),
  'channels.agent.teaching.set': ({ params, body }, viewerId) =>
    teach(world, viewerId, params.slug, (teaching) => ({
      ...teaching,
      instruction: body.instruction.trim(),
      sources: body.sources,
      updatedAt: world.clock.now(),
    })),
  'channels.agent.principles.create': ({ params, body }, viewerId) =>
    T.gen(function* () {
      const channel = yield* taught(world, viewerId, params.slug)
      const now = world.clock.now()
      const created: Principle = {
        id: world.nextId('prin') as PrincipleId,
        kind: body.kind === 'answer' ? 'answer' : 'rule',
        topic: body.topic.trim(),
        rule: body.rule.trim(),
        source: body.source ?? null,
        place: null,
        enabled: true,
        origin: body.taughtFrom ?? 'manual',
        position: (channel.teaching ?? NOTHING_TAUGHT).principles.length,
        createdAt: now,
        updatedAt: now,
        lastAppliedAt: null,
        publicText: null,
        counts: { applied: 0, sentAsWritten: 0, edited: 0, discarded: 0, missed: 0 },
      }
      yield* teach(world, viewerId, params.slug, (teaching) => ({
        ...teaching,
        principles: [...teaching.principles, created],
      }))
      return created
    }),
  'channels.agent.principles.update': ({ params, body }, viewerId) =>
    T.gen(function* () {
      yield* principleOf(world, viewerId, params.slug, params.id)
      yield* teach(world, viewerId, params.slug, (teaching) => ({
        ...teaching,
        principles: teaching.principles.map((principle) =>
          principle.id !== params.id
            ? principle
            : {
                ...principle,
                ...(body.kind !== undefined && { kind: body.kind }),
                ...(body.topic !== undefined && { topic: body.topic }),
                ...(body.rule !== undefined && { rule: body.rule }),
                ...(body.source !== undefined && { source: body.source }),
                ...(body.enabled !== undefined && { enabled: body.enabled }),
                updatedAt: world.clock.now(),
              },
        ),
      }))
      return yield* principleOf(world, viewerId, params.slug, params.id)
    }),
  'channels.agent.principles.reorder': ({ params, body }, viewerId) =>
    teach(world, viewerId, params.slug, (teaching) => ({
      ...teaching,
      principles: teaching.principles
        .map((principle) => {
          const position = body.ids.indexOf(principle.id)
          return position === -1 ? principle : { ...principle, position }
        })
        .sort((a, b) => a.position - b.position),
    })),
  'channels.agent.principles.delete': ({ params }, viewerId) =>
    T.gen(function* () {
      const principle = yield* principleOf(world, viewerId, params.slug, params.id)
      yield* teach(world, viewerId, params.slug, (teaching) => ({
        ...teaching,
        principles: teaching.principles.filter((each) => each.id !== params.id),
      }))
      return principle
    }),
})

const NOTHING_TAUGHT: ChannelTeachingRecord = {
  instruction: '',
  sources: [],
  updatedAt: null,
  principles: [],
}

/** The channel, for one of its managers, once it has an agent to teach. */
const taught = (world: World, viewerId: MemberId, slug: string): T.Task<ChannelRecord, ApiError> =>
  T.flatMap((channel: ChannelRecord) => T.as(channel)(found(channel.agentId, 'This channel has no agent.')))(
    managedChannel(world.records(), viewerId, slug),
  )

const teach = (
  world: World,
  viewerId: MemberId,
  slug: string,
  change: (teaching: ChannelTeachingRecord) => ChannelTeachingRecord,
): T.Task<ChannelTeaching, ApiError> =>
  T.map((channel: ChannelRecord) => {
    const changed = { ...channel, teaching: change(channel.teaching ?? NOTHING_TAUGHT) }
    world.update((records) => ({
      ...records,
      channels: records.channels.map((each) => (each.slug === channel.slug ? changed : each)),
    }))
    return teachingOf(changed)
  })(taught(world, viewerId, slug))

const principleOf = (
  world: World,
  viewerId: MemberId,
  slug: string,
  id: string,
): T.Task<Principle, ApiError> =>
  T.flatMap((channel: ChannelRecord) =>
    found(
      (channel.teaching ?? NOTHING_TAUGHT).principles.find((principle) => principle.id === id),
      'No such principle.',
    ),
  )(taught(world, viewerId, slug))

const teachingOf = (channel: ChannelRecord): ChannelTeaching => {
  const teaching = channel.teaching ?? NOTHING_TAUGHT
  return {
    channel: channel.slug,
    instruction: teaching.instruction,
    sources: teaching.sources,
    updatedAt: teaching.updatedAt,
    principles: teaching.principles,
    limit: PRINCIPLES_PER_PERSON,
  }
}
