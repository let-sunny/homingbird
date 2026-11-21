import type { AsRead, MissOutcome } from '@homingbird/protocol'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { placeName } from './places.ts'
import type { TeachSeed } from './teaching.ts'
import { type TimeShown, timeShown } from './time.ts'

/**
 * Under the figures: the drafts the person edited or discarded and the notes their agent skipped in
 * the period, each a way into its conversation and a chance to teach. Nothing while there are none.
 */
export const draftsBehindModel = (
  report: AsRead.AgentReport | 'failed' | null,
  days: number,
): DraftsBehind | null => {
  if (report === null || report === 'failed') return null
  const from = report.generatedAt - days * DAY_MS
  const misses = (report.misses ?? []).filter((miss) => miss.at > from)
  const groups = OUTCOMES.flatMap((outcome): DraftsBehindGroup[] => {
    const rows = misses.filter((miss) => miss.outcome === outcome)
    return rows.length === 0
      ? []
      : [
          {
            outcome,
            title: strings.teach.behind[outcome]({ count: rows.length }),
            rows: rows.map((miss) => rowOf(miss, report.generatedAt)),
          },
        ]
  })
  return groups.length === 0
    ? null
    : { title: strings.teach.behindTitle, intro: strings.teach.behindIntro, groups }
}

export interface DraftsBehind {
  readonly title: string
  readonly intro: string
  readonly groups: ReadonlyArray<DraftsBehindGroup>
}

export interface DraftsBehindGroup {
  readonly outcome: KnownOutcome
  readonly title: string
  readonly rows: ReadonlyArray<DraftsBehindRow>
}

export interface DraftsBehindRow {
  readonly key: string
  readonly place: string
  readonly time: TimeShown
  readonly href: string
  readonly open: string
  readonly teach: string
  readonly seed: TeachSeed
}

type KnownOutcome = Exclude<MissOutcome, 'unknown'>

const OUTCOMES: ReadonlyArray<KnownOutcome> = ['edited', 'discarded', 'skipped']

const DAY_MS = 24 * 60 * 60_000

/** A discarded draft is gone from its conversation, so it opens the conversation; the others open at the note. */
const rowOf = (miss: AsRead.AgentMiss, now: number): DraftsBehindRow => ({
  key: `${miss.outcome}:${miss.noteId}`,
  place: placeName(miss.place),
  time: timeShown(miss.at, now),
  href: hrefFor({
    name: 'conversation',
    id: miss.conversationId,
    draft: null,
    ...(miss.outcome !== 'discarded' && { note: miss.noteId }),
  }),
  open: strings.teach.openConversation,
  teach: strings.teach.add,
  seed: { topic: '', place: miss.place },
})
