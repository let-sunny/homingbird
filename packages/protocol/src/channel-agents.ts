import { Schema as S } from '@homingbird/kernel'
import { CredentialId, MemberId, Timestamp } from './ids.ts'
import { ChannelSlug, Member, Note } from './model.ts'

/** A person managing the channel sends its agent's draft, unless it answers them: rule 2 hides it from them. */
export const reviewerStanding = (facts: ReviewerFacts): ReviewerStanding =>
  !facts.isPerson
    ? 'not_a_person'
    : !facts.managers.includes(facts.reviewerId)
      ? 'not_a_manager'
      : facts.askers.includes(facts.reviewerId)
        ? 'asked_it'
        : 'reviewer'

export interface ReviewerFacts {
  readonly reviewerId: MemberId
  readonly isPerson: boolean
  readonly managers: ReadonlyArray<MemberId>
  readonly askers: ReadonlyArray<MemberId>
}

export type ReviewerStanding = 'reviewer' | 'not_a_person' | 'not_a_manager' | 'asked_it'

export const possibleReviewers = (
  managers: ReadonlyArray<MemberId>,
  askers: ReadonlyArray<MemberId>,
): MemberId[] => managers.filter((id) => !askers.includes(id))

export const CHANNEL_AGENT_NAME_MAX = 80

export const ChannelAgentName = S.refine<string>(
  'channel-agent-name',
  (text) => text.trim() !== '' && !/[\p{Cc}\p{Cf}]/u.test(text),
  'expected one line of printable text',
)(S.string({ minLength: 1, maxLength: CHANNEL_AGENT_NAME_MAX }))

export const AGENT_OPEN_DRAFTS_MAX = 50

export const NO_REVIEWER_MESSAGE =
  'Nobody can approve this answer: the person who asked is this channel’s only manager. A manager adds another manager first.'

/** An agent's credential as its channel's managers see it: who issued it, never its token. */
export const AgentCredential = S.struct({
  id: CredentialId,
  name: S.string({ maxLength: 200 }),
  client: S.string({ maxLength: 200 }),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  lastUsedAt: S.nullable(Timestamp),
  revokedAt: S.nullable(Timestamp),
  issuedBy: S.nullable(MemberId),
})
export type AgentCredential = S.Infer<typeof AgentCredential>

export const ChannelAgent = S.struct({
  agent: Member,
  channel: ChannelSlug,
  credentials: S.array(AgentCredential, { maxItems: 200 }),
})
export type ChannelAgent = S.Infer<typeof ChannelAgent>

/** A channel's agent's draft as a reviewer reads it, with its question and what it relied on. */
export const Review = S.struct({
  note: Note,
  question: S.nullable(Note),
  channel: ChannelSlug,
  agent: Member,
  privately: S.boolean,
})
export type Review = S.Infer<typeof Review>

export const AgentListing = S.struct({ member: Member, channel: S.nullable(ChannelSlug) })
export type AgentListing = S.Infer<typeof AgentListing>
