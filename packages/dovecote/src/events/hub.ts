import { type PubSub, type Subscription, makePubSub } from '@homingbird/kernel'
import type { CredentialKind, MemberId, Presence, StreamEvent } from '@homingbird/protocol'

export interface Hub {
  readonly publish: (memberId: MemberId, event: StreamEvent) => void
  readonly subscribe: (
    memberId: MemberId,
    shownAs: CredentialKind | 'hidden',
    signal: AbortSignal,
  ) => Subscription<StreamEvent>
  readonly presenceOf: (memberId: MemberId) => Presence
  readonly flushPresence: () => void
}

export const PRESENCE_FLUSH_INTERVAL_MS = 1_000

export const makeHub = (now: () => number): Hub => {
  const channels = new Map<MemberId, Channel>()

  const presenceOf = (memberId: MemberId): Presence => {
    const connections = channels.get(memberId)?.connections
    return { humanOnline: (connections?.human ?? 0) > 0, agentOnline: (connections?.agent ?? 0) > 0 }
  }

  const changed = new Set<MemberId>()
  const announce = (memberId: MemberId): void => void changed.add(memberId)

  const flushPresence = (): void => {
    if (changed.size === 0) return
    const members = [...changed].map((memberId) => ({ memberId, ...presenceOf(memberId) }))
    changed.clear()
    const event: StreamEvent = { seq: 0, at: now(), body: { type: 'presence', members } }
    for (const channel of channels.values()) channel.pubsub.publish(event)
  }

  return {
    presenceOf,
    flushPresence,
    publish: (memberId, event) => channels.get(memberId)?.pubsub.publish(event),
    subscribe: (memberId, shownAs, signal) => {
      const channel = channels.get(memberId) ?? {
        pubsub: makePubSub<StreamEvent>(),
        connections: { human: 0, agent: 0, hidden: 0 },
      }
      channels.set(memberId, channel)
      if (channel.connections[shownAs]++ === 0 && shownAs !== 'hidden') announce(memberId)
      const subscription = channel.pubsub.subscribe({ signal, capacity: SUBSCRIBER_BUFFER })
      let closed = false
      const close = (): void => {
        if (closed) return
        closed = true
        subscription.close()
        const stillShown = --channel.connections[shownAs] > 0
        const { human, agent, hidden } = channel.connections
        if (human + agent + hidden === 0) channels.delete(memberId)
        if (!stillShown && shownAs !== 'hidden') announce(memberId)
      }
      signal.addEventListener('abort', close, { once: true })
      return {
        close,
        overflowed: subscription.overflowed,
        [Symbol.asyncIterator]: () => {
          const iterator = subscription[Symbol.asyncIterator]()
          return {
            next: async () => {
              const step = await iterator.next()
              if (step.done) close()
              return step
            },
            return: async () => {
              close()
              return { done: true, value: undefined }
            },
          }
        },
      }
    },
  }
}

interface Channel {
  readonly pubsub: PubSub<StreamEvent>
  readonly connections: Record<CredentialKind | 'hidden', number>
}

const SUBSCRIBER_BUFFER = 2048
