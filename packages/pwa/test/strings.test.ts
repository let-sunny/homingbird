import { afterEach, describe, expect, it } from 'vitest'
import { errorText, formats, listOf, locale, strings, useLanguage } from '../src/strings.ts'

afterEach(() => useLanguage('en'))

describe('the current language', () => {
  it('starts in English', () => {
    expect(locale).toBe('en')
    expect(strings.send).toBe('Send')
  })

  it('switches every message, plural and date format at once', () => {
    useLanguage('ko')
    expect(locale).toBe('ko')
    expect(strings.send).toBe('보내기')
    expect(strings.draftsWaiting({ count: 3 })).toBe('대기 중인 초안 3개')
    expect(formats.day.resolvedOptions().locale).toBe('ko')
    useLanguage('en')
    expect(strings.draftsWaiting({ count: 1 })).toBe('1 draft waiting')
    expect(strings.draftsWaiting({ count: 3 })).toBe('3 drafts waiting')
  })

  it('joins names the way the language lists them', () => {
    expect(listOf(['Ana', 'Ben', 'Cy'])).toBe('Ana, Ben, and Cy')
    useLanguage('ko')
    expect(listOf(['Ana', 'Ben', 'Cy'])).toBe('Ana, Ben 및 Cy')
  })
})

describe('errorText', () => {
  it('shows the server message in English', () => {
    expect(errorText({ _tag: 'Conflict', message: 'This request was already decided.' })).toBe(
      'This request was already decided.',
    )
  })

  it('shows its own text for a known error kind in another language', () => {
    useLanguage('ko')
    expect(errorText({ _tag: 'RateLimited', message: 'Too many drafts in a short time.' })).toBe(
      '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    )
  })
})
