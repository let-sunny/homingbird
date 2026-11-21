import { describe, expect, it } from 'vitest'
import { en } from '../../src/languages/en.ts'

const texts = (entry: unknown): string[] =>
  typeof entry === 'string' ? [entry] : Object.values(entry as Record<string, unknown>).flatMap(texts)

describe('English', () => {
  it('names itself in English', () => {
    expect(en.languageName).toBe('English')
  })

  it('never raises its voice with an exclamation mark', () => {
    for (const text of texts(en)) expect(text).not.toContain('!')
  })

  it('asks for a manager, never for a managing group to be chosen, as no screen chooses one', () => {
    for (const text of texts(en)) expect(text).not.toMatch(/managing group/i)
    expect(en.refusals.lastManager).toContain('Add another manager')
  })

  it('calls a group a group, never a team', () => {
    for (const text of texts(en)) expect(text).not.toMatch(/\bteams?\b/i)
  })

  it('shows a debate’s turns as progress toward its limit', () => {
    expect(en.debates.turnProgress).toBe('{count}/{total} turns')
  })

  it('leaves server error messages as the server wrote them', () => {
    expect(Object.values(en.errors).every((text) => text === '')).toBe(true)
  })
})
