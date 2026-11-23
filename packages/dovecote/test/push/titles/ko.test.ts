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

  it('tells a person how a scheduling room’s meeting changed, naming the room and whoever it is about', () => {
    expect(ko.meeting.waits('기획')).toBe('기획 · 시간을 찾았어요')
    expect(ko.meeting.busy('기획', 'Ben')).toBe('기획 · Ben님은 그 시간에 일정이 있어요')
    expect(ko.meeting.left('기획', 'Ben')).toBe('기획 · Ben님이 빠졌어요')
  })
})
