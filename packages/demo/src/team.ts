import {
  BUILT_IN_CHARACTERS,
  type CharacterSpec,
  ConversationId,
  CredentialId,
  GroupId,
  type Member,
  MemberId,
  type Note,
  NoteId,
  type Principle,
  type PrincipleId,
  type Receipt,
} from '@homingbird/protocol'
import type { ConversationRecord, MemberRecord, Records } from './world.ts'

/** The person a visitor is signed in as. */
export const VISITOR_ID = MemberId.of('demojune0000')

/**
 * A small team as it stands `now`: June (the visitor), Ana, Ben and Kai, the #billing channel with its
 * agent, and two drafts waiting for June: her own agent's reply to Ana, and #billing's agent's answer
 * to Ben, which June reviews as one of the channel's managers.
 */
export const demoTeam = (now: number): Records => {
  const ago = (minutes: number): number => now - minutes * MINUTE
  const note = (fields: NoteFields): Note => noteOf(fields, ago, DIRECT_PARTNERS.get(fields.in))
  return {
    members: [
      person(VISITOR_ID, 'June Park', 'Platform team: billing migrations and the payments database.', 0, ago),
      person(ANA, 'Ana Silva', 'Billing lead. Invoices, refunds and the ledger.', 1, ago),
      person(BEN, 'Ben Okafor', 'Customer support, mostly refunds and plan changes.', 2, ago),
      person(KAI, 'Kai Lin', 'Infrastructure: deploys, the release train and on-call.', 3, ago),
      {
        member: {
          ...memberOf(BILLING_AGENT, 'Billing helper', '', null, ago(60 * 24 * 40)),
          email: '',
          kind: 'channel_agent',
          profile: 'Answers questions in #billing from the refund policy and past answers.',
        },
        presence: { humanOnline: false, agentOnline: true },
        lastSeenAt: ago(3),
      },
    ],
    conversations: [
      room(WITH_ANA, null, [VISITOR_ID, ANA], ago(60 * 24 * 20), ago(25)),
      room(WITH_BEN, null, [VISITOR_ID, BEN], ago(60 * 24 * 12), ago(60 * 20)),
      room(WITH_KAI, null, [VISITOR_ID, KAI], ago(60 * 24 * 30), ago(60 * 3)),
      room(BILLING_ROOM, 'billing', [VISITOR_ID, ANA, BEN, KAI, BILLING_AGENT], ago(60 * 24 * 40), ago(40)),
      room(DEPLOYS_ROOM, 'deploys', [VISITOR_ID, KAI, ANA], ago(60 * 24 * 35), ago(60 * 5)),
      room(ONBOARDING_ROOM, 'onboarding', [BEN, ANA], ago(60 * 24 * 10), ago(60 * 26)),
    ],
    notes: [
      note({
        id: 'demoana00001',
        in: WITH_ANA,
        by: ANA,
        at: 60 * 26,
        body: 'Morning! Did the invoice export finish last night?',
        readBy: [VISITOR_ID],
        repliedBy: [VISITOR_ID],
      }),
      note({
        id: 'demoana00002',
        in: WITH_ANA,
        by: VISITOR_ID,
        at: 60 * 25,
        body: 'Yes, all 1,284 invoices went out by 02:10.',
        origin: 'human',
        inReplyTo: 'demoana00001',
        readBy: [ANA],
      }),
      note({
        id: 'demoana00003',
        in: WITH_ANA,
        by: ANA,
        at: 25,
        body: 'Is the billing migration safe to run today? The plan is in the doc from Tuesday: https://example.com/plans/billing-migration',
        readBy: [VISITOR_ID],
      }),
      note({
        id: 'demoana00004',
        in: WITH_ANA,
        by: VISITOR_ID,
        at: 20,
        status: 'draft',
        inReplyTo: 'demoana00003',
        body: "Yes. I checked the lock ordering and the batch size against Tuesday's plan. Run it after the nightly export finishes, around 02:30, so the two don't compete for the ledger tables.",
        agentName: "June's desk",
        basis: "Tuesday's migration plan and last night's export log.",
      }),
      note({
        id: 'demoben00001',
        in: WITH_BEN,
        by: BEN,
        at: 60 * 21,
        body: 'Thanks for the refund script, it saved me an hour this morning.',
        readBy: [VISITOR_ID],
        repliedBy: [VISITOR_ID],
      }),
      note({
        id: 'demoben00002',
        in: WITH_BEN,
        by: VISITOR_ID,
        at: 60 * 20,
        body: 'Glad it helped! It skips plans changed this month, so check those by hand.',
        inReplyTo: 'demoben00001',
        agentName: "June's desk",
        readBy: [BEN],
      }),
      note({
        id: 'demokai00001',
        in: WITH_KAI,
        by: KAI,
        at: 60 * 3,
        body: 'Heads up: the deploy window moves to 16:00 tomorrow. Does that clash with the migration?',
      }),
      note({
        id: 'demobil00001',
        in: BILLING_ROOM,
        by: KAI,
        at: 60 * 28,
        body: 'Which invoices does the nightly export skip?',
        readBy: [VISITOR_ID],
      }),
      note({
        id: 'demobil00002',
        in: BILLING_ROOM,
        by: BILLING_AGENT,
        at: 60 * 27,
        body: 'Drafts and invoices still under review. Everything finalized before midnight UTC goes out that night.',
        inReplyTo: 'demobil00001',
        agentName: 'Billing helper',
        approvedBy: ANA,
        readBy: [KAI],
      }),
      note({
        id: 'demobil00003',
        in: BILLING_ROOM,
        by: BEN,
        at: 40,
        body: 'Who can explain the refund rule for annual plans? A customer wants half of their year back.',
        readBy: [VISITOR_ID],
      }),
      note({
        id: 'demobil00004',
        in: BILLING_ROOM,
        by: BILLING_AGENT,
        at: 38,
        status: 'draft',
        inReplyTo: 'demobil00003',
        body: 'Annual plans are refunded pro rata for the unused full months, minus the discount that came with paying yearly. Halfway through the year that is about five months back; the calculator is on the billing page under Refunds.',
        agentName: 'Billing helper',
        basis: 'The refund policy page and two answers Ana approved last month.',
      }),
      note({
        id: 'demodep00001',
        in: DEPLOYS_ROOM,
        by: KAI,
        at: 60 * 5,
        body: 'Freeze starts Thursday at 18:00. Anything for the release train goes in before then.',
        readBy: [VISITOR_ID],
      }),
      note({
        id: 'demoonb00001',
        in: ONBOARDING_ROOM,
        by: BEN,
        at: 60 * 26,
        body: 'Where do new support people find the refund playbook?',
      }),
    ],
    channels: [
      {
        slug: 'billing',
        description: 'Invoices, refunds and the payments database.',
        conversationId: BILLING_ROOM,
        visibility: 'open',
        answering: [VISITOR_ID, ANA],
        managedBy: BILLING_MANAGERS,
        agentId: BILLING_AGENT,
        createdAt: ago(60 * 24 * 40),
      },
      {
        slug: 'deploys',
        description: 'Release trains, rollbacks and the deploy queue.',
        conversationId: DEPLOYS_ROOM,
        visibility: 'open',
        answering: [KAI],
        managedBy: DEPLOYS_MANAGERS,
        agentId: null,
        createdAt: ago(60 * 24 * 35),
      },
      {
        slug: 'onboarding',
        description: 'Questions from people in their first weeks.',
        conversationId: ONBOARDING_ROOM,
        visibility: 'open',
        answering: [ANA],
        managedBy: ONBOARDING_MANAGERS,
        agentId: null,
        createdAt: ago(60 * 24 * 10),
      },
    ],
    groups: [
      {
        id: BILLING_MANAGERS,
        kind: 'channel',
        name: null,
        memberIds: [VISITOR_ID, ANA],
        createdAt: ago(60 * 24 * 40),
      },
      { id: DEPLOYS_MANAGERS, kind: 'channel', name: null, memberIds: [KAI], createdAt: ago(60 * 24 * 35) },
      {
        id: ONBOARDING_MANAGERS,
        kind: 'channel',
        name: null,
        memberIds: [BEN],
        createdAt: ago(60 * 24 * 10),
      },
      {
        id: PLATFORM_TEAM,
        kind: 'team',
        name: 'Platform',
        memberIds: [VISITOR_ID, KAI],
        createdAt: ago(60 * 24 * 60),
      },
      {
        id: CUSTOMER_TEAM,
        kind: 'team',
        name: 'Customer',
        memberIds: [ANA, BEN],
        createdAt: ago(60 * 24 * 60),
      },
    ],
    credentials: [
      {
        credential: {
          id: VISITOR_SESSION,
          kind: 'human',
          name: 'This browser',
          client: 'Web client',
          createdAt: ago(5),
          expiresAt: ago(-60 * 24 * 30),
          lastUsedAt: now,
          revokedAt: null,
        },
        memberId: VISITOR_ID,
        issuedBy: VISITOR_ID,
      },
      {
        credential: {
          id: CredentialId.of('demojunedesk'),
          kind: 'agent',
          name: "June's desk",
          client: 'Homingbird CLI',
          createdAt: ago(60 * 24 * 21),
          expiresAt: ago(-60 * 24 * 69),
          lastUsedAt: ago(4),
          revokedAt: null,
        },
        memberId: VISITOR_ID,
        issuedBy: VISITOR_ID,
      },
      {
        credential: {
          id: CredentialId.of('demobillhelp'),
          kind: 'agent',
          name: 'Billing helper runner',
          client: 'Homingbird runner',
          createdAt: ago(60 * 24 * 40),
          expiresAt: ago(-60 * 24 * 50),
          lastUsedAt: ago(3),
          revokedAt: null,
        },
        memberId: BILLING_AGENT,
        issuedBy: ANA,
      },
    ],
    principles: [
      principle(0, {
        id: 'demoprin0001',
        kind: 'rule',
        topic: 'Migrations',
        rule: 'Never call a migration safe without saying what was checked.',
        place: null,
        publicText: 'Says what it checked before calling a change safe.',
        applied: 9,
        at: ago(60 * 24 * 18),
      }),
      principle(1, {
        id: 'demoprin0002',
        kind: 'answer',
        topic: 'Annual refunds',
        rule: 'Annual plans are refunded pro rata for the unused full months.',
        place: 'billing',
        publicText: null,
        applied: 4,
        at: ago(60 * 24 * 9),
      }),
    ],
  }
}

/** The visitor's own web session, which the credentials page marks as current. */
export const VISITOR_SESSION = CredentialId.of('demojuneweb0')

const MINUTE = 60_000

const ANA = MemberId.of('demoana00000')
const BEN = MemberId.of('demoben00000')
const KAI = MemberId.of('demokai00000')
const BILLING_AGENT = MemberId.of('demobillagnt')

const WITH_ANA = ConversationId.of('demowithana0')
const WITH_BEN = ConversationId.of('demowithben0')
const WITH_KAI = ConversationId.of('demowithkai0')
const BILLING_ROOM = ConversationId.of('demobilling0')
const DEPLOYS_ROOM = ConversationId.of('demodeploys0')
const ONBOARDING_ROOM = ConversationId.of('demoonboard0')

const DIRECT_PARTNERS: ReadonlyMap<ConversationId, ReadonlyArray<MemberId>> = new Map([
  [WITH_ANA, [VISITOR_ID, ANA]],
  [WITH_BEN, [VISITOR_ID, BEN]],
  [WITH_KAI, [VISITOR_ID, KAI]],
])

const BILLING_MANAGERS = GroupId.of('demobillmgrs')
const DEPLOYS_MANAGERS = GroupId.of('demodeplmgrs')
const ONBOARDING_MANAGERS = GroupId.of('demoonbdmgrs')
const PLATFORM_TEAM = GroupId.of('demoplatform')
const CUSTOMER_TEAM = GroupId.of('democustomer')

const characterAt = (index: number): CharacterSpec | null => BUILT_IN_CHARACTERS[index] ?? null

const memberOf = (
  id: MemberId,
  name: string,
  profile: string,
  character: CharacterSpec | null,
  createdAt: number,
): Member => ({
  id,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
  name,
  profile,
  role: 'member',
  status: 'active',
  kind: 'person',
  createdAt,
  character,
})

const person = (
  id: MemberId,
  name: string,
  profile: string,
  character: number,
  ago: (minutes: number) => number,
): MemberRecord => ({
  member: memberOf(id, name, profile, characterAt(character), ago(60 * 24 * 60)),
  presence: { humanOnline: id === VISITOR_ID || id === ANA, agentOnline: id !== BEN },
  lastSeenAt: id === VISITOR_ID ? null : ago(id === BEN ? 60 * 2 : 1),
})

/** A direct conversation, or with a channel's slug, that channel's room, which the slug names. */
const room = (
  id: ConversationId,
  channel: string | null,
  participantIds: ReadonlyArray<MemberId>,
  createdAt: number,
  lastActivityAt: number,
): ConversationRecord => ({
  id,
  kind: channel === null ? 'direct' : 'channel',
  title: channel,
  participantIds,
  createdAt,
  lastActivityAt,
  mutedBy: [],
})

interface NoteFields {
  readonly id: string
  readonly in: ConversationId
  readonly by: MemberId
  /** Minutes before now. */
  readonly at: number
  readonly body: string
  readonly status?: 'draft' | 'sent'
  readonly origin?: Note['origin']
  readonly inReplyTo?: string
  readonly agentName?: string
  readonly basis?: string
  readonly approvedBy?: MemberId
  readonly readBy?: ReadonlyArray<MemberId>
  readonly repliedBy?: ReadonlyArray<MemberId>
}

/**
 * A seeded note; a sent one has a receipt for each person who read or replied to it, and in a direct
 * conversation one for the other person, delivered and unread if they did neither.
 */
const noteOf = (
  fields: NoteFields,
  ago: (minutes: number) => number,
  partners: ReadonlyArray<MemberId> = [],
): Note => {
  const at = ago(fields.at)
  const isSent = (fields.status ?? 'sent') === 'sent'
  return {
    id: NoteId.of(fields.id),
    conversationId: fields.in,
    authorId: fields.by,
    status: fields.status ?? 'sent',
    body: fields.body,
    inReplyTo: fields.inReplyTo === undefined ? null : NoteId.of(fields.inReplyTo),
    origin: fields.origin ?? (fields.agentName === undefined ? 'human' : 'agent'),
    agentName: fields.agentName ?? null,
    createdAt: at,
    updatedAt: at,
    sentAt: isSent ? at : null,
    receipts: isSent
      ? receiptsOf(
          fields,
          at,
          partners.filter((id) => id !== fields.by),
        )
      : [],
    basis: fields.basis ?? null,
    approvedBy: fields.approvedBy ?? null,
  }
}

const receiptsOf = (fields: NoteFields, at: number, recipients: ReadonlyArray<MemberId>): Receipt[] =>
  [...recipients, ...(fields.readBy ?? []), ...(fields.repliedBy ?? [])]
    .filter((memberId, index, all) => all.indexOf(memberId) === index)
    .map((memberId) => {
      const replied = fields.repliedBy?.includes(memberId) === true
      const read = replied || fields.readBy?.includes(memberId) === true
      return {
        memberId,
        state: replied ? 'replied' : read ? 'read' : 'delivered',
        deliveredAt: at,
        readAt: read ? at + MINUTE : null,
        draftingAt: null,
        repliedAt: replied ? at + 50 * MINUTE : null,
      }
    })

interface PrincipleFields {
  readonly id: string
  readonly kind: 'rule' | 'answer'
  readonly topic: string
  readonly rule: string
  readonly place: string | null
  readonly publicText: string | null
  readonly applied: number
  readonly at: number
}

const principle = (position: number, fields: PrincipleFields): Principle => ({
  id: `prin_${fields.id}` as PrincipleId,
  kind: fields.kind,
  topic: fields.topic,
  rule: fields.rule,
  source: null,
  place: fields.place,
  enabled: true,
  origin: 'manual',
  position,
  createdAt: fields.at,
  updatedAt: fields.at,
  lastAppliedAt: fields.at,
  publicText: fields.publicText,
  counts: { applied: fields.applied, sentAsWritten: fields.applied - 1, edited: 1, discarded: 0, missed: 0 },
})
