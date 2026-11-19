import { Schema as S } from '@homingbird/kernel'
import { MemberId } from './ids.ts'

/** Why the agents did not agree on one point: what a person does next depends on which it is. */
export const DisagreementCategory = S.literal('information', 'assumptions', 'goals', 'open_question')
export type DisagreementCategory = S.Infer<typeof DisagreementCategory>

/** What the growth record credits an agent for. Never a win, a count or a ranking. */
export const DebateCredit = S.literal(
  'conclusion',
  'gap_filled',
  'disagreement_separated',
  'position_changed',
  'next_step_accepted',
)
export type DebateCredit = S.Infer<typeof DebateCredit>

/** The credits the drafting agent may name for a participant; the others follow from the result itself. */
export const ClaimedCredit = S.literal('gap_filled', 'disagreement_separated', 'position_changed')
export type ClaimedCredit = S.Infer<typeof ClaimedCredit>

export const DEBATE_PARTICIPANTS_MAX = 8

export const Contribution = S.struct({
  memberId: MemberId,
  summary: S.string({ minLength: 1, maxLength: 400 }),
  credits: S.array(ClaimedCredit, { maxItems: 3 }),
})
export type Contribution = S.Infer<typeof Contribution>

export const NextStep = S.struct({
  step: S.string({ minLength: 1, maxLength: 300 }),
  owner: S.nullable(MemberId),
  proposedBy: MemberId,
})
export type NextStep = S.Infer<typeof NextStep>

export const DisagreementPoint = S.struct({
  point: S.string({ minLength: 1, maxLength: 300 }),
  category: DisagreementCategory,
  explanation: S.string({ minLength: 1, maxLength: 600 }),
})
export type DisagreementPoint = S.Infer<typeof DisagreementPoint>

const contributions = S.array(Contribution, { maxItems: DEBATE_PARTICIPANTS_MAX })
const nextSteps = S.array(NextStep, { maxItems: 8 })

/** The one result of a room: a conclusion when the agents agreed, else where and why they did not. */
export const DebateResult = S.variants('kind', {
  conclusion: {
    conclusion: S.string({ minLength: 1, maxLength: 1500 }),
    reasons: S.array(S.string({ minLength: 1, maxLength: 400 }), { minItems: 1, maxItems: 8 }),
    contributions,
    nextSteps,
  },
  no_conclusion: {
    summary: S.string({ minLength: 1, maxLength: 1500 }),
    points: S.array(DisagreementPoint, { minItems: 1, maxItems: 12 }),
    contributions,
    nextSteps,
  },
})
export type DebateResult = S.Infer<typeof DebateResult>
