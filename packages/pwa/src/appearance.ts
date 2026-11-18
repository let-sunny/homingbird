export type Appearance = 'auto' | 'light' | 'dark'

export const APPEARANCES: ReadonlyArray<Appearance> = ['auto', 'light', 'dark']

export const currentAppearance = (): Appearance => {
  const stored = readStored()
  return APPEARANCES.includes(stored as Appearance) ? (stored as Appearance) : 'auto'
}

export const applyAppearance = (appearance: Appearance): void => {
  document.documentElement.dataset.appearance = appearance
  try {
    localStorage.setItem(STORAGE_KEY, appearance)
  } catch {
    return
  }
}

const STORAGE_KEY = 'homingbird.appearance'

const readStored = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
