import { type PubSub, type Subscription, makePubSub } from '@homingbird/kernel'
import type {
  CredentialKind,
  DeskUnavailableKind,
  MemberId,
  Presence,
  StreamEvent,
} from '@homingbird/protocol'

export interface Hub {
  readonly publish: (memberId: MemberId, event: StreamEvent) => void
  readonly subscribe: (
    memberId: MemberId,
    shownAs: CredentialKind | 'hidden',
    signal: AbortSignal,
  ) => Subscription<StreamEvent>
  /** A member's presence; only the member themself, as `viewerId`, is told why their agent cannot answer. */
  readonly presenceOf: (memberId: MemberId, viewerId?: MemberId) => Presence
  /**
   * A running desk says its agent cannot answer; true when that starts an episode, which is told to the
   * person once. Kept only while one of the member's agents holds a stream.
   */
  readonly markUnavailable: (memberId: MemberId, unavailable: DeskUnavailable) => boolean
  readonly markAvailable: (memberId: MemberId) => void
  /** When this server started: what happened before it, such as requests made, is not counted yet. */
  readonly startedAt: number
  readonly flushPresence: () => void
  readonly broadcast: (event: StreamEvent) => void
  /** A web page says whether a person can see it now; a report lasts VISIBLE_REPORT_MS unless renewed. */
  readonly reportVisibility: (memberId: MemberId, page: string, visible: boolean) => void
  /** Whether a page of this person's is visible now: only then is a push notification not needed. */
  readonly isLooking: (memberId: MemberId) => boolean
}

export interface DeskUnavailable {
  readonly kind: DeskUnavailableKind
  readonly until: number | null
}

export const PRESENCE_FLUSH_INTERVAL_MS = 1_000
export const makeHub = (now: () => number): Hub => {
  const channels = new Map<MemberId, Channel>()
  const startedAt = now()

  const unavailable = new Map<MemberId, DeskUnavailable>()

  const presenceOf = (memberId: MemberId, viewerId?: MemberId): Presence => {
    const connections = channels.get(memberId)?.connections
    const agentOnline = (connections?.agent ?? 0) > 0
    const cannot = agentOnline ? unavailable.get(memberId) : undefined
    return {
      humanOnline: (connections?.human ?? 0) > 0,
      agentOnline,
      ...(cannot !== undefined && {
        agentUnavailable: { until: cannot.until, ...(viewerId === memberId && { kind: cannot.kind }) },
      }),
    }
  }

  const visiblePages = new Map<MemberId, Map<string, number>>()

  const isLooking = (memberId: MemberId): boolean => {
    const pages = visiblePages.get(memberId)
    if (pages === undefined) return false
    for (const [page, until] of pages) if (until <= now()) pages.delete(page)
    if (pages.size === 0) visiblePages.delete(memberId)
    return pages.size > 0
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
    markUnavailable: (memberId, state) => {
      if ((channels.get(memberId)?.connections.agent ?? 0) === 0) return false
      const before = unavailable.get(memberId)
      unavailable.set(memberId, state)
      if (before?.kind !== state.kind || before.until !== state.until) announce(memberId)
      return before === undefined
    },
    markAvailable: (memberId) => {
      if (unavailable.delete(memberId)) announce(memberId)
    },
    startedAt,
    flushPresence,
    isLooking,
    reportVisibility: (memberId, page, visible) => {
      const pages = visiblePages.get(memberId) ?? new Map<string, number>()
      if (visible) pages.set(page, now() + VISIBLE_REPORT_MS)
      else pages.delete(page)
      if (pages.size === 0) visiblePages.delete(memberId)
      else visiblePages.set(memberId, pages)
    },
    broadcast: (event) => {
      for (const channel of channels.values()) channel.pubsub.publish(event)
    },
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
        if (agent === 0) unavailable.delete(memberId)
        if (!stillShown && shownAs !== 'hidden') announce(memberId)
      }
      signal.addEventListener('abort', close, { once: true })
      return {
        close,
        overflowed: subscription.overflowed,
        [Symbol.asyncIterator]: () => {
          const iterator = subscription[Symbol.asyncIterator]()
          return {
            next: () =>
              iterator.next().then((step) => {
                if (step.done) close()
                return step
              }),
            return: () => {
              close()
              return Promise.resolve({ done: true, value: undefined })
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

const VISIBLE_REPORT_MS = 90_000
