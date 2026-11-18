import { DEFAULT_LOCALE, LOCALES, type Locale } from '@homingbird/protocol'
import { en } from './languages/en.ts'
import { ko } from './languages/ko.ts'
import type { Translation } from './messages.ts'

export const LANGUAGES: Readonly<Record<Locale, Translation<typeof en>>> = { en, ko }

export const preferredLanguage = (chosen: Locale | undefined, browser: ReadonlyArray<string>): Locale =>
  chosen ?? browser.map(supportedLanguageOf).find((locale) => locale !== null) ?? DEFAULT_LOCALE

export const supportedLanguageOf = (tag: string): Locale | null => {
  const primary = tag.split(/[-_]/)[0]!.toLowerCase()
  return LOCALES.find((locale) => locale === primary) ?? null
}

export interface LanguageChoice {
  readonly value: Locale | null
  readonly label: string
  readonly lang: Locale | null
}

export const languageChoices = (automaticLabel: string): LanguageChoice[] => [
  { value: null, label: automaticLabel, lang: null },
  ...LOCALES.map((locale) => ({ value: locale, label: LANGUAGES[locale].languageName, lang: locale })),
]
