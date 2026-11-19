import type { PageStorage } from './browser-page.ts'

export type Appearance = 'auto' | 'light' | 'dark'

export const APPEARANCES: ReadonlyArray<Appearance> = ['auto', 'light', 'dark']

/** The appearance this browser chose before, or the system's. */
export const currentAppearance = (storage: PageStorage): Appearance => {
  const stored = storage.local(STORAGE_KEY)
  return APPEARANCES.includes(stored as Appearance) ? (stored as Appearance) : 'auto'
}

/** Shows the page in an appearance and remembers it in this browser. */
export const applyAppearance = (root: HTMLElement, storage: PageStorage, appearance: Appearance): void => {
  root.dataset.appearance = appearance
  storage.setLocal(STORAGE_KEY, appearance)
}

const STORAGE_KEY = 'homingbird.appearance'
