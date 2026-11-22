import type { Connection } from './state.ts'
import type { Strings } from './strings.ts'

export interface ConnectionShown {
  readonly state: 'connected' | 'connecting' | 'offline'
  readonly label: string
  readonly description: string
  readonly noticeable: boolean
  /**
   * A page that is up to date is no news: it shows no badge (its state stays readable to assistive
   * technology), and only connecting or offline show, in words wherever the header is.
   */
  readonly shown: 'hidden' | 'label'
}

export const connectionShown = (connection: Connection, strings: Strings): ConnectionShown => {
  const state = connection === 'live' || connection === 'polling' ? 'connected' : connection
  return {
    state,
    label: strings.connection[state],
    description: state === 'offline' ? strings.connectionOffline : strings.connection[state],
    noticeable: state !== 'connected',
    shown: state === 'connected' ? 'hidden' : 'label',
  }
}
