import { type HasClock, Task as T } from '@homingbird/kernel'
import type { AsRead } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import type { Family } from '../family.ts'
import type { Resource, Source } from '../resource.ts'
import { sourceFor } from './resources.ts'

/**
 * What a channel agent's page asks for, one entry of each by the channel's slug while a page holds it. A
 * task never makes an entry: nothing is asked for what no page shows.
 */
export const openChannelPage = (key: ChannelPageKey, slug: string): Action =>
  ofHeld(key, slug, (held, source) => held.open(source))

/** It changed: asked once more, after the running request when there is one. */
export const invalidateChannelPage = (key: ChannelPageKey, slug: string): Action =>
  ofHeld(key, slug, (held, source) => held.invalidate(source))

/** Try again: ends the running request and asks afresh. */
export const againChannelPage = (key: ChannelPageKey, slug: string): Action =>
  ofHeld(key, slug, (held, source) => held.again(source))

/**
 * Waits for an answer asked for after this call, as an action does before it shows what it changed. The
 * change worked, so a failure here is not its failure and nobody is told; nor does a slow answer hold it up.
 */
export const rereadChannelPage = (key: ChannelPageKey, slug: string): Action =>
  ofHeld(key, slug, (held, source) =>
    T.asUnit(T.result(T.timeout(REREAD_LIMIT_SECONDS * 1000)(held.refresh(source)))),
  )

export interface ChannelPages {
  readonly channelAgents: AsRead.ChannelAgent | null
  readonly channelTeaching: AsRead.ChannelTeaching | null
  readonly channelAgentFigures: AsRead.ChannelAgentReport | null
  readonly channelDecisions: AsRead.ChannelDecisions | null
}

export type ChannelPageKey = keyof ChannelPages

/** How each is asked for. Where the server finds the person no manager of the channel, the answer is null. */
const ASKS: { readonly [Key in ChannelPageKey]: (slug: string) => Action<ChannelPages[Key]> } = {
  channelAgents: (slug) =>
    withApp(({ api }) =>
      T.catchTag('NotFound', () => T.succeed(null))(api['channels.agent.get']({ params: { slug } })),
    ),
  channelTeaching: (slug) => withApp(({ api }) => api['channels.agent.teaching.get']({ params: { slug } })),
  channelAgentFigures: (slug) =>
    withApp(({ api }) =>
      T.catchTag('NotFound', () => T.succeed(null))(api['channels.agent.figures']({ params: { slug } })),
    ),
  channelDecisions: (slug) =>
    withApp(({ api }) =>
      T.catchTag('NotFound', () => T.succeed(null))(api['channels.agent.decisions']({ params: { slug } })),
    ),
}

export const CHANNEL_PAGE_KEYS = Object.keys(ASKS) as ReadonlyArray<ChannelPageKey>

const ofHeld = <Key extends ChannelPageKey>(
  key: Key,
  slug: string,
  step: (
    held: Resource<ChannelPages[Key]>,
    source: Source<ChannelPages[Key]>,
  ) => T.Task<unknown, never, HasClock>,
): Action =>
  withApp((app) => {
    const held = heldIn(app, key).find(slug)
    return held === null ? T.unit : T.asUnit(step(held, sourceFor(app, ASKS[key](slug), null)))
  })

const heldIn = <Key extends ChannelPageKey>({ state }: App, key: Key): Family<ChannelPages[Key]> => {
  const all: { readonly [One in ChannelPageKey]: Family<ChannelPages[One]> } = state
  return all[key]
}

const REREAD_LIMIT_SECONDS = 5
