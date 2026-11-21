import { describe, expect, it } from 'vitest'
import { ko } from '../../src/languages/ko.ts'

const texts = (entry: unknown): string[] =>
  typeof entry === 'string' ? [entry] : Object.values(entry as Record<string, unknown>).flatMap(texts)

describe('Korean', () => {
  it('names itself in Korean', () => {
    expect(ko.languageName).toBe('한국어')
  })

  it('keeps the product names in Latin letters', () => {
    expect(ko.appName).toBe('Homingbird')
    expect(texts(ko).join(' ')).not.toMatch(/호밍버드|도브코트|핍/)
  })

  it('renders the product words as recorded in the decisions', () => {
    expect(ko.navNotes).toBe('노트')
    expect(ko.newNoteDraft).toBe('노트 초안')
    expect(ko.approve).toBe('승인')
    expect(ko.send).toBe('보내기')
    expect(ko.deskBody).toContain('데스크는 Homingbird를 위해 내 에이전트를 실행하는 프로그램')
    expect(ko.noAgentOnline).not.toContain('데스크')
    expect(texts(ko).join(' ')).not.toMatch(/메시지|드래프트|전용 세션/)
  })

  it('speaks in one polite style, without formal endings or exclamation marks', () => {
    for (const text of texts(ko)) {
      expect(text).not.toMatch(/습니다|십시오/)
      expect(text).not.toContain('!')
    }
  })

  it('never hangs a particle on a placeholder, whose last sound it cannot know', () => {
    const hanging = texts(ko).filter((text) =>
      /\}[”"]?(?:\((?:을|를|이|가|은|는|와|과|으)\)|을|를|이 |가 |은 |는 |와 |과 |으로|로 )/.test(text),
    )
    expect(hanging).toEqual([])
  })

  it('asks for a manager to be added, never for a managing group to be chosen', () => {
    expect(texts(ko).join(' ')).not.toMatch(/운영 그룹을 정해|운영 그룹 변경|운영 그룹에 다른/)
    expect(ko.refusals.lastManager).toContain('운영자')
  })

  it('calls a group 그룹, never 팀, and the server’s operator 서버 운영자, apart from a channel’s 운영자', () => {
    expect(texts(ko).join(' ')).not.toContain('팀')
    expect(ko.features.whenOff.analytics).toContain('서버 운영자')
    expect(ko.managerLabel).toBe('운영자')
  })

  it('discards a draft with 버리기, whoever wrote it', () => {
    expect(ko.discard).toBe('버리기')
    expect(ko.channelAgent.discard).toBe('버리기')
  })

  it('shows a debate’s turns as progress toward its limit, never as a turn number', () => {
    expect(ko.debates.turnProgress).toBe('{count}/{total} 차례')
  })

  it('has its own text for the error kinds that always mean the same thing', () => {
    for (const kind of ['Unauthorized', 'RateLimited', 'Unavailable'] as const)
      expect(ko.errors[kind]).not.toBe('')
  })

  it('leaves refusals that depend on the case to a specific sentence or the server’s own words', () => {
    for (const kind of ['Forbidden', 'NotFound', 'Invalid', 'Conflict'] as const)
      expect(ko.errors[kind]).toBe('')
  })
})
