import {
  ANSWER_TEXT_MAX,
  type AsRead,
  PRINCIPLE_TEXT_MAX,
  type PrincipleCounts,
  type PrincipleProblem,
  type PublicTextProblem,
  type SuggestedChange,
  appliedTitlesIn,
  isSameTitle,
  isUnchangedSuggestion,
} from '@homingbird/protocol'
import { strings } from './strings.ts'

/** What a draft's basis says was applied, in its order (a channel's first), matched to the person's principles. */
export const appliedClaims = (
  basis: string | null | undefined,
  principles: ReadonlyArray<AsRead.Principle>,
): AppliedClaim[] => {
  const claims: AppliedClaim[] = []
  for (const title of appliedTitlesIn(basis)) {
    const principle = principles.find((each) => isSameTitle(title, each.topic)) ?? null
    const named = principle === null ? title : principle.topic
    if (claims.some((claim) => claim.title === named)) continue
    claims.push({ title: named, principle })
  }
  return claims
}

export const appliedPrinciples = (
  basis: string | null | undefined,
  principles: ReadonlyArray<AsRead.Principle>,
): AsRead.Principle[] =>
  appliedClaims(basis, principles).flatMap((claim) => (claim.principle === null ? [] : [claim.principle]))

export interface AppliedClaim {
  readonly title: string
  readonly principle: AsRead.Principle | null
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

export const offersIn = (
  offers: ReadonlyArray<AsRead.PrincipleOffer>,
  conversationId: string,
): AsRead.PrincipleOffer[] => offers.filter((offer) => offer.conversationId === conversationId)

/** A suggestion saved as offered needs the person's explicit confirmation; a changed one is theirs already. */
export const needsConfirmation = (offer: AsRead.PrincipleOffer | null, rule: string): boolean =>
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

const SHARE_FROM = 5
