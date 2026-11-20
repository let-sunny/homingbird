import { describe, expect, it } from 'vitest'
import { en } from '../../../src/push/titles/en.ts'

describe('English push titles', () => {
  it('names the author of an arriving note, or a colleague when the author is unknown', () => {
    expect(en.noteFrom('Ana')).toBe('Note from Ana')
    expect(en.noteFromColleague).toBe('Note from a colleague')
  })

  it('says a draft is waiting for approval', () => {
    expect(en.draftWaiting).toBe('A draft is waiting for your approval')
  })

  it('names the channel whose agent’s answer waits for review', () => {
    expect(en.reviewWaiting('#payments-wiki')).toBe('#payments-wiki · An answer waits for your review')
  })
})
