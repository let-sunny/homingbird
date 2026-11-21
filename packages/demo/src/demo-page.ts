import type { Fetch } from '@homingbird/client'
import type { Page } from '@homingbird/pwa/src/browser-page.ts'
import type { DemoOptions } from './options.ts'

/** The browser around the demo: requests stay in the page, leaving starts over, the address picks language and theme. */
export const demoPage = (
  page: Page,
  dovecote: Fetch,
  startOver: () => void,
  options: Pick<DemoOptions, 'language' | 'appearance'> = { language: null, appearance: null },
): Page => ({
  ...page,
  fetch: dovecote,
  assign: () => startOver(),
  supportsPush: () => false,
  languages: () => (options.language === null ? page.languages() : [options.language]),
  storage:
    options.appearance === null
      ? page.storage
      : {
          ...page.storage,
          local: (key) => (key === APPEARANCE_KEY ? options.appearance : page.storage.local(key)),
          setLocal: (key, value) => {
            if (key !== APPEARANCE_KEY) page.storage.setLocal(key, value)
          },
        },
})

const APPEARANCE_KEY = 'homingbird.appearance'
