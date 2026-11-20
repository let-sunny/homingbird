import { LOCALES } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { pushTitlesIn } from '../src/push/titles.ts'

describe('push notification titles', () => {
  it('falls back to English when the person has no language', () => {
    expect(pushTitlesIn(null)).toBe(pushTitlesIn('en'))
  })

  it.each(LOCALES)('has every title in %s, naming the author', (locale) => {
    const titles = pushTitlesIn(locale)
    expect(titles.noteFrom('Ana')).toContain('Ana')
    expect(titles.noteFromColleague).not.toBe('')
    expect(titles.draftWaiting).not.toBe('')
    expect(titles.reviewWaiting('#payments-wiki')).toContain('#payments-wiki')
  })

  it('writes the Korean titles with the product words from the decisions', () => {
    const titles = pushTitlesIn('ko')
    expect(titles.noteFrom('Ana')).toBe('Ana님이 보낸 노트')
    expect(titles.draftWaiting).toContain('초안')
    expect(titles.draftWaiting).toContain('승인')
  })
})
