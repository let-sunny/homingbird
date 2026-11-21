import { type Clock, systemClock } from '@homingbird/kernel'
import { LOCALES, type Locale } from '@homingbird/protocol'
import { APPEARANCES, type Appearance } from '@homingbird/pwa/src/appearance.ts'

/** `?at=` stops the clock, `?lang=` and `?theme=` choose; for photographing the same screens, never stored. */
export const demoOptions = (search: string): DemoOptions => {
  const parameters = new URLSearchParams(search)
  const at = Date.parse(parameters.get('at') ?? '')
  const language = parameters.get('lang')
  const appearance = parameters.get('theme')
  return {
    at: Number.isFinite(at) ? at : null,
    language: LOCALES.find((locale) => locale === language) ?? null,
    appearance: APPEARANCES.find((each) => each === appearance) ?? null,
  }
}

export interface DemoOptions {
  readonly at: number | null
  readonly language: Locale | null
  readonly appearance: Appearance | null
}

/** The system's clock, or one stopped at `at`; waits still take real time. */
export const clockFor = (options: DemoOptions): Clock =>
  options.at === null ? systemClock : { now: () => options.at!, sleep: systemClock.sleep }
