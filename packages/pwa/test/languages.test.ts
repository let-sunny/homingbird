import { LOCALES } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { LANGUAGES, languageChoices, preferredLanguage, supportedLanguageOf } from '../src/languages.ts'
import { en } from '../src/languages/en.ts'
import { isPlural, placeholdersOf } from '../src/messages.ts'

type Shape = Readonly<Record<string, ReadonlyArray<string>>>

const shapeOf = (entry: unknown, path = ''): Shape => {
  if (typeof entry === 'string') return { [path]: placeholdersOf(entry) }
  if (isPlural(entry))
    return {
      [`${path}#plural`]: [
        ...new Set(Object.values(entry).flatMap((form) => placeholdersOf(form ?? ''))),
      ].sort(),
    }
  return Object.assign(
    {},
    ...Object.entries(entry as Record<string, unknown>).map(([key, value]) =>
      shapeOf(value, path === '' ? key : `${path}.${key}`),
    ),
  )
}

const pluralGroups = (entry: unknown): ReadonlyArray<Readonly<Record<string, string>>> => {
  if (typeof entry === 'string') return []
  if (isPlural(entry)) return [entry as Readonly<Record<string, string>>]
  return Object.values(entry as Record<string, unknown>).flatMap(pluralGroups)
}

describe('languages', () => {
  it('registers exactly the languages the protocol lists', () => {
    expect(Object.keys(LANGUAGES).sort()).toEqual([...LOCALES].sort())
  })

  it('uses the English file as the source for every language', () => {
    expect(LANGUAGES.en).toBe(en)
  })

  it.each(LOCALES)(
    '%s has exactly the English keys, with the same placeholders in each message',
    (locale) => {
      expect(shapeOf(LANGUAGES[locale])).toEqual(shapeOf(en))
    },
  )

  it.each(LOCALES)('%s declares only plural forms its own rules can choose, always with other', (locale) => {
    const forms = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
    for (const group of pluralGroups(LANGUAGES[locale])) {
      expect(group).toHaveProperty('other')
      for (const form of Object.keys(group)) expect(forms).toContain(form)
    }
  })

  it.each(LOCALES)('%s leaves no message empty except where English is empty too', (locale) => {
    const english = shapeOf(en)
    const flat = (entry: unknown, path = ''): Array<[string, string]> =>
      typeof entry === 'string'
        ? [[path, entry]]
        : Object.entries(entry as Record<string, unknown>).flatMap(([key, value]) =>
            flat(value, path === '' ? key : `${path}.${key}`),
          )
    const englishEmpty = new Set(
      flat(en)
        .filter(([, text]) => text === '')
        .map(([path]) => path),
    )
    for (const [path, text] of flat(LANGUAGES[locale]))
      if (!englishEmpty.has(path) && !path.startsWith('errors.')) expect(text, path).not.toBe('')
    expect(Object.keys(english).length).toBeGreaterThan(200)
  })
})

describe('preferredLanguage', () => {
  it('follows the language saved on the profile first', () => {
    expect(preferredLanguage('ko', ['en-US'])).toBe('ko')
    expect(preferredLanguage('en', ['ko-KR'])).toBe('en')
  })

  it('then the first browser language Homingbird speaks', () => {
    expect(preferredLanguage(undefined, ['fr-FR', 'ko-KR', 'en-US'])).toBe('ko')
    expect(preferredLanguage(undefined, ['ko'])).toBe('ko')
  })

  it('and English when the browser asks for nothing it knows', () => {
    expect(preferredLanguage(undefined, ['fr-FR', 'de'])).toBe('en')
    expect(preferredLanguage(undefined, [])).toBe('en')
  })
})

describe('supportedLanguageOf', () => {
  it.each([
    ['ko-KR', 'ko'],
    ['KO', 'ko'],
    ['ko_KR', 'ko'],
    ['en-GB', 'en'],
    ['zh-Hans-CN', null],
    ['', null],
  ])('reads %j as %j', (tag, locale) => {
    expect(supportedLanguageOf(tag)).toBe(locale)
  })
})

describe('the language picker', () => {
  it('offers following the browser first, then each language in its own name', () => {
    expect(languageChoices('Match browser')).toEqual([
      { value: null, label: 'Match browser', lang: null },
      { value: 'en', label: 'English', lang: 'en' },
      { value: 'ko', label: '한국어', lang: 'ko' },
    ])
  })
})
