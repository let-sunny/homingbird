import type { TrustVerdict } from '@homingbird/protocol'

/** Dovecote's plain-language reading of drafts decided, so that the same numbers always read the same. */
export const verdictOf = (sentAsWritten: number, sentAfterEdits: number, discarded: number): TrustVerdict => {
  const decided = sentAsWritten + sentAfterEdits + discarded
  if (decided < MINIMUM_DECIDED) return 'too_few'
  if (sentAsWritten >= USUALLY * decided) return 'usually_as_written'
  if (discarded >= OFTEN * decided && discarded >= sentAfterEdits) return 'often_discarded'
  if (sentAfterEdits >= OFTEN * decided) return 'often_edited'
  return 'mixed'
}

export const MINIMUM_DECIDED = 10

const USUALLY = 0.7
const OFTEN = 0.3
