import { Task as T } from '@homingbird/kernel'
import { type OperationalLevel, isWrittenAt } from './log-settings.ts'
import { OPERATIONAL_EVENTS, type OperationalEvent } from './operational-events.ts'

/** The operational log: one JSON object per line on stdout, for the operator's collector. */
export const makeLog = (options: LogOptions): Log => ({
  emit: (event, requestId = null) => {
    const declared = OPERATIONAL_EVENTS[event.name]
    if (!isWrittenAt(options.level, declared.level)) return
    const attributes = declared.attributes.decode(event.attributes)
    options.write(
      JSON.stringify({
        timestamp: new Date(options.now()).toISOString(),
        severityText: declared.level.toUpperCase(),
        severityNumber: SEVERITY_NUMBERS[declared.level],
        eventName: event.name,
        body: declared.body,
        attributes: {
          ...(attributes._tag === 'Ok' ? attributes.value : { invalidAttributes: true }),
          ...(requestId !== null && { requestId }),
        },
        resource: { 'service.name': 'dovecote', 'service.version': options.version },
      }),
    )
  },
})

export interface Log {
  readonly emit: (event: OperationalEvent, requestId?: string | null) => void
}

export interface LogOptions {
  readonly level: OperationalLevel | 'off'
  readonly write: (line: string) => void
  readonly now: () => number
  readonly version: string
}

/** Where the operational log writes outside tests. */
export const writeToStandardOutput = (line: string): void => void process.stdout.write(`${line}\n`)

/** Writes a line with the request id of the request it belongs to, if any. */
export const logEvent = (
  event: OperationalEvent,
): T.Task<void, never, { readonly log: Log; readonly requestId: string | null }> =>
  T.map((env: { readonly log: Log; readonly requestId: string | null }) =>
    env.log.emit(event, env.requestId),
  )(T.ask<{ readonly log: Log; readonly requestId: string | null }>())

/** A log that keeps every line, at every level, for a test to read. */
export const makeTestLog = (level: OperationalLevel | 'off' = 'debug') => {
  const lines: string[] = []
  const log = makeLog({ level, write: (line) => lines.push(line), now: () => 0, version: 'test' })
  return {
    log,
    lines,
    events: (): ReadonlyArray<{ readonly eventName: string; readonly attributes: Record<string, unknown> }> =>
      lines.map((each) => JSON.parse(each)),
  }
}

/** Logs a defect by its name only, and its redacted detail at debug. */
export const logDefect = (
  log: Log,
  event: Extract<OperationalEvent, { readonly attributes: { readonly defect: string } }>,
  defect: unknown,
  requestId: string | null = null,
): void => {
  log.emit(event, requestId)
  log.emit(
    {
      name: 'defect.detail',
      attributes: { defect: event.attributes.defect, detail: redact(detailOf(defect)) },
    },
    requestId,
  )
}

export const defectNameOf = (defect: unknown): string => {
  const name = defect instanceof Error ? defect.name : typeof defect
  return /^[A-Za-z0-9_$.]{1,60}$/.test(name) ? name : 'Unknown'
}

/** Removes what may be a secret or a person's data from a line meant for debugging. */
export const redact = (text: string): string =>
  REDACTIONS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text).slice(
    0,
    4000,
  )

const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+\S+/gi, 'Bearer [redacted]'],
  [/\b(cookie|set-cookie|authorization):[^\n]*/gi, '$1: [redacted]'],
  [/\bhb[a-z]_[A-Za-z0-9_-]{8,}/g, '[token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\?[^\s"'#]*/g, '?[query]'],
  [/\b[A-Za-z0-9_-]{32,}\b/g, '[secret]'],
]

const SEVERITY_NUMBERS: Readonly<Record<OperationalLevel, number>> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
}

const detailOf = (defect: unknown): string =>
  defect instanceof Error ? (defect.stack ?? defect.message) : String(defect)

export type { OperationalEvent, OperationalEventName } from './operational-events.ts'
