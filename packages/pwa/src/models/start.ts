import type { Start } from '../state.ts'
import { strings } from '../strings.ts'
import type { PipState } from '../views/pip.ts'

/** What the page shows before the person's session is known: a quiet wait, or a way to try again. */
export const startModel = (start: Start, brandingName: string): StartModel =>
  start === 'failed'
    ? {
        kind: 'failed',
        title: brandingName,
        pip: 'offline',
        text: strings.firstLoad.failed,
        retry: strings.tryAgain,
      }
    : { kind: 'loading', text: start === 'slow' ? strings.firstLoad.slow : strings.loading }

export type StartModel =
  | { readonly kind: 'loading'; readonly text: string }
  | {
      readonly kind: 'failed'
      readonly title: string
      readonly pip: PipState
      readonly text: string
      readonly retry: string
    }
