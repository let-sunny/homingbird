import type { Task as T } from '@homingbird/kernel'
import type { OperationalLevel } from './log-settings.ts'
import { type Log, defectNameOf, logDefect } from './operational-log.ts'

/** Logs the stop by tag, never the failure, which can carry a request's data; returns the stderr line. */
export const logUnexpectedStop = (
  log: Log,
  level: OperationalLevel | 'off',
  cause: T.Cause<unknown>,
): string => {
  const defect = cause._tag === 'Die' ? cause.defect : cause._tag === 'Fail' ? cause.error : cause
  const name = nameOf(defect)
  logDefect(log, { name: 'system.stopped', attributes: { defect: name } }, defect)
  return level === 'off'
    ? `Dovecote stopped unexpectedly: system.stopped ${name}.`
    : 'Dovecote stopped unexpectedly; the operational log says why.'
}

const nameOf = (defect: unknown): string => {
  const tag = (defect as { readonly _tag?: unknown } | null)?._tag
  return typeof tag === 'string' && /^[A-Za-z0-9_$.]{1,60}$/.test(tag) ? tag : defectNameOf(defect)
}
