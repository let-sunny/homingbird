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

  it('tells a person how a scheduling flock’s meeting changed, naming the flock and whoever it is about', () => {
    expect(en.meeting.waits('Plan')).toBe('Plan · A time was found')
    expect(en.meeting.busy('Plan', 'Ben')).toBe('Plan · Ben is busy then')
    expect(en.meeting.left('Plan', 'Ben')).toBe('Plan · Ben left')
  })

  it('tells a person their agent joined a scheduling flock for them, naming it the first time', () => {
    expect(en.meeting.joined('Plan')).toBe('Plan · Your agent is finding a time')
    expect(en.meeting.joinedFirstBody('Ben laptop')).toBe(
      'Ben laptop joined for you to share your free times. You can change this in Settings.',
    )
  })
})
