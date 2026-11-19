import type { Clock } from '@homingbird/kernel'
import type { AsRead, MemberId } from '@homingbird/protocol'
import { type Actions, createActions } from '../actions.ts'
import type { App, Random } from '../app.ts'
import { arrivalTracker } from '../arrivals.ts'
import type { Page } from '../browser-page.ts'
import type { PageDocument } from '../page-document.ts'
import type { AppState } from '../state.ts'
import { createTour } from './tour.ts'

/** The context the app shell gives every view of a page: one for the page's whole life. */
export const createViewContext = (app: App, document: PageDocument): ViewContext => ({
  state: app.state,
  actions: createActions(app.launch),
  clock: app.clock,
  random: app.random,
  page: app.page,
  document,
  tour: createTour(app.page, document),
  justArrived: arrivalTracker(app.clock.now(), () => app.clock.now()),
})

export interface ViewContext {
  readonly state: AppState
  readonly actions: Actions
  readonly clock: Clock
  readonly random: Random
  readonly page: Page
  /** What is already on the page, the focus and document-wide events; a view never reads `document`. */
  readonly document: PageDocument
  readonly tour: Tour
  /** Whether a conversation row just received a note from someone else, so that it plays its arrival. */
  readonly justArrived: (conversation: AsRead.Conversation, viewerId: MemberId) => boolean
}

export interface Tour {
  readonly start: () => void
  readonly startOnHome: (routeName: string) => void
}
