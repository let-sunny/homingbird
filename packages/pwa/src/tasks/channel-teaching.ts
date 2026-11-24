import { Task as T } from '@homingbird/kernel'
import type { AsRead, PrincipleKind, TaughtFrom } from '@homingbird/protocol'
import { track } from '../analytics.ts'
import { type Action, type App, withApp } from '../app.ts'
import { rereadChannelPage } from './channel-pages.ts'

/** What the channel's managers taught its agent, asked for again where its page is open. */
export const loadChannelTeaching = (slug: string): Action => rereadChannelPage('channelTeaching', slug)

export const saveChannelInstruction = (
  slug: string,
  instruction: string,
  sources: ReadonlyArray<string>,
): Action =>
  withApp(({ api, state }) =>
    T.map((teaching: AsRead.ChannelTeaching) => keep(state, slug, teaching))(
      api['channels.agent.teaching.set']({ params: { slug }, body: { instruction, sources } }),
    ),
  )

export const saveChannelPrinciple = (slug: string, input: ChannelPrincipleInput): Action =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    yield* api['channels.agent.principles.create']({ params: { slug }, body: input })
    yield* track('principle_saved', { kind: input.kind ?? 'rule' })
    yield* loadChannelTeaching(slug)
  })

export const changeChannelPrinciple = (slug: string, id: string, change: ChannelPrincipleChange): Action =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    yield* api['channels.agent.principles.update']({ params: { slug, id }, body: change })
    yield* loadChannelTeaching(slug)
  })

export const reorderChannelPrinciples = (slug: string, ids: ReadonlyArray<string>): Action =>
  withApp(({ api, state }) =>
    T.map((teaching: AsRead.ChannelTeaching) => keep(state, slug, teaching))(
      api['channels.agent.principles.reorder']({
        params: { slug },
        body: { ids: ids as ReadonlyArray<AsRead.Principle['id']> },
      }),
    ),
  )

export const deleteChannelPrinciple = (slug: string, id: string): Action =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    yield* api['channels.agent.principles.delete']({ params: { slug, id } })
    yield* loadChannelTeaching(slug)
  })

export interface ChannelPrincipleInput {
  readonly kind?: PrincipleKind
  readonly topic: string
  readonly rule: string
  readonly source: string | null
  readonly taughtFrom?: TaughtFrom
}

export interface ChannelPrincipleChange {
  readonly kind?: PrincipleKind
  readonly topic?: string
  readonly rule?: string
  readonly source?: string | null
  readonly enabled?: boolean
}

const keep = (state: App['state'], slug: string, teaching: AsRead.ChannelTeaching): void =>
  state.channelTeaching.find(slug)?.set(teaching)
