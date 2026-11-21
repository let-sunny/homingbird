import type { Fetch } from '@homingbird/client'
import type { Page } from '@homingbird/pwa/src/browser-page.ts'

/**
 * The browser around the demo: every request goes to the Dovecote in the page, and leaving the page,
 * to sign out or to return to an agent, starts the demo over instead.
 */
export const demoPage = (page: Page, dovecote: Fetch, startOver: () => void): Page => ({
  ...page,
  fetch: dovecote,
  assign: () => startOver(),
  supportsPush: () => false,
})
