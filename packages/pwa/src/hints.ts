import type { PageStorage } from './browser-page.ts'

/**
 * Whether a hint still shows for a concept: hints are for people who are new, so each retires once the
 * person has used its control, and all of them retire after the first two weeks.
 */
export const isHintRetired = (record: HintRecord, concept: HintConcept, now: number): boolean =>
  record.used.includes(concept) || now - record.since >= HINTS_RETIRE_AFTER_MS

/** Whether a touch screen still shows the hint once, beside its control: not dismissed, not retired. */
export const isInlineHintDue = (record: HintRecord, concept: HintConcept, now: number): boolean =>
  !isHintRetired(record, concept, now) && !record.dismissed.includes(concept)

export type HintConcept = (typeof HINT_CONCEPTS)[number]

/** Every concept other messengers lack, each with a hint the first time a person meets it. */
export const HINT_CONCEPTS = [
  'principleKind',
  'principleVisibility',
  'approveAndSend',
  'draft',
  'agentAwake',
  'desk',
  'channelAgent',
  'channelManagers',
  'privateQuestion',
  'debateRoom',
  'debateTurns',
  'debateResult',
  'skippedDraft',
  'sentAsWritten',
  'teachingChances',
  'insights',
  'joinCode',
  'draftPreviews',
  'autoSend',
  'tagging',
  'newMessage',
  'newChannel',
  'browseChannels',
] as const

export interface HintRecord {
  /** When this browser first showed this person a hint. */
  readonly since: number
  readonly used: ReadonlyArray<HintConcept>
  /** The inline hints a touch screen showed and the person closed. */
  readonly dismissed: ReadonlyArray<HintConcept>
}

/**
 * The person's record in this browser, started now when there is none. Where storage is blocked
 * nothing is kept, so every page starts afresh and the hints never retire.
 */
export const readHints = (storage: PageStorage, memberId: string, now: number): HintRecord => {
  const kept = parsedRecord(storage.local(hintsKey(memberId)))
  if (kept !== null) return kept
  const started = restartedHints(now)
  writeHints(storage, memberId, started)
  return started
}

export const writeHints = (storage: PageStorage, memberId: string, record: HintRecord): void =>
  storage.setLocal(hintsKey(memberId), JSON.stringify(record))

export const hintsAfterUse = (record: HintRecord, concept: HintConcept): HintRecord =>
  record.used.includes(concept) ? record : { ...record, used: [...record.used, concept] }

export const hintsAfterDismiss = (record: HintRecord, concept: HintConcept): HintRecord =>
  record.dismissed.includes(concept) ? record : { ...record, dismissed: [...record.dismissed, concept] }

/** Every hint shows again, as for someone new: what Profile's “Show hints again” keeps. */
export const restartedHints = (now: number): HintRecord => ({ since: now, used: [], dismissed: [] })

/** How long a person counts as new: after this, no hint shows any more. */
export const HINTS_RETIRE_AFTER_MS = 14 * 24 * 60 * 60 * 1000

/** How long the pointer or the focus rests on a control before its hint shows, in milliseconds. */
export const HINT_DELAY_MS = 500

const hintsKey = (memberId: string): string => `homingbird.hints.${memberId}`

const parsedRecord = (raw: string | null): HintRecord | null => {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { since, used, dismissed } = value as Record<string, unknown>
    if (typeof since !== 'number') return null
    return { since, used: conceptsIn(used), dismissed: conceptsIn(dismissed) }
  } catch {
    return null
  }
}

const conceptsIn = (value: unknown): HintConcept[] =>
  Array.isArray(value) ? HINT_CONCEPTS.filter((concept) => value.includes(concept)) : []
