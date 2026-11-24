import type { Entry, Outcome, ResourceRow, Snapshot } from '../inspector/recording.ts'
import type { InspectorWords } from '../inspector/words.ts'

/** What the developers' panel shows of a recording. */
export const inspectorModel = (
  snapshot: Snapshot,
  filter: TimelineFilter,
  words: InspectorWords,
  locale: string,
): InspectorModel => ({
  summary: words.summary({ count: snapshot.resources.filter((row) => row.running).length }),
  lists: snapshot.resources.map((row) => listShown(row, snapshot.now, words, locale)),
  timeline: snapshot.timeline
    .filter((entry) => isShown(entry, filter))
    .map((entry) => lineShown(entry, words, locale))
    .reverse(),
})

export interface InspectorModel {
  readonly summary: string
  readonly lists: ReadonlyArray<ListShown>
  /** The newest first. */
  readonly timeline: ReadonlyArray<LineShown>
}

export interface ListShown {
  readonly path: string
  readonly cells: Readonly<Record<ListColumn, string>>
  readonly isFailed: boolean
}

export interface LineShown {
  readonly at: string
  readonly name: string
  readonly what: string
  readonly isFailed: boolean
}

export interface TimelineFilter {
  readonly kind: TimelineKind
  readonly name: string
  readonly failuresOnly: boolean
}

export const TIMELINE_KINDS = ['all', 'list', 'request'] as const
export type TimelineKind = (typeof TIMELINE_KINDS)[number]

/** The columns of the lists after the name and what can be done, in order. */
export const LIST_COLUMNS = [
  'step',
  'age',
  'running',
  'queued',
  'patches',
  'error',
  'items',
  'attempts',
  'asked',
] as const
export type ListColumn = (typeof LIST_COLUMNS)[number]

const listShown = (row: ResourceRow, now: number, words: InspectorWords, locale: string): ListShown => {
  const since = (at: number | null): string =>
    at === null ? words.never : words.ago({ time: timeText(locale, now - at) })
  return {
    path: row.path,
    cells: {
      step: row.step === 'idle' && !row.loaded ? words.notAsked : words.steps[row.step],
      age: since(row.answeredAt),
      running: row.resting ? words.resting : yesOrNo(row.running, words),
      queued: yesOrNo(row.queued, words),
      patches: String(row.patches),
      error: row.lastError ?? words.noError,
      items: String(row.items),
      attempts: String(row.attempts),
      asked: since(row.askedAt),
    },
    isFailed: row.step === 'failed',
  }
}

const yesOrNo = (holds: boolean, words: InspectorWords): string => (holds ? words.yes : words.no)

const lineShown = (entry: Entry, words: InspectorWords, locale: string): LineShown => ({
  at: timeText(locale, entry.at),
  name: nameOf(entry),
  what: whatHappened(entry, words, locale)
    .filter((part) => part !== null)
    .join(' · '),
  isFailed: isFailure(entry),
})

const whatHappened = (
  entry: Entry,
  words: InspectorWords,
  locale: string,
): ReadonlyArray<string | number | null> => {
  switch (entry.kind) {
    case 'move':
      return [words.moves[entry.move], entry.error]
    case 'step': {
      const step = words.steps[entry.step]
      return [entry.loaded ? words.becameLoaded({ step }) : words.becameNotLoaded({ step }), entry.error]
    }
    case 'request':
      return [
        outcomeText(entry.outcome, words),
        entry.status,
        entry.ms === null ? null : timeText(locale, entry.ms),
      ]
  }
}

const outcomeText = (outcome: Outcome, words: InspectorWords): string =>
  outcome in words.outcomes ? words.outcomes[outcome as keyof InspectorWords['outcomes']] : outcome

const isShown = (entry: Entry, { kind, name, failuresOnly }: TimelineFilter): boolean =>
  (kind === 'all' || (kind === 'request') === (entry.kind === 'request')) &&
  nameOf(entry).toLowerCase().includes(name.trim().toLowerCase()) &&
  (!failuresOnly || isFailure(entry))

const isFailure = (entry: Entry): boolean => {
  if (entry.kind === 'request') return !['pending', 'ok', 'interrupted'].includes(entry.outcome)
  return entry.error !== null || (entry.kind === 'move' ? entry.move === 'broke' : entry.step === 'failed')
}

const nameOf = (entry: Entry): string => (entry.kind === 'request' ? entry.route : entry.path)

const timeText = (locale: string, ms: number): string =>
  new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: ms < 1000 ? 'millisecond' : 'second',
    unitDisplay: 'short',
    maximumFractionDigits: ms < 10_000 ? 1 : 0,
  }).format(ms < 1000 ? ms : ms / 1000)
