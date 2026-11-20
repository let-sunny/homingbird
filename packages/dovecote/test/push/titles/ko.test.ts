import { describe, expect, it } from 'vitest'
import { ko } from '../../../src/push/titles/ko.ts'

describe('Korean push titles', () => {
  it('names the author of an arriving note politely, or a colleague when the author is unknown', () => {
    expect(ko.noteFrom('Ana')).toBe('Ana님이 보낸 노트')
    expect(ko.noteFromColleague).toBe('동료가 보낸 노트')
  })

  it('says a draft is waiting for approval in the polite style', () => {
    expect(ko.draftWaiting).toBe('승인을 기다리는 초안이 있어요')
  })

  it('names the channel whose agent’s answer waits for review', () => {
    expect(ko.reviewWaiting('#payments-wiki')).toBe('#payments-wiki · 검토를 기다리는 답변이 있어요')
  })
})
