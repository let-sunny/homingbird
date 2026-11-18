import type { Presence } from '@homingbird/protocol'
import { strings } from './strings.ts'

export interface PresenceShown {
  readonly person: { readonly isOn: boolean; readonly label: string; readonly words: string | null }
  readonly agent: { readonly isOn: boolean; readonly title: string; readonly words: string | null }
}

export const presenceShown = (presence: Presence, inWords: boolean): PresenceShown => {
  const personLabel = presence.humanOnline ? strings.humanOnline : strings.humanOffline
  return {
    person: { isOn: presence.humanOnline, label: personLabel, words: inWords ? personLabel : null },
    agent: {
      isOn: presence.agentOnline,
      title: presence.agentOnline ? strings.agentOnlineHint : strings.agentOffline,
      words: presence.agentOnline ? strings.agentOnline : inWords ? strings.agentOffline : null,
    },
  }
}
