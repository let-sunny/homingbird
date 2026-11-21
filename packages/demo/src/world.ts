import { type Clock, Task as T } from '@homingbird/kernel'
import type {
  ChannelVisibility,
  ConversationId,
  ConversationKind,
  Credential,
  Debate,
  EventBody,
  GroupId,
  GroupKind,
  Invite,
  Member,
  MemberId,
  Note,
  Notice,
  Presence,
  Principle,
  StreamEvent,
} from '@homingbird/protocol'
import { demoTeam } from './team.ts'

/** The demo's Dovecote state and live events, in memory only: a new world is a fresh demo. */
export const createWorld = (
  clock: Clock,
  seed: Records = demoTeam(clock.now()),
  publicUrl: string = DEMO_URL,
): World => {
  let records = seed
  let lastSeq = 0
  let lastId = 0
  const log: Array<StreamEvent & { readonly to: ReadonlyArray<MemberId> }> = []
  const listeners = new Map<MemberId, Set<(event: StreamEvent) => void>>()
  return {
    clock,
    startedAt: clock.now(),
    publicUrl,
    records: () => records,
    update: (change) => {
      records = change(records)
    },
    emit: (to, body) => {
      const event = { seq: ++lastSeq, at: clock.now(), body, to }
      log.push(event)
      for (const memberId of to)
        for (const listener of [...(listeners.get(memberId) ?? [])])
          listener({ seq: event.seq, at: event.at, body })
    },
    eventsAfter: (memberId, seq) =>
      log
        .filter((event) => event.seq > seq && event.to.includes(memberId))
        .map(({ seq, at, body }) => ({ seq, at, body })),
    listen: (memberId, listener) => {
      const set = listeners.get(memberId) ?? new Set()
      set.add(listener)
      listeners.set(memberId, set)
      return () => void set.delete(listener)
    },
    nextId: (prefix) => `${prefix}_demonew${String(++lastId).padStart(5, '0')}`,
    after: (ms, act) => void T.runFork(T.map(act)(T.sleep(ms)), { clock }),
  }
}

export interface World {
  readonly clock: Clock
  /** When this demo started; figures count the decisions made since on top of the seeded weeks. */
  readonly startedAt: number
  /** Where the demo page is, without a trailing slash: the server address its links and codes name. */
  readonly publicUrl: string
  readonly records: () => Records
  readonly update: (change: (records: Records) => Records) => void
  /** Delivers an event to these members' streams, and keeps it for a stream that reconnects. */
  readonly emit: (to: ReadonlyArray<MemberId>, body: EventBody) => void
  readonly eventsAfter: (memberId: MemberId, seq: number) => StreamEvent[]
  readonly listen: (memberId: MemberId, listener: (event: StreamEvent) => void) => () => void
  /** A new identifier with the prefix its schema asks for, unique in this world. */
  readonly nextId: (prefix: string) => string
  /** Does `act` once, `ms` from now on the world's clock: what the demo's colleagues do while the visitor waits. */
  readonly after: (ms: number, act: () => void) => void
}

/** Everything the demo's Dovecote keeps in memory; a reload of the page starts from the seed again. */
export interface Records {
  readonly members: ReadonlyArray<MemberRecord>
  readonly conversations: ReadonlyArray<ConversationRecord>
  readonly notes: ReadonlyArray<Note>
  readonly channels: ReadonlyArray<ChannelRecord>
  readonly groups: ReadonlyArray<GroupRecord>
  readonly credentials: ReadonlyArray<CredentialRecord>
  readonly principles: ReadonlyArray<Principle>
  readonly debates: ReadonlyArray<Debate>
  /** What happened to a person's notes that they alone see, as a server keeps it across reloads. */
  readonly notices: ReadonlyArray<NoticeRecord>
  /** Invite links still waiting; nobody can redeem one in a demo that lives in a single page. */
  readonly invites: ReadonlyArray<Invite>
}

export interface NoticeRecord {
  readonly notice: Notice
  readonly memberId: MemberId
}

export interface MemberRecord {
  readonly member: Member
  readonly presence: Presence
  readonly lastSeenAt: number | null
}

export interface ConversationRecord {
  readonly id: ConversationId
  readonly kind: Exclude<ConversationKind, 'unknown'>
  readonly title: string | null
  readonly participantIds: ReadonlyArray<MemberId>
  readonly createdAt: number
  readonly lastActivityAt: number
  readonly mutedBy: ReadonlyArray<MemberId>
  /** Who started a group message: it is listed for them before any note in it is sent, as on a server. */
  readonly startedBy?: MemberId
  /** A question asked privately of this channel's agent: its asker, the agent and the managers take part. */
  readonly privateQuestionOf?: { readonly slug: string; readonly askedBy: MemberId }
}

export interface ChannelRecord {
  readonly slug: string
  readonly description: string
  readonly conversationId: ConversationId
  readonly visibility: Exclude<ChannelVisibility, 'unknown'>
  /** The people whose agents answer questions asked in the room. */
  readonly answering: ReadonlyArray<MemberId>
  readonly managedBy: GroupId
  readonly agentId: MemberId | null
  readonly createdAt: number
  /** What the channel's managers taught its agent; none until they teach it. */
  readonly teaching?: ChannelTeachingRecord
}

export interface ChannelTeachingRecord {
  readonly instruction: string
  readonly sources: ReadonlyArray<string>
  readonly updatedAt: number | null
  readonly principles: ReadonlyArray<Principle>
}

export interface GroupRecord {
  readonly id: GroupId
  readonly kind: Exclude<GroupKind, 'unknown'>
  readonly name: string | null
  readonly memberIds: ReadonlyArray<MemberId>
  readonly createdAt: number
}

/** A credential and whose it is; a channel's agent's credential belongs to the agent. */
export interface CredentialRecord {
  readonly credential: Omit<Credential, 'current'>
  readonly memberId: MemberId
  readonly issuedBy: MemberId | null
}

/** The server address of a world made outside a page, as in tests. */
const DEMO_URL = 'https://demo.homingbird.invalid'
