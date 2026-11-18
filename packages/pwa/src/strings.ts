import { DEFAULT_LOCALE, type Locale } from '@homingbird/protocol'
import { LANGUAGES } from './languages.ts'
import type { en } from './languages/en.ts'
import { type Compiled, compile } from './messages.ts'

export let strings: Strings = compiled(DEFAULT_LOCALE)

export let locale: Locale = DEFAULT_LOCALE

export const useLanguage = (next: Locale): void => {
  if (next === locale) return
  strings = compiled(next)
  locale = next
  formats = formatsFor(next)
  if (globalThis.document !== undefined) document.documentElement.lang = next
}

export let formats: Formats = formatsFor(DEFAULT_LOCALE)

export const errorText = (error: {
  readonly _tag: keyof Strings['errors']
  readonly message: string
}): string => strings.errors[error._tag] || error.message

export const listOf = (items: ReadonlyArray<string>): string => formats.list.format(items)

export type Strings = Compiled<typeof en>

export interface Formats {
  readonly time: Intl.DateTimeFormat
  readonly day: Intl.DateTimeFormat
  readonly full: Intl.DateTimeFormat
  readonly list: Intl.ListFormat
}

function compiled(next: Locale): Strings {
  return compile<typeof en>(next, LANGUAGES[next])
}

function formatsFor(next: Locale): Formats {
  return {
    time: new Intl.DateTimeFormat(next, { hour: 'numeric', minute: '2-digit' }),
    day: new Intl.DateTimeFormat(next, { month: 'short', day: 'numeric' }),
    full: new Intl.DateTimeFormat(next, { dateStyle: 'medium', timeStyle: 'short' }),
    list: new Intl.ListFormat(next, { type: 'conjunction' }),
  }
}
