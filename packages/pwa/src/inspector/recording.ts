import type { Clock } from '@homingbird/kernel'
import { type ApiErrorTag, HTTP_STATUS } from '@homingbird/protocol'
import { type ReadableSignal, signal } from '@homingbird/ui'
import type { Inside, Load, Move } from '../resource.ts'
import type { CodeName } from './code-name.ts'

/**
 * What a page's resources and requests did lately, for whoever debugs them: names the code declares,
 * counts, sizes, steps and times, and nothing a person or a server wrote. It lives in this page only.
 */
export const createRecording = (clock: Pick<Clock, 'now'>): Recording => {
  const startedAt = clock.now()
  const watched = new Map<CodeName, Watched>()
  const changes = signal(0)
  let timeline: ReadonlyArray<Entry> = []
  let cleared = 0
  let hasEnded = false
  let made = 0
  const now = (): number => clock.now() - startedAt
  const keep = (next: ReadonlyArray<Entry>): void => {
    timeline = next
    changes.update((count) => count + 1)
  }
  const add = (entry: Entry): void => {
    if (!hasEnded) keep([...timeline, entry].slice(-TIMELINE_LIMIT))
  }
  const clear = (): void => {
    cleared++
    for (const seen of watched.values()) Object.assign(seen, UNSEEN)
    keep([])
  }
  return {
    changes,
    watch: (path, read) => {
      const seen: Watched = { read, ...UNSEEN }
      watched.set(path, seen)
      return {
        moved: (move, refused) => {
          if (hasEnded) return
          const at = now()
          const error = refused === undefined ? null : tagOf(refused)
          if (move === 'asked') Object.assign(seen, { askedAt: at, attempts: read().inside.attempts })
          if (move === 'answered') Object.assign(seen, { answeredAt: at, lastError: null })
          if (error !== null) seen.lastError = error
          add({ kind: 'move', at, path, move, error })
        },
        stepped: () => {
          const { step, loaded, error } = read().load
          add({ kind: 'step', at: now(), path, step, loaded, error: error === null ? null : tagOf(error) })
        },
      }
    },
    asked: (route) => {
      const at = now()
      const before = cleared
      const number = made++
      add({ kind: 'request', number, at, route, ms: null, outcome: 'pending', status: null })
      return (outcome, status) => {
        if (before !== cleared) return
        const ended = { ms: now() - at, outcome, status: statusOf(status) }
        keep(
          timeline.map((entry) =>
            entry.kind === 'request' && entry.number === number ? { ...entry, ...ended } : entry,
          ),
        )
      }
    },
    snapshot: () => ({
      now: now(),
      resources: [...watched].map(([path, seen]) => rowOf(path, seen)),
      timeline,
    }),
    clear,
    end: () => {
      hasEnded = true
      clear()
    },
  }
}

export interface Recording {
  /** Changes with everything recorded. */
  readonly changes: ReadableSignal<number>
  readonly watch: (path: CodeName, read: () => Reading) => Watch
  /** A route is asked; the call it gives ends the request, with how it went and the HTTP status if one came. */
  readonly asked: (route: CodeName) => (outcome: Outcome, status: number | null) => void
  readonly snapshot: () => Snapshot
  /** Forgets everything recorded, and the end of what still runs. */
  readonly clear: () => void
  /** Forgets everything recorded, and records nothing from here on. */
  readonly end: () => void
}

export interface Reading {
  readonly inside: Inside
  readonly load: Load
}

export interface Watch {
  readonly moved: (move: Move, refused?: object) => void
  readonly stepped: () => void
}

/** What may leave the page, as the person's export; times are milliseconds since the recording started. */
export interface Snapshot {
  readonly now: number
  readonly resources: ReadonlyArray<ResourceRow>
  /** The oldest first. */
  readonly timeline: ReadonlyArray<Entry>
}

export interface ResourceRow extends Inside, Pick<Load, 'step' | 'loaded'> {
  readonly path: CodeName
  readonly askedAt: number | null
  readonly answeredAt: number | null
  readonly lastError: ErrorName | null
}

export type Entry = MoveEntry | StepEntry | RequestEntry

export interface MoveEntry {
  readonly kind: 'move'
  readonly at: number
  readonly path: CodeName
  readonly move: Move
  readonly error: ErrorName | null
}

export interface StepEntry extends Pick<Load, 'step' | 'loaded'> {
  readonly kind: 'step'
  readonly at: number
  readonly path: CodeName
  readonly error: ErrorName | null
}

export interface RequestEntry {
  readonly kind: 'request'
  readonly number: number
  readonly at: number
  readonly route: CodeName
  /** How long it took; null while it runs. */
  readonly ms: number | null
  readonly outcome: Outcome
  readonly status: number | null
}

export type ErrorName = ApiErrorTag | 'Other'

export type Outcome = 'pending' | 'ok' | 'interrupted' | 'broke' | ErrorName

/** The tag of a refusal where the protocol lists it, and nothing else of it. */
export const tagOf = (refused: object): ErrorName => {
  const tag: unknown = '_tag' in refused ? refused._tag : undefined
  return typeof tag === 'string' && Object.hasOwn(HTTP_STATUS, tag) ? (tag as ApiErrorTag) : 'Other'
}

const TIMELINE_LIMIT = 100

interface Watched {
  readonly read: () => Reading
  askedAt: number | null
  answeredAt: number | null
  attempts: number
  lastError: ErrorName | null
}

const UNSEEN = { askedAt: null, answeredAt: null, attempts: 0, lastError: null }

const rowOf = (path: CodeName, seen: Watched): ResourceRow => {
  const { inside, load } = seen.read()
  return {
    path,
    step: load.step,
    loaded: load.loaded,
    running: inside.running,
    resting: inside.resting,
    queued: inside.queued,
    patches: inside.patches,
    attempts: seen.attempts,
    items: inside.items,
    askedAt: seen.askedAt,
    answeredAt: seen.answeredAt,
    lastError: seen.lastError,
  }
}

const statusOf = (status: number | null): number | null =>
  status !== null && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null
