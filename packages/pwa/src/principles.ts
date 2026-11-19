import {
  ANSWER_TEXT_MAX,
  PRINCIPLE_TEXT_MAX,
  type Principle,
  type PrincipleCounts,
  type PrincipleOffer,
  type PrincipleProblem,
  type PublicTextProblem,
  type SuggestedChange,
  appliedTitlesIn,
  isSameTitle,
  isUnchangedSuggestion,
} from '@homingbird/protocol'
import { strings } from './strings.ts'

/** The principles a draft's basis says the agent applied, matched by title against the person's own. */
export const appliedPrinciples = (
  basis: string | null | undefined,
  principles: ReadonlyArray<Principle>,
): Principle[] => {
  const titles = appliedTitlesIn(basis)
  return principles.filter((principle) => titles.some((title) => isSameTitle(title, principle.topic)))
}

/** Counts for a principle, with a share only once it was applied often enough to mean something. */
export const countsShown = (
  counts: PrincipleCounts,
): PrincipleCounts & { readonly sentAsWrittenShare: number | null } => ({
  ...counts,
  sentAsWrittenShare: counts.applied >= SHARE_FROM ? counts.sentAsWritten / counts.applied : null,
})

/** The host a source points to, shown beside it so a person sees where it leads. */
export const sourceHost = (source: string): string | null => {
  try {
    const url = new URL(source)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : null
  } catch {
    return null
  }
}

export const offersIn = (offers: ReadonlyArray<PrincipleOffer>, conversationId: string): PrincipleOffer[] =>
  offers.filter((offer) => offer.conversationId === conversationId)

/** A suggestion saved as offered needs the person's explicit confirmation; a changed one is theirs already. */
export const needsConfirmation = (offer: PrincipleOffer | null, rule: string): boolean =>
  offer?.suggestion != null && isUnchangedSuggestion(offer.suggestion, rule)

/** The suggested rule worded in the person's language, from the phrases the edit changed. */
export const suggestionText = (suggestion: SuggestedChange): string => {
  const words = strings.teach.suggestion
  if (suggestion.added !== null && suggestion.removed !== null)
    return words.replace({ added: suggestion.added, removed: suggestion.removed })
  if (suggestion.added !== null) return words.include({ added: suggestion.added })
  return words.leaveOut({ removed: suggestion.removed ?? '' })
}

/** Why the form cannot be saved yet, in the person's language; null when it can. */
export const problemText = (problem: PrincipleProblem | PublicTextProblem | null): string | null =>
  problem === null
    ? null
    : problem === 'answer_too_long'
      ? strings.teach.problems.answer_too_long({ max: ANSWER_TEXT_MAX })
      : problem === 'rule_too_long'
        ? strings.teach.problems.rule_too_long({ max: PRINCIPLE_TEXT_MAX })
        : strings.teach.problems[problem]

export const SHARE_FROM = 5
