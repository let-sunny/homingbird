/** What a person changed in their agent's draft, word by word, from the draft and the sent text only. */
export const editDifference = (draft: string, sent: string): EditDifference => {
  const before = wordsOf(draft)
  const after = wordsOf(sent)
  const runs = changedRuns(before, after)
  const removed = runs.flatMap((run) => run.removed)
  const added = runs.flatMap((run) => run.added)
  const typos = runs.reduce((sum, run) => sum + typoPairs(run.removed, run.added), 0)
  const changedWords = Math.max(removed.length, added.length) - typos
  return {
    changedWords,
    share: changedWords / Math.max(1, before.length, after.length),
    removed: runs.filter((run) => run.removed.length > 0).map((run) => run.removed.map(shown).join(' ')),
    added: runs.filter((run) => run.added.length > 0).map((run) => run.added.map(shown).join(' ')),
  }
}

/** An edit that changed what the draft says: at least 8 words, or at least 3 words and 15% of them. */
export const isSubstantialEdit = (draft: string, sent: string): boolean => {
  const difference = editDifference(draft, sent)
  return (
    difference.changedWords >= SUBSTANTIAL_WORDS ||
    (difference.changedWords >= SUBSTANTIAL_MINIMUM && difference.share >= SUBSTANTIAL_SHARE)
  )
}

/** What was said instead of what, as phrases a client words in its own language; null when none is short. */
export const suggestedChange = (draft: string, sent: string): SuggestedChange | null => {
  const difference = editDifference(draft, sent)
  const added = longestShort(difference.added)
  const removed = longestShort(difference.removed)
  if ((difference.added.length > 0 && added === null) || (difference.removed.length > 0 && removed === null))
    return null
  if (added === null && removed === null) return null
  return (added?.length ?? 0) + (removed?.length ?? 0) <= SUGGESTION_MAX ? { added, removed } : null
}

/** Whether a principle still says only what was suggested: it keeps every suggested phrase word for word. */
export const isUnchangedSuggestion = (suggestion: SuggestedChange, rule: string): boolean =>
  [suggestion.added, suggestion.removed].every((phrase) => phrase === null || rule.includes(phrase))

export interface SuggestedChange {
  readonly added: string | null
  readonly removed: string | null
}

export interface EditDifference {
  readonly changedWords: number
  readonly share: number
  readonly removed: ReadonlyArray<string>
  readonly added: ReadonlyArray<string>
}

export const SUBSTANTIAL_WORDS = 8
export const SUBSTANTIAL_MINIMUM = 3
export const SUBSTANTIAL_SHARE = 0.15

interface Word {
  readonly key: string
  readonly text: string
}

interface Run {
  readonly removed: Word[]
  readonly added: Word[]
}

const MAX_DIFFED_WORDS = 1500
const PHRASE_WORDS = 10
const SUGGESTION_MAX = 280

const wordsOf = (text: string): Word[] =>
  text
    .split(/\s+/)
    .map((text) => ({ text, key: text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') }))
    .filter((word) => word.key !== '')
    .slice(0, MAX_DIFFED_WORDS)

const shown = (word: Word): string => word.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, '')

const changedRuns = (before: ReadonlyArray<Word>, after: ReadonlyArray<Word>): Run[] => {
  const lengths = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1))
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      lengths[i]![j] =
        before[i]!.key === after[j]!.key
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!)
  const runs: Run[] = []
  let current: Run = { removed: [], added: [] }
  const close = (): void => {
    if (current.removed.length + current.added.length > 0) runs.push(current)
    current = { removed: [], added: [] }
  }
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i]!.key === after[j]!.key) {
      close()
      i++
      j++
    } else if (j >= after.length || (i < before.length && lengths[i + 1]![j]! >= lengths[i]![j + 1]!))
      current.removed.push(before[i++]!)
    else current.added.push(after[j++]!)
  }
  close()
  return runs
}

const typoPairs = (removed: ReadonlyArray<Word>, added: ReadonlyArray<Word>): number => {
  let pairs = 0
  for (let index = 0; index < Math.min(removed.length, added.length); index++)
    if (isTypo(removed[index]!.key, added[index]!.key)) pairs++
  return pairs
}

const isTypo = (a: string, b: string): boolean =>
  Math.min(a.length, b.length) >= 4 && distance(a, b) <= (Math.max(a.length, b.length) > 6 ? 2 : 1)

const distance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = row
  }
  return previous[b.length]!
}

const longestShort = (phrases: ReadonlyArray<string>): string | null =>
  phrases
    .filter((phrase) => phrase.split(' ').length <= PHRASE_WORDS)
    .reduce<string | null>(
      (longest, phrase) => (longest === null || phrase.length > longest.length ? phrase : longest),
      null,
    )
