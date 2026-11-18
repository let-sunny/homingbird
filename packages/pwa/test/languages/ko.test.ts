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
    expect(ko.noAgentOnline).toContain('전용 세션')
    expect(texts(ko).join(' ')).not.toMatch(/메시지|드래프트|데스크/)
  })

  it('speaks in one polite style, without formal endings or exclamation marks', () => {
    for (const text of texts(ko)) {
      expect(text).not.toMatch(/습니다|십시오/)
      expect(text).not.toContain('!')
    }
  })

  it('has its own text for every error kind the server can send', () => {
    for (const text of Object.values(ko.errors)) expect(text).not.toBe('')
  })
})
