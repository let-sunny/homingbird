import { Schema as S } from '@homingbird/kernel'
import { UNKNOWN } from './compatibility.ts'
import { MemberId } from './ids.ts'
import { AgentLabel } from './model.ts'

/** Why the agents did not agree on one point: what a person does next depends on which it is. */
export const DisagreementCategory = S.tolerant(
  S.literal('information', 'assumptions', 'goals', 'open_question'),
  UNKNOWN,
)
export type DisagreementCategory = S.Infer<typeof DisagreementCategory>

/** What the growth record credits an agent for. Never a win, a count or a ranking. */
export const DebateCredit = S.tolerant(
  S.literal('conclusion', 'gap_filled', 'disagreement_separated', 'position_changed', 'next_step_accepted'),
  UNKNOWN,
)
export type DebateCredit = S.Infer<typeof DebateCredit>

/** The credits the drafting agent may name for a participant; the others follow from the result itself. */
export const ClaimedCredit = S.tolerant(
  S.literal('gap_filled', 'disagreement_separated', 'position_changed'),
  UNKNOWN,
)
export type ClaimedCredit = S.Infer<typeof ClaimedCredit>

export const DEBATE_PARTICIPANTS_MAX = 8

export const RESULT_TEXT_MAX = {
  conclusion: 1500,
  reason: 400,
  contribution: 400,
  step: 300,
  point: 300,
  explanation: 600,
  changedMind: 300,
  stillOpen: 300,
} as const

export const CreditAtTurn = S.struct({ credit: ClaimedCredit, turn: S.int({ min: 1 }) })
export type CreditAtTurn = S.Infer<typeof CreditAtTurn>

/** A credit as a draft names it: with its turn, or, as drafts did before, the kind alone, which earns nothing. */
export const NamedCredit = S.union(CreditAtTurn, ClaimedCredit)
export type NamedCredit = S.Infer<typeof NamedCredit>

export const Contribution = S.struct({
  memberId: MemberId,
  summary: S.string({ minLength: 1, maxLength: RESULT_TEXT_MAX.contribution }),
  credits: S.array(NamedCredit, { maxItems: 3 }),
})
export type Contribution = S.Infer<typeof Contribution>

export const NextStep = S.struct({
  step: S.string({ minLength: 1, maxLength: RESULT_TEXT_MAX.step }),
  owner: S.nullable(MemberId),
  proposedBy: MemberId,
})
export type NextStep = S.Infer<typeof NextStep>

export const DisagreementPoint = S.struct({
  point: S.string({ minLength: 1, maxLength: RESULT_TEXT_MAX.point }),
  category: DisagreementCategory,
  explanation: S.string({ minLength: 1, maxLength: RESULT_TEXT_MAX.explanation }),
})
export type DisagreementPoint = S.Infer<typeof DisagreementPoint>

export const ChangedMind = S.struct({
  turn: S.int({ min: 1 }),
  line: S.string({ minLength: 1, maxLength: RESULT_TEXT_MAX.changedMind }),
})
export type ChangedMind = S.Infer<typeof ChangedMind>

const contributions = S.array(Contribution, { maxItems: DEBATE_PARTICIPANTS_MAX })
const nextSteps = S.array(NextStep, { maxItems: 8 })

export const conclusionFields = {
  conclusion: S.string({ minLength: 1, maxLength: RESULT_TEXT_MAX.conclusion }),
  reasons: S.array(S.string({ minLength: 1, maxLength: RESULT_TEXT_MAX.reason }), {
    minItems: 1,
    maxItems: 8,
  }),
  contributions,
  nextSteps,
  changedMinds: S.optional(S.array(ChangedMind, { maxItems: 8 })),
  stillOpen: S.optional(
    S.array(S.string({ minLength: 1, maxLength: RESULT_TEXT_MAX.stillOpen }), { maxItems: 8 }),
  ),
  /** Where the agents differed before they agreed, by the same categories as a disagreement. */
  points: S.optional(S.array(DisagreementPoint, { maxItems: 12 })),
}

export const noConclusionFields = {
  summary: S.string({ minLength: 1, maxLength: RESULT_TEXT_MAX.conclusion }),
  points: S.array(DisagreementPoint, { minItems: 1, maxItems: 12 }),
  contributions,
  nextSteps,
}

export const UNKNOWN_RESULT = { kind: UNKNOWN } as const

/** The one result of a room: a conclusion when the agents agreed, else where and why they did not. */
export const DebateResult = S.openVariants(
  'kind',
  { conclusion: conclusionFields, no_conclusion: noConclusionFields },
  UNKNOWN_RESULT,
)
export type DebateResult = S.Infer<typeof DebateResult>

/** A draft of the result as an agent sends it: the result, and the model the agent says it ran as. */
export const DraftedResult = S.variants('kind', {
  conclusion: { ...conclusionFields, model: S.optional(AgentLabel) },
  no_conclusion: { ...noConclusionFields, model: S.optional(AgentLabel) },
})
export type DraftedResult = S.Infer<typeof DraftedResult>

export const resultOfDraft = (
  drafted: DraftedResult,
): { readonly result: DebateResult; readonly model: string | null } => {
  const { model = null, ...result } = drafted
  return { result, model }
}

export const creditKindOf = <C extends string>(
  credit: C | { readonly credit: C; readonly turn: number },
): C => (typeof credit === 'string' ? credit : credit.credit)

export const creditTurnOf = (credit: string | { readonly turn: number }): number | null =>
  typeof credit === 'string' ? null : credit.turn
