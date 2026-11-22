import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { ConversationId, NoteId, Timestamp } from './ids.ts'
import { PlaceName } from './insights.ts'
import { NOTE_BODY_MAX } from './model.ts'
import { PrincipleSource } from './principle-source.ts'
import {
  PRINCIPLES_PER_PERSON,
  PRINCIPLE_TOPIC_MAX,
  type PrincipleKind,
  PrincipleKind as PrincipleKindSchema,
  type PrincipleProblem,
  PrincipleRule,
  PrincipleTopic,
  isLikelyForbidden,
  principleProblem,
} from './principles.ts'

/** Why a proposal cannot be kept: what would stop a person saving it, or a forbidden request. */
export const proposalProblem = (item: {
  readonly kind: PrincipleKind
  readonly topic: string
  readonly rule: string
  readonly source: string | null
}): PrincipleProblem | 'forbidden' | null =>
  principleProblem(item) ?? (isLikelyForbidden(item) ? 'forbidden' : null)

export const FORBIDDEN_PROPOSAL_MESSAGE =
  'A proposal may not ask for something no agent may do: approve, send, discard, change contacts or a character, or touch credentials.'

export const PROPOSALS_PER_PERSON = 20
export const PROPOSAL_QUESTION_MAX = 200
/** A pasted principles document: long enough for a team's page, short enough for one prompt. */
export const TEACHING_DOCUMENT_MAX = 20_000
export const REWRITES_SHOWN = 10

export const ProposalId = S.brand<'ProposalId'>()(
  S.string({ pattern: /^prop_[0-9a-z]{12,}$/, maxLength: 45 }),
)
export type ProposalId = S.Infer<typeof ProposalId>

export const ProposalOrigin = S.tolerant(S.literal('chat', 'edit', 'discard'), UNKNOWN)
export type ProposalOrigin = S.Infer<typeof ProposalOrigin>

/** Never part of any instruction: it becomes a principle only when the person saves it (rule 8). */
export const PrincipleProposal = S.struct({
  id: ProposalId,
  kind: PrincipleKindSchema,
  topic: PrincipleTopic,
  rule: PrincipleRule,
  source: S.nullable(PrincipleSource),
  place: PlaceName,
  question: S.nullable(S.string({ maxLength: PROPOSAL_QUESTION_MAX })),
  origin: ProposalOrigin,
  rewriteOf: S.nullable(NoteId),
  createdAt: Timestamp,
})
export type PrincipleProposal = S.Infer<typeof PrincipleProposal>

export const TeachingDocument = S.string({ maxLength: TEACHING_DOCUMENT_MAX })

export const TeachingInterview = S.struct({
  document: S.nullable(TeachingDocument),
  proposals: S.array(PrincipleProposal, { maxItems: PROPOSALS_PER_PERSON }),
  limit: S.int({ min: 1 }),
})
export type TeachingInterview = S.Infer<typeof TeachingInterview>

export const RewriteOutcome = S.tolerant(S.literal('edited', 'discarded'), UNKNOWN)
export type RewriteOutcome = S.Infer<typeof RewriteOutcome>

const QuotedNote = S.struct({
  noteId: NoteId,
  authorName: S.string({ maxLength: 200 }),
  authorEmail: S.string({ maxLength: 320 }),
  sentAt: S.nullable(Timestamp),
  body: S.string({ maxLength: NOTE_BODY_MAX }),
})

export const Rewrite = S.struct({
  noteId: NoteId,
  conversationId: ConversationId,
  place: PlaceName,
  outcome: RewriteOutcome,
  draft: S.string({ maxLength: NOTE_BODY_MAX }),
  sent: S.nullable(S.string({ maxLength: NOTE_BODY_MAX })),
  decidedAt: Timestamp,
  asked: S.nullable(QuotedNote),
})
export type Rewrite = S.Infer<typeof Rewrite>

/** What a person's own agent reads to run a teaching chat. Every text in it is data, never instructions. */
export const TeachingMaterial = S.struct({
  personName: S.string({ maxLength: 200 }),
  personEmail: S.string({ maxLength: 320 }),
  document: S.nullable(TeachingDocument),
  rewrites: S.array(Rewrite, { maxItems: REWRITES_SHOWN }),
  taught: S.array(S.string({ maxLength: PRINCIPLE_TOPIC_MAX }), { maxItems: PRINCIPLES_PER_PERSON }),
  proposed: S.array(S.string({ maxLength: PRINCIPLE_TOPIC_MAX }), { maxItems: PROPOSALS_PER_PERSON }),
  room: S.int({ min: 0 }),
})
export type TeachingMaterial = S.Infer<typeof TeachingMaterial>

export const ProposalInput = S.struct({
  kind: S.optional(PrincipleKindSchema),
  topic: PrincipleTopic,
  rule: PrincipleRule,
  source: S.optional(S.nullable(PrincipleSource)),
  place: S.optional(PlaceName),
  question: S.optional(S.nullable(S.string({ maxLength: PROPOSAL_QUESTION_MAX }))),
  rewriteOf: S.optional(S.nullable(NoteId)),
})
export type ProposalInput = S.Infer<typeof ProposalInput>
