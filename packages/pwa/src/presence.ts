import type { AsRead } from '@homingbird/protocol'
import { formats, strings } from './strings.ts'

export interface PresenceShown {
  readonly person: { readonly isOn: boolean; readonly label: string; readonly words: string | null }
  readonly agent: { readonly isOn: boolean; readonly title: string; readonly words: string | null }
}

export const presenceShown = (presence: AsRead.Presence, inWords: boolean): PresenceShown => {
  const personLabel = presence.humanOnline ? strings.humanOnline : strings.humanOffline
  return {
    person: { isOn: presence.humanOnline, label: personLabel, words: inWords ? personLabel : null },
    agent: agentShown(presence, inWords),
  }
}

/** What a colleague's composer says before sending to someone whose desk runs but whose agent cannot answer. */
export const theirAgentUnavailable = (presence: AsRead.Presence | undefined): string | null => {
  const unavailable = unavailableOf(presence)
  if (unavailable === null) return null
  return unavailable.until === null
    ? strings.theirAgentUnavailable
    : strings.theirAgentUnavailableUntil({ time: timeOf(unavailable.until) })
}

/** The desk's own person reads why their agent cannot answer, and when it tries again if that is known. */
export const deskUnavailableReason = (presence: AsRead.Presence | null): ReadonlyArray<string> => {
  const unavailable = unavailableOf(presence ?? undefined)
  if (unavailable === null) return []
  const reason = strings.deskUnavailableReason[unavailable.kind ?? 'unknown']
  return unavailable.until === null
    ? [reason]
    : [reason, strings.deskTriesAgainAt({ time: timeOf(unavailable.until) })]
}

/** Whether a running desk's agent cannot answer now; a desk that is not awake is not "unavailable". */
export const unavailableOf = (
  presence: AsRead.Presence | undefined,
): NonNullable<AsRead.Presence['agentUnavailable']> | null =>
  presence?.agentOnline === true ? (presence.agentUnavailable ?? null) : null

const agentShown = (presence: AsRead.Presence, inWords: boolean): PresenceShown['agent'] => {
  const unavailable = unavailableOf(presence)
  if (unavailable !== null) {
    const words =
      unavailable.until === null
        ? strings.agentUnavailable
        : strings.agentUnavailableUntil({ time: timeOf(unavailable.until) })
    return { isOn: false, title: strings.agentUnavailableHint, words }
  }
  return {
    isOn: presence.agentOnline,
    title: presence.agentOnline ? strings.agentOnlineHint : strings.agentOffline,
    words: presence.agentOnline ? strings.agentOnline : inWords ? strings.agentOffline : null,
  }
}

const timeOf = (timestamp: number): string => formats.time.format(new Date(timestamp))
