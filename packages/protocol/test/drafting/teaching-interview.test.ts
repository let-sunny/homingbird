import { describe, expect, it } from 'vitest'
import {
  PROPOSALS_SAVED_ONLY_BY_A_PERSON,
  PROPOSE_TOOL,
  TEACHING_MATERIAL_TOOL,
  teachingInterviewPrompt,
} from '../../src/drafting/teaching-interview.ts'

describe('teachingInterviewPrompt', () => {
  it('reads the material first, asks one question at a time, proposes, and leaves saving to the person', () => {
    const text = teachingInterviewPrompt()
    expect(text.indexOf(TEACHING_MATERIAL_TOOL)).toBeLessThan(text.indexOf(PROPOSE_TOOL))
    expect(text).toContain('one short question at a time')
    expect(text).toContain('How do you usually handle refund requests?')
    expect(text).toContain('pick the topic')
    expect(text).toContain(PROPOSALS_SAVED_ONLY_BY_A_PERSON)
    expect(text).not.toMatch(/\b(approve it|send it|discard)\b/)
  })

  it('starts with the topic the person named, trimmed', () => {
    const text = teachingInterviewPrompt('  refunds  ')
    expect(text).toContain('Start with what I asked about: refunds')
    expect(text).not.toContain('pick the topic')
    expect(teachingInterviewPrompt('   ')).toContain('pick the topic')
  })

  it('reads, line by line, as pinned', () => {
    expect(teachingInterviewPrompt()).toMatchSnapshot()
  })
})
