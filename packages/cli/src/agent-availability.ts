import type { DeskUnavailableKind } from '@homingbird/protocol'
import type { AgentRun } from './environment.ts'

/**
 * Whether a failed run says the agent cannot answer at all, and until when, from what the agent program
 * wrote: its usage limit, a rate limit, or being signed out. Best effort, since each vendor words it its
 * own way; only the kind and the time leave the desk, never the text.
 */
export const unavailabilityIn = (run: AgentRun, now: number): Unavailability | null => {
  const said = `${run.errors ?? ''}\n${run.output}`
  if (SIGNED_OUT.some((pattern) => pattern.test(said))) return { kind: 'signed_out', until: null }
  if (!USAGE_LIMIT.some((pattern) => pattern.test(said))) return null
  return { kind: 'usage_limit', until: resetTimeIn(said, now) }
}

/**
 * Whether a run that exited cleanly printed only a usage-limit notice, which some agent programs do in
 * place of an answer: it must never become a draft.
 */
export const isUsageLimitNotice = (output: string): boolean => {
  const text = output.trim()
  return text.length <= NOTICE_MAX && USAGE_LIMIT_NOTICE.test(text)
}

export interface Unavailability {
  readonly kind: DeskUnavailableKind
  readonly until: number | null
}

/** When the agent says its limit resets: an epoch after a bar, "resets 3pm", or "try again in 2 hours". */
const resetTimeIn = (said: string, now: number): number | null => {
  const epoch = /usage limit reached\|(\d{10,13})/i.exec(said)?.[1]
  if (epoch !== undefined) return epoch.length === 13 ? Number(epoch) : Number(epoch) * 1000
  const inTime = /try again in\s+(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i.exec(said)
  if (inTime !== null && (inTime[1] !== undefined || inTime[2] !== undefined))
    return now + (Number(inTime[1] ?? 0) * 60 + Number(inTime[2] ?? 0)) * 60_000
  const clock = /(?:resets|try again at)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(said)
  return clock === null ? null : nextTimeOfDay(now, clock[1]!, clock[2], clock[3])
}

/** The next moment at this hour and minute of the desk's own local day, today or tomorrow. */
const nextTimeOfDay = (
  now: number,
  hour: string,
  minute: string | undefined,
  half: string | undefined,
): number | null => {
  if (Number(hour) > (half === undefined ? 23 : 12) || Number(minute ?? 0) > 59) return null
  const hours = (Number(hour) % (half === undefined ? 24 : 12)) + (half?.toLowerCase() === 'pm' ? 12 : 0)
  const at = new Date(now)
  at.setHours(hours, Number(minute ?? 0), 0, 0)
  return at.getTime() > now ? at.getTime() : at.getTime() + DAY_MS
}

const USAGE_LIMIT: ReadonlyArray<RegExp> = [
  /usage limit/i,
  /you['’]ve hit your (?:usage )?limit/i,
  /\b\d+-hour limit reached/i,
  /rate[ _-]?limit/i,
  /\b429\b/,
  /too many requests/i,
  /insufficient_quota|quota exceeded|exceeded your current quota/i,
  /credit balance is too low/i,
]

const USAGE_LIMIT_NOTICE =
  /^(?:claude ai usage limit reached\|\d{10,13}|you['’]ve hit your (?:usage )?limit\b.*|\d+-hour limit reached\b.*)$/is

const SIGNED_OUT: ReadonlyArray<RegExp> = [
  /not (?:logged|signed) in/i,
  /please (?:run )?\/?login/i,
  /invalid api key/i,
  /authentication_error/i,
  /oauth token (?:has )?expired/i,
  /\b401\b|\bunauthori[sz]ed\b/i,
]

const NOTICE_MAX = 300
const DAY_MS = 24 * 60 * 60_000
