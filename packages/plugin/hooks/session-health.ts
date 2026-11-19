import type { EngineInterface } from 'claude-code'

import { host, hostOr } from './effects'
import { T } from './kernel.mjs'
import { FRESH_SESSION_AFTER_MINUTES, FRESH_SESSION_AT_CONTEXT_PERCENT } from './session-thresholds'

/** This session's age, context use and auto-compact setting, as far as the host tells; null when it tells nothing. */
export function sessionHealthOf($: EngineInterface): T.Task<SessionHealth | null> {
  return T.gen(function* () {
    const figures = yield* sessionFiguresOf($)
    if (figures === null) return null
    return { ...figures, autoCompact: yield* autoCompactOf($) }
  })
}

/**
 * Why this desk session is due for a fresh start, by the web client's thresholds: its age, or its context
 * use while auto-compact is off or not known. A session that compacts itself never runs out of context.
 */
export const freshStartReasonOf = (health: SessionHealth | null): FreshStartReason | null => {
  if (health === null) return null
  if (health.ageMinutes >= FRESH_SESSION_AFTER_MINUTES) return 'age'
  if (health.contextPercent === null || health.contextPercent < FRESH_SESSION_AT_CONTEXT_PERCENT) return null
  if (health.autoCompact === true) return null
  return health.autoCompact === false ? 'context' : 'context-compact-unknown'
}

/** The session's age in whole minutes and its context use in whole percent, once the host knows it. */
export function sessionFiguresOf($: EngineInterface): T.Task<SessionFigures | null> {
  return T.gen(function* () {
    const usage = yield* hostOr(() => $.session.usage(), undefined)
    if (usage === undefined) return null
    const now = yield* host(() => $.clock.now())
    const percent = usage.context.percent
    return {
      ageMinutes: Math.max(0, Math.floor((now - usage.startedAt) / 60_000)),
      contextPercent:
        percent === undefined || !Number.isFinite(percent)
          ? null
          : Math.round(Math.min(100, Math.max(0, percent))),
    }
  })
}

export interface SessionFigures {
  readonly ageMinutes: number
  readonly contextPercent: number | null
}

export interface SessionHealth extends SessionFigures {
  /** Whether the host compacts this session's context by itself; null when the host does not say. */
  readonly autoCompact: boolean | null
}

export type FreshStartReason = 'age' | 'context' | 'context-compact-unknown'

/** The `/config` row an older host may not list; its absence means the setting is not known. */
export const AUTO_COMPACT_SETTING = 'autoCompact'

function autoCompactOf($: EngineInterface): T.Task<boolean | null> {
  return T.map((rows: ReadonlyArray<{ readonly key: string; readonly value: unknown }> | undefined) => {
    const value = rows?.find((row) => row.key === AUTO_COMPACT_SETTING)?.value
    return typeof value === 'boolean' ? value : null
  })(hostOr(() => $.config.list(), undefined))
}
